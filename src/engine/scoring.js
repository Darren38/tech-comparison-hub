// Scoring: turns aggregated evidence (consensus values from the data build) into
// 0–100 category scores and use-case profile scores. Pure functions, no DOM.
//
// A metric score is relative to the best consensus value in the same device category:
//   higher-is-better  score = value / max            (log scale: ln(1+v) / ln(1+max))
//   lower-is-better   score = min / value
// A category score is the weighted mean of the metric scores that have evidence.
//
// Evidence that isn't recorded counts as typical for a similar device (Version 11). A missing metric in a category
// score, or a missing category in a use-case score, takes the median of, in order:
//   1. the same brand's devices of the same kind from the same or the previous year at a similar Malaysian launch
//      price (within 1.5x either way), if at least three have that evidence;
//   2. for charging and software support, which follow the maker more than the price, the same brand's devices at
//      any price from the last three years, else from two years either side, if at least three have it;
//   3. any brand's devices as in 1, if at least six have it;
// and otherwise the lower quartile of devices of that kind launched no later than it, so unproven never counts as
// better than typical and an old device is not measured against newer devices' spread.
// Before, missing evidence was simply left out, so a gap could only help: a 2023 phone with only its 1-inch main
// sensor recorded scored 100 for camera hardware, above a 2026 phone whose 4.3x zoom was recorded too, and
// mid-range phones with no benchmark data led the overall ranking because performance was skipped.
// Like-for-like comparisons (a `pick`) still use only the evidence every compared device shares.

import { store, metricDef, scoreMetricsFor, priceIn } from '../core/store.js';
import { displayPrice } from './money.js';

const LEVEL_VALUE = { high: 1, medium: 0.6, low: 0.25 };
const LETTER = { h: 'high', m: 'medium', l: 'low' };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Unified metric accessor for both index rows (`m`) and compiled device/chipset files (`metrics`). */
export function getMetric(entity, id) {
  if (!entity) return null;
  if (entity.metrics) {
    const m = entity.metrics[id];
    return m ? { value: m.value, confidence: m.confidence, inherited: m.inherited || null, summary: m } : null;
  }
  const row = entity.m?.[id];
  return row ? { value: row[0], confidence: LETTER[row[1]] ?? 'low', inherited: row[2] ? true : null } : null;
}

export const entityCategory = (entity) => entity?.device?.category ?? entity?.category;
export const entityId = (entity) => entity?.device?.id ?? entity?.id;
export const isSpecMetric = (id) => Boolean(metricDef(id)?.derive);
/** False for devices that are only announced or on pre-order: rankings leave them out or list them last. */
export const isOnSale = (row) => !['announced', 'pre-order'].includes(row?.status ?? row?.device?.status);

export function normalize(metricId, value, category) {
  const def = metricDef(metricId);
  const stats = store.core?.stats?.[category]?.[metricId];
  if (!def || !stats || value === null || value === undefined) return null;
  let ratio;
  if (def.better === 'lower') ratio = value > 0 ? stats.min / value : 1;
  else if (def.scale === 'log') ratio = stats.max > 0 ? Math.log1p(value) / Math.log1p(stats.max) : 0;
  else ratio = stats.max > 0 ? value / stats.max : 0;
  return clamp(ratio * 100, 0, 100);
}

// Where a result falls among the same lab's results for devices of the same kind (Version 14): 40 for the lowest,
// 100 for the highest, ties sharing a place. Used when several labs' tests are averaged ("combine": "mean"), because
// each lab's scale differs (a 25-hour record in one test, a score out of about 160 in another) and scoring against
// each lab's best result let the scale, not the phone, decide.
const rankCacheByMetric = new Map();
export function labPlaceScore(metricId, value, category) {
  const def = metricDef(metricId);
  if (!def || value === null || value === undefined) return null;
  const key = `${category}|${metricId}`;
  let values = rankCacheByMetric.get(key);
  if (!values) {
    values = (store.devices ?? []).filter((d) => d.category === category)
      .map((d) => getMetric(d, metricId)).filter((m) => m && !m.inherited).map((m) => m.value);
    rankCacheByMetric.set(key, values);
  }
  if (values.length < 5) return normalize(metricId, value, category);
  const below = values.filter((v) => (def.better === 'lower' ? v > value : v < value)).length;
  const equal = values.filter((v) => v === value).length;
  const place = (below + Math.max(equal - 1, 0) / 2) / Math.max(values.length - 1, 1);
  return 40 + 60 * clamp(place, 0, 1);
}
const itemScore = (item, id, value, category) =>
  (item.combine === 'mean' ? labPlaceScore(id, value, category) : normalize(id, value, category));

