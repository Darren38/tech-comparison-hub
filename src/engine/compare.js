// Comparison engine: like-for-like category verdicts with reasons and citations.
//
// For each score category, only metrics that every compared device has evidence for
// are used ("shared evidence"), so a device is never rewarded for simply having been
// tested more. Each verdict states its margin, confidence and the metrics behind it.

import { store, metricDef, scoreMetricsFor } from '../core/store.js';
import { fmtMetric, pctDiff } from '../lib/format.js';
import {
  getMetric, categoryScore, profileScore, applicableScoreCategories, entityId, entityCategory,
  combineConfidence, sharedCurrency, valueScores, isSpecMetric,
} from './scoring.js';

const LEVELS = ['low', 'medium', 'high'];
const minLevel = (...levels) => LEVELS[Math.min(...levels.map((l) => LEVELS.indexOf(l)))];

/** Pick, for one scoring item, the first alternative metric that all entities have. */
function sharedPick(entities) {
  return (item) => {
    const ids = item.alt ?? [item.id];
    return ids.find((id) => entities.every((e) => getMetric(e, id)));
  };
}

function originNames(entity, metricId) {
  const m = getMetric(entity, metricId);
  if (!m) return [];
  if (m.inherited) return [`chipset result (${store.chipsetById.get(m.inherited)?.name ?? m.inherited})`];
  const origins = m.summary?.origins ?? [];
  return origins.slice(0, 2).map((o) => o.name);
}

function reasonText(def, a, b) {
  const diff = pctDiff(a, b);
  const rel = Math.abs(diff) >= 1 ? ` (${Math.abs(diff).toFixed(0)}% ${diff > 0 ? 'higher' : 'lower'})` : '';
  return `${def.name}: ${fmtMetric(def, a)} vs ${fmtMetric(def, b)}${rel}`;
}

function buildReasons(winner, runner) {
  const reasons = [];
  const counter = [];
  const runnerUsed = new Map(runner.result.used.map((u) => [u.id, u]));
  for (const u of winner.result.used) {
    const r = runnerUsed.get(u.id);
    if (!r) continue;
    const def = metricDef(u.id);
    const impact = (u.score - r.score) * u.w;
    const entry = {
      metric: u.id,
      impact,
      text: reasonText(def, u.value, r.value),
      values: [u.value, r.value],
      sources: originNames(winner.entity, u.id),
      spec: isSpecMetric(u.id),
      inherited: Boolean(u.inherited || r.inherited),
    };
    if (impact > 0.5) reasons.push(entry);
    else if (impact < -0.5) counter.push({ ...entry, text: reasonText(def, r.value, u.value) });
  }
  reasons.sort((x, y) => y.impact - x.impact);
  counter.sort((x, y) => x.impact - y.impact);
  return { reasons: reasons.slice(0, 4), counter: counter.slice(0, 2) };
}

function verdictFor(sc, entities) {
  const pick = sharedPick(entities);
  const results = entities.map((entity) => ({ entity, id: entityId(entity), result: categoryScore(entity, sc, { pick }) }));
  const scored = results.filter((r) => r.result);
  const items = scoreMetricsFor(sc, entityCategory(entities[0]));
  const sharedIds = items.map(pick).filter(Boolean);
  const missing = items
    .filter((item) => !pick(item))
    .map((item) => (item.alt ?? [item.id])[0]);
  const base = { id: sc.id, label: sc.label, question: sc.question, note: sc.note, specOnly: sc.specOnly, results, sharedIds, missing };

  if (scored.length < 2) {
    return { ...base, verdict: 'insufficient', why: 'Not enough shared evidence to compare these devices in this category.' };
  }
  const minCoverage = store.core.scoring.verdict.minCoverage;
  const coverage = scored[0].result.coverage;
  if (coverage < minCoverage) {
    return { ...base, verdict: 'insufficient', why: `Only ${Math.round(coverage * 100)}% of this category's evidence is shared by all devices.` };
  }
  const ranked = [...scored].sort((a, b) => b.result.score - a.result.score);
  const [winner, runner] = ranked;
  const margin = winner.result.score - runner.result.score;
  const tieMargin = store.core.scoring.verdict.tieMargin;
  const confidence = minLevel(winner.result.confidence, runner.result.confidence);
  const { reasons, counter } = buildReasons(winner, runner);
  if (margin < tieMargin) {
    // A tie still has a (narrow) leader; name both so the "ahead on" lists are attributable.
    return { ...base, verdict: 'tie', leader: winner.id, runnerUp: runner.id, ranked, margin, confidence, reasons, counter, why: `Scores are within ${tieMargin} points: too close to call on the shared evidence.` };
  }
  return { ...base, verdict: 'winner', winner: winner.id, runnerUp: runner.id, ranked, margin, confidence, reasons, counter };
}

/** Rows for the benchmark/measurement table: every non-spec global metric any device has. */
function metricRows(entities) {
  const ids = new Set();
  for (const e of entities) Object.keys(e.metrics ?? {}).forEach((id) => ids.add(id));
  const rows = [];
  for (const id of ids) {
    const def = metricDef(id);
    if (!def || def.derive) continue;
    const values = entities.map((e) => ({ id: entityId(e), m: getMetric(e, id) }));
    const present = values.filter((v) => v.m);
    const best = present.length > 1
      ? present.reduce((a, b) => ((def.better === 'lower' ? b.m.value < a.m.value : b.m.value > a.m.value) ? b : a)).id
      : null;
    rows.push({ id, def, values, best, coverage: present.length });
  }
  const order = ['performance', 'gaming', 'thermals', 'efficiency', 'battery', 'charging', 'display'];
  return rows.sort((a, b) => order.indexOf(a.def.facet) - order.indexOf(b.def.facet) || b.coverage - a.coverage);
}

/** Head-to-head tests from a single document that include at least two compared devices. */
function sharedTests(entities) {
  const ids = new Set(entities.map(entityId));
  const seen = new Set();
  const out = [];
  for (const e of entities) {
    for (const t of e.headToHead ?? []) {
      const key = `${t.doc}:${t.metric}`;
      if (seen.has(key)) continue;
      const entries = t.entries.filter((x) => ids.has(x.subject));
      if (entries.length >= 2) {
        seen.add(key);
        out.push({ ...t, entries, doc: store.docById.get(t.doc), docId: t.doc, all: t.entries });
      }
    }
  }
  return out;
}

// Metrics considered for the "key differences" digest. Independent measurements come first;
// spec-derived metrics are included where a difference is meaningful to buyers.
const KEY_METRICS = [
  'gsma_active_use', 'charge_full', 'nits_auto', 'nits_peak', 'wle', 'wle_stability', 'gb6_single', 'gb6_multi',
  'spec_battery_mah', 'spec_battery_wh', 'spec_battery_life', 'spec_wired_w', 'spec_wireless_w', 'spec_zoom',
  'spec_main_sensor', 'spec_os_years', 'spec_weight', 'spec_water_m', 'spec_refresh',
];

/**
 * The largest real differences between the compared devices, as a short digest.
 * A difference qualifies when the leader beats the next-best device by at least 12%
 * (2 years for update commitments). Chipset stand-ins are excluded: only a device's own
 * evidence can make it "the" leader.
 */
export function keyDifferences(entities, { limit = 6 } = {}) {
  const out = [];
  for (const id of KEY_METRICS) {
    const def = metricDef(id);
    if (!def) continue;
    const vals = entities.map((e) => ({ id: entityId(e), m: getMetric(e, id) })).filter((v) => v.m && !v.m.inherited);
    if (vals.length < 2) continue;
    const lower = def.better === 'lower';
    vals.sort((a, b) => (lower ? a.m.value - b.m.value : b.m.value - a.m.value));
    const [best, next] = vals;
    if (best.m.value === next.m.value) continue;
    const gap = lower ? (next.m.value - best.m.value) / best.m.value : (best.m.value - next.m.value) / Math.abs(next.m.value || 1);
    const significant = def.unit === 'years' ? Math.abs(best.m.value - next.m.value) >= 2 : gap >= 0.12;
    if (!significant) continue;
    const measured = !isSpecMetric(id);
    out.push({
      metric: id,
      def,
      best: best.id,
      next: next.id,
      bestValue: best.m.value,
      nextValue: next.m.value,
      gap,
      measured,
      confidence: best.m.confidence,
      sources: measured ? (best.m.summary?.origins ?? []).slice(0, 2).map((o) => o.name) : [],
      missing: entities.length - vals.length,
      rank: gap * (measured ? 1.6 : 1),
    });
  }
  return out.sort((a, b) => b.rank - a.rank).slice(0, limit);
}