const quantile = (values, q) => {
  const v = values.filter((x) => x !== null && x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = (v.length - 1) * q;
  const lo = Math.floor(i);
  return v[lo] + (v[Math.ceil(i)] - v[lo]) * (i - lo);
};
const PEERS_MIN = 6;
const BRAND_PEERS_MIN = 3;
// charging speeds and update promises are the maker's policy rather than a matter of price; update promises have
// grown over the years (Samsung went from four to seven), so the brand's earlier devices count first
const BRAND_TRAITS = new Set(['charging', 'software', 'spec_wired_w', 'spec_wireless_w', 'charge_full', 'spec_os_years', 'spec_security_years']);
const PRICE_BAND = 1.5;
const launchYear = (row) => Number(String(row?.announced ?? '').slice(0, 4)) || null;
const launchPrice = (row) => {
  const v = row ? priceIn(row, 'MYR') : null;
  return typeof v === 'number' ? v : v?.amount ?? null;
};

// Every device's evidence per metric and per score category ({ year, price, score }), per device category.
const evidenceCache = new Map();
function evidenceOf(category) {
  if (evidenceCache.has(category)) return evidenceCache.get(category);
  const rows = (store.devices ?? []).filter((d) => d.category === category);
  const metrics = new Map();
  const categories = new Map();
  const entry = (d, score) => ({ brand: d.brand, year: launchYear(d), price: launchPrice(d), score });
  for (const sc of applicableScoreCategories(category)) {
    for (const item of scoreMetricsFor(sc, category)) {
      for (const id of item.alt ?? [item.id]) {
        if (metrics.has(id)) continue;
        metrics.set(id, rows.map((d) => { const m = getMetric(d, id); return m ? entry(d, itemScore(item, id, m.value, category)) : null; }).filter((x) => x && x.score !== null));
      }
    }
    categories.set(sc.id, rows.map((d) => { const r = categoryScore(d, sc, { fill: false }); return r ? entry(d, r.score) : null; }).filter(Boolean));
  }
  const out = { metrics, categories };
  evidenceCache.set(category, out);
  return out;
}

/**
 * The score a device is given for evidence it doesn't have: the median of similar devices (same kind, launched in
 * the same or the previous year, at a similar Malaysian launch price), the same brand's first (at least three),
 * for charging and software then the same brand's at any price from the last three years or two years either side
 * (at least three), then any brand's similar devices (at least six), else the lower quartile of devices of its kind
 * no newer than it. `kind` is 'metric' or 'category'. Null when nothing is known at all.
 */
const typicalCache = new Map();
export function typicalScore(category, deviceId, kind, id) {
  const key = `${category}|${deviceId ?? ''}|${kind}|${id}`;
  if (typicalCache.has(key)) return typicalCache.get(key);
  const list = (kind === 'metric' ? evidenceOf(category).metrics : evidenceOf(category).categories).get(id) ?? [];
  const row = deviceId ? store.deviceById.get(deviceId) : null;
  const year = launchYear(row);
  const price = launchPrice(row);
  const within = (x, from, to) => x.year && x.year >= from && x.year <= to;
  const similarPrice = (x) => price && x.price && x.price >= price / PRICE_BAND && x.price <= price * PRICE_BAND;
  const middle = (xs) => quantile(xs.map((x) => x.score), 0.5);
  let value = null;
  if (year) {
    const peers = list.filter((x) => within(x, year - 1, year) && similarPrice(x));
    const sameBrand = peers.filter((x) => x.brand === row.brand);
    if (sameBrand.length >= BRAND_PEERS_MIN) value = middle(sameBrand);
    if (value === null && BRAND_TRAITS.has(id)) {
      const brand = list.filter((x) => x.brand === row.brand);
      const earlier = brand.filter((x) => within(x, year - 2, year));
      const around = brand.filter((x) => within(x, year - 2, year + 2));
      if (earlier.length >= BRAND_PEERS_MIN) value = middle(earlier);
      else if (around.length >= BRAND_PEERS_MIN) value = middle(around);
    }
    if (value === null && peers.length >= PEERS_MIN) value = middle(peers);
  }
  if (value === null) {
    // the lower quartile of devices no newer than this one: a 2023 phone is not given a share of 2026 chips' scores
    let pool = year ? list.filter((x) => x.year && x.year <= year) : list;
    if (year && pool.length < PEERS_MIN) pool = list.filter((x) => x.year && x.year <= year + 1);
    if (pool.length < PEERS_MIN) pool = list;
    value = quantile(pool.map((x) => x.score), 0.25);
  }
  typicalCache.set(key, value);
  return value;
}

export function combineConfidence(used, coverage = 1) {
  if (!used.length) return 'low';
  const totalW = used.reduce((s, u) => s + u.w, 0);
  const avg = used.reduce((s, u) => s + u.w * (LEVEL_VALUE[u.confidence] ?? 0.25), 0) / totalW;
  let level = avg >= 0.85 ? 'high' : avg >= 0.5 ? 'medium' : 'low';
  const minCoverage = store.core?.scoring?.verdict?.minCoverage ?? 0.34;
  if (coverage < minCoverage) level = 'low';
  else if (coverage < 0.6 && level === 'high') level = 'medium';
  return level;
}

/**
 * Score one entity in one score category.
 * `pick(item)` may return the metric id to use for a scoring item (used for like-for-like comparisons);
 * by default the first alternative with evidence is used. Without a `pick`, a metric with no evidence counts as typical
 * for a similar device (`filled`, see typicalScore), as long as at least one metric has evidence; `coverage` is
 * still the share of the category that has evidence.
 */
export function categoryScore(entity, scoreCat, { pick, fill = !pick } = {}) {
  const category = entityCategory(entity);
  const items = scoreMetricsFor(scoreCat, category);
  if (!items.length) return null;
  const totalW = items.reduce((s, i) => s + i.w, 0);
  const used = [];
  const missing = [];
  for (const item of items) {
    const ids = item.alt ?? [item.id];
    // "combine": "mean" (Version 14): without a like-for-like pick, every alternative test the device has counts,
    // each scored against its own test's results, and the scores are averaged (several labs' battery tests, say).
    if (!pick && item.combine === 'mean') {
      const all = ids.map((i) => [i, getMetric(entity, i)]).filter(([i, m]) => m && labPlaceScore(i, m.value, category) !== null);
      if (!all.length) {
        missing.push(item);
        continue;
      }
      const [id, m] = all[0];
      const score = all.reduce((s, [i, mm]) => s + labPlaceScore(i, mm.value, category), 0) / all.length;
      const confidence = all.length > 1 && m.confidence !== 'high' ? (m.confidence === 'low' ? 'medium' : 'high') : m.confidence;
      used.push({ id, w: item.w, score, value: m.value, confidence, inherited: m.inherited, summary: m.summary, also: all.slice(1).map(([i]) => i) });
      continue;
    }
    const id = pick ? pick(item) : ids.find((i) => getMetric(entity, i));
    const m = id ? getMetric(entity, id) : null;
    const score = m ? itemScore(item, id, m.value, category) : null;
    if (score === null) {
      missing.push(item);
      continue;
    }
    used.push({ id, w: item.w, score, value: m.value, confidence: m.confidence, inherited: m.inherited, summary: m.summary });
  }
  if (!used.length) return null;
  const filled = [];
  if (fill && missing.length) {
    for (const item of missing) {
      for (const id of item.alt ?? [item.id]) {
        const score = typicalScore(category, entityId(entity), 'metric', id);
        if (score === null) continue;
        filled.push({ id, w: item.w, score });
        break;
      }
    }
  }
  const w = used.reduce((s, u) => s + u.w, 0);
  const all = [...used, ...filled];
  const coverage = w / totalW;
  return {
    score: all.reduce((s, u) => s + u.score * u.w, 0) / all.reduce((s, u) => s + u.w, 0),
    coverage,
    used,
    filled,
    confidence: combineConfidence(used, coverage),
    specOnly: used.every((u) => isSpecMetric(u.id)),
    anyInherited: used.some((u) => u.inherited),
  };
}

/** Score categories that apply to an entity's device category. */
export function applicableScoreCategories(category) {
  const cat = store.categoryById.get(category);
  const ids = cat?.scoreCategories ?? [];
  return ids.map((id) => store.scoreCategoryById.get(id)).filter(Boolean);
}

export function allCategoryScores(entity, options) {
  const out = {};
  for (const sc of applicableScoreCategories(entityCategory(entity))) {
    const result = categoryScore(entity, sc, options?.[sc.id] ? { pick: options[sc.id] } : undefined);
    if (result) out[sc.id] = result;
  }
  return out;
}

/**
 * Weighted profile score from category scores.
 * Only score categories that apply to the device category count toward coverage (a watch is not
 * penalised for having no camera score). `valueScore` (0–100) is optional.
 * With `fill` (the default), a category with no evidence at all counts as typical for a similar device (`id` names
 * the device; see typicalScore), so a gap doesn't lift a device; comparisons pass `fill: false` because they
 * already score every device on the same shared evidence. `coverage` is the share of the weight that has evidence.
 */
export function profileScore(catScores, profile, { category, valueScore = null, fill = true, id = null } = {}) {
  const applicable = new Set(applicableScoreCategories(category).map((c) => c.id));
  let sum = 0;
  let used = 0;
  let counted = 0;
  let total = 0;
  let allWeight = 0;
  const parts = [];
  for (const [catId, weight] of Object.entries(profile.weights)) {
    if (!weight) continue;
    allWeight += weight;
    if (catId !== 'value' && !applicable.has(catId)) continue;
    total += weight;
    const s = catId === 'value' ? (valueScore === null ? null : { score: valueScore, confidence: 'medium' }) : catScores[catId];
    if (!s) {
      const typical = fill && catId !== 'value' ? typicalScore(category, id, 'category', catId) : null;
      if (typical !== null && typical !== undefined) {
        sum += typical * weight;
        counted += weight;
        parts.push({ id: catId, weight, score: typical, confidence: 'low', typical: true });
      }
      continue;
    }
    sum += s.score * weight;
    used += weight;
    counted += weight;
    parts.push({ id: catId, weight, score: s.score, confidence: s.confidence });
  }
  if (!used) return null;
  // relevance: share of the profile's weight that applies to this device category at all.
  return { score: sum / counted, coverage: total ? used / total : 0, relevance: allWeight ? total / allWeight : 0, parts };
}

/** A user-defined profile from a weights object, e.g. { gaming: 3, battery: 2 } (weights are relative). */
export function customProfile(weights) {
  return { id: 'custom', label: 'Custom', description: 'Your own weighting.', weights };
}

// ------------------------------------------------------------------ database-wide rankings
const rankCache = new Map();
const MIN_COHORT = 4;

/**
 * Like-for-like rank of a device in a score category: it is ranked only against devices that
 * have evidence for every metric its own score uses, scored on those same metrics. This stops a
 * measured device from being ranked against devices scored on manufacturer claims alone.
 * Returns null when fewer than MIN_COHORT devices share that evidence.
 */
export function rankOf(deviceId, category, scoreCatId) {
  const key = `${deviceId}:${scoreCatId}`;
  if (rankCache.has(key)) return rankCache.get(key);
  let result = null;
  const sc = store.scoreCategoryById.get(scoreCatId);
  const target = store.deviceById.get(deviceId);
  const base = sc && target ? categoryScore(target, sc) : null;
  if (base) {
    const ids = base.used.map((u) => u.id);
    const cohort = store.devices.filter((d) => d.category === category && ids.every((id) => getMetric(d, id)));
    if (cohort.length >= MIN_COHORT) {
      const pick = (item) => (item.alt ?? [item.id]).find((id) => ids.includes(id));
      const scored = cohort
        .map((d) => ({ id: d.id, score: categoryScore(d, sc, { pick })?.score ?? -1 }))
        .sort((a, b) => b.score - a.score);
      const index = scored.findIndex((r) => r.id === deviceId);
      result = { position: index + 1, of: scored.length, percentile: scored.length > 1 ? index / (scored.length - 1) : 0, basis: ids };
    }
  }
  rankCache.set(key, result);
  return result;
}

/** Wording for a use case in titles: "for gaming", "for battery life"; the balanced profile reads "overall". */
export function profilePhrase(profile) {
  return !profile || profile.id === 'balanced' ? 'overall' : `for ${profile.label.toLowerCase()}`;
}

/** Value score: balanced profile score per unit of price, normalised to the best in `entities`. */
export function valueScores(entities, currency, balancedScores) {
  const raw = entities
    .map((e) => {
      const row = store.deviceById.get(entityId(e));
      const price = priceIn(row, currency);
      const balanced = balancedScores.get(entityId(e));
      return price && balanced ? { id: entityId(e), price, raw: balanced / price } : null;
    })
    .filter(Boolean);
  const best = Math.max(...raw.map((r) => r.raw), 0);
  return new Map(raw.map((r) => [r.id, { score: best ? (r.raw / best) * 100 : 0, price: r.price, currency }]));
}

/**
 * First currency in which every entity has a real launch price: the reader's currency if possible,
 * then USD. Converted prices are never used for value scoring.
 */
export function sharedCurrency(entities, preferred) {
  const sets = entities.map((e) => new Set((store.deviceById.get(entityId(e))?.prices ?? []).map((p) => p.currency)));
  if (!sets.length) return null;
  const order = [preferred, 'USD', 'EUR', 'GBP', 'MYR', 'SGD', 'CNY', 'INR'].filter(Boolean);
  const candidates = [...new Set([...order, ...sets[0]])];
  return candidates.find((c) => sets.every((s) => s.has(c))) ?? null;
}

/**
 * Currency for value scores across many devices (rankings): the one in which the most devices
 * have a real launch price, preferring the reader's currency on a tie. Devices without a price
 * in it get no value score rather than a converted one.
 */
export function rankingCurrency(rows, preferred) {
  const order = [preferred, 'USD', 'EUR', 'GBP', 'MYR', 'SGD', 'CNY', 'INR'].filter(Boolean);
  let best = null;
  let bestCount = 0;
  for (const code of new Set(order)) {
    const count = rows.filter((r) => priceIn(store.deviceById.get(entityId(r)), code)).length;
    if (count > bestCount) [best, bestCount] = [code, count];
  }
  return best;
}

/**
 * Best devices for a profile within a category (database-wide leaderboard).
 * `maxPrice` is { amount, currency }; prices are compared in that currency (converted where needed).
 */
export function profileLeaderboard(category, profileId, { maxPrice = null, limit = 10, currency = null, flagship = false } = {}) {
  const profile = store.profileById.get(profileId);
  if (!profile) return [];
  // devices on sale only: an announced phone is scored on pre-release listings at best (Version 11)
  let rows = store.devices.filter((d) => d.category === category && isOnSale(d) && (!flagship || d.flagship));
  if (maxPrice) rows = rows.filter((d) => (displayPrice(d, maxPrice.currency)?.amount ?? Infinity) <= maxPrice.amount);
  const balanced = store.profileById.get('balanced');
  const catScores = new Map(rows.map((d) => [d.id, allCategoryScores(d)]));
  const needsValue = 'value' in profile.weights;
  let values = new Map();
  const valueCurrency = needsValue ? rankingCurrency(rows, currency ?? maxPrice?.currency) : null;
  if (valueCurrency) {
    const balancedMap = new Map(rows.map((d) => [d.id, profileScore(catScores.get(d.id), balanced, { category, id: d.id })?.score]));
    values = valueScores(rows, valueCurrency, balancedMap);
  }
  return rows
    .map((d) => ({ id: d.id, result: profileScore(catScores.get(d.id), profile, { category, id: d.id, valueScore: values.get(d.id)?.score ?? null }), cats: catScores.get(d.id) }))
    .filter((r) => r.result && r.result.coverage >= 0.5 && r.result.relevance >= 0.5)
    .sort((a, b) => b.result.score - a.result.score)
    .slice(0, limit);
}

/** Top leaderboard for a single metric (e.g. Active Use Score). */
export function metricLeaderboard(category, metricId, { limit = 5, includeInherited = false } = {}) {
  const def = metricDef(metricId);
  return store.devices
    .filter((d) => d.category === category)
    .map((d) => ({ row: d, m: getMetric(d, metricId) }))
    .filter((x) => x.m && (includeInherited || !x.m.inherited))
    .sort((a, b) => (def?.better === 'lower' ? a.m.value - b.m.value : b.m.value - a.m.value))
    .slice(0, limit);
}