/** Every source behind a comparison: documents per device, spec sources, and chipset evidence used as stand-ins. */
export function sourcesUsed(entities) {
  const docs = new Map();
  const specs = new Map();
  const chipDocs = new Map();
  for (const e of entities) {
    const id = entityId(e);
    for (const d of e.documents ?? []) {
      const entry = docs.get(d.id) ?? { doc: d, devices: new Set(), records: 0, findings: 0 };
      entry.devices.add(id);
      entry.records += d.records?.length ?? 0;
      entry.findings += d.findings?.length ?? 0;
      docs.set(d.id, entry);
    }
    const usesStandIn = Object.values(e.metrics ?? {}).some((m) => m.inherited);
    for (const d of usesStandIn ? e.chipsetDocuments ?? [] : []) {
      if (!d.recordCount || docs.has(d.id)) continue;
      const entry = chipDocs.get(d.id) ?? { doc: d, devices: new Set() };
      entry.devices.add(id);
      chipDocs.set(d.id, entry);
    }
    const prov = e.device.provenance ?? {};
    for (const p of [prov.default, ...Object.values(prov.fields ?? {})]) {
      if (!p?.source) continue;
      const key = `${p.source}|${p.url ?? ''}`;
      const entry = specs.get(key) ?? { ...p, devices: new Set() };
      entry.devices.add(id);
      specs.set(key, entry);
    }
  }
  const byEvidence = (a, b) => b.records - a.records || String(b.doc.published ?? '').localeCompare(String(a.doc.published ?? ''));
  return { documents: [...docs.values()].sort(byEvidence), specs: [...specs.values()], chipset: [...chipDocs.values()] };
}

/**
 * `profile` may be a profile id or a profile object (e.g. from customProfile()).
 * `currency` is the reader's display currency, preferred for value scoring when every device has a real price in it.
 */
export function buildComparison(entities, profile = 'balanced', { currency } = {}) {
  const categories = new Set(entities.map(entityCategory));
  const category = entityCategory(entities[0]);
  profile = typeof profile === 'object' ? profile : store.profileById.get(profile) ?? store.profileById.get('balanced');
  const verdicts = applicableScoreCategories(category).map((sc) => verdictFor(sc, entities));

  // Profile score from the like-for-like category scores.
  const catScores = new Map(entities.map((e) => [entityId(e), {}]));
  for (const v of verdicts) {
    for (const r of v.results) if (r.result && v.verdict !== 'insufficient') catScores.get(r.id)[v.id] = r.result;
  }
  const valueCurrency = sharedCurrency(entities, currency);
  const balanced = store.profileById.get('balanced');
  const balancedMap = new Map(entities.map((e) => [entityId(e), profileScore(catScores.get(entityId(e)), balanced, { category })?.score]));
  const values = valueCurrency ? valueScores(entities, valueCurrency, balancedMap) : new Map();

  const profileResults = entities
    .map((e) => ({ id: entityId(e), result: profileScore(catScores.get(entityId(e)), profile, { category, valueScore: values.get(entityId(e))?.score ?? null }) }))
    .filter((r) => r.result)
    .sort((a, b) => b.result.score - a.result.score);

  let overall = null;
  if (profileResults.length >= 2) {
    const [w, r] = profileResults;
    const margin = w.result.score - r.result.score;
    const decisive = w.result.parts
      .map((p) => {
        const other = r.result.parts.find((x) => x.id === p.id);
        return other ? { id: p.id, weight: p.weight, impact: (p.score - other.score) * p.weight } : null;
      })
      .filter((x) => x && x.impact > 0.3)
      .sort((a, b) => b.impact - a.impact)
      .slice(0, 3);
    const conf = combineConfidence(w.result.parts.map((p) => ({ w: p.weight, confidence: p.confidence })), w.result.coverage);
    overall = {
      verdict: margin < store.core.scoring.verdict.tieMargin ? 'tie' : 'winner',
      winner: w.id,
      runnerUp: r.id,
      margin,
      confidence: conf,
      decisive,
    };
  }

  const notes = [];
  if (categories.size > 1) notes.push('You are comparing devices from different categories, so scores use each device\'s own category benchmarks and may not be meaningful.');
  if (entities.some((e) => e.device?.status === 'pre-order' || e.device?.status === 'announced')) {
    notes.push('At least one device is not on sale yet, so its performance evidence comes from pre-release listings at best.');
  }
  const applicableIds = new Set(applicableScoreCategories(category).map((c) => c.id));
  const weights = Object.entries(profile.weights).filter(([, w]) => w > 0);
  const totalW = weights.reduce((s, [, w]) => s + w, 0);
  const fitW = weights.reduce((s, [k, w]) => s + (k === 'value' || applicableIds.has(k) ? w : 0), 0);
  if (totalW && fitW / totalW < 0.5) {
    const catName = (store.categoryById.get(category)?.name ?? 'these devices').toLowerCase();
    notes.push(`The ${profile.label} weighting is mostly about things ${catName} don't have, so its overall verdict means little here. Choose another use case.`);
  }

  return {
    category,
    mixed: categories.size > 1,
    profile,
    verdicts,
    profileResults,
    overall,
    value: { currency: valueCurrency, scores: values },
    metrics: metricRows(entities),
    tests: sharedTests(entities),
    notes,
  };
}
