// Scoring: turns aggregated evidence (consensus values from the data build) into
// 0–100 category scores and use-case profile scores. Pure functions, no DOM.
//
// A metric score is relative to the best consensus value in the same device category:
//   higher-is-better  score = value / max            (log scale: ln(1+v) / ln(1+max))
//   lower-is-better   score = min / value
// A category score is the weighted mean of the metric scores that have evidence.

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
 * by default the first alternative with evidence is used.
 */
export function categoryScore(entity, scoreCat, { pick } = {}) {
  const category = entityCategory(entity);
  const items = scoreMetricsFor(scoreCat, category);
  if (!items.length) return null;
  const totalW = items.reduce((s, i) => s + i.w, 0);
  const used = [];
  for (const item of items) {
    const ids = item.alt ?? [item.id];
    const id = pick ? pick(item) : ids.find((i) => getMetric(entity, i));
    if (!id) continue;
    const m = getMetric(entity, id);
    if (!m) continue;
    const score = normalize(id, m.value, category);
    if (score === null) continue;
    used.push({ id, w: item.w, score, value: m.value, confidence: m.confidence, inherited: m.inherited, summary: m.summary });
  }
  if (!used.length) return null;
  const w = used.reduce((s, u) => s + u.w, 0);
  const coverage = w / totalW;
  return {
    score: used.reduce((s, u) => s + u.score * u.w, 0) / w,
    coverage,
    used,
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
 */
export function profileScore(catScores, profile, { category, valueScore = null } = {}) {
  const applicable = new Set(applicableScoreCategories(category).map((c) => c.id));
  let sum = 0;
  let used = 0;
  let total = 0;
  let allWeight = 0;
  const parts = [];
  for (const [catId, weight] of Object.entries(profile.weights)) {
    if (!weight) continue;
    allWeight += weight;
    if (catId !== 'value' && !applicable.has(catId)) continue;
    total += weight;
    const s = catId === 'value' ? (valueScore === null ? null : { score: valueScore, confidence: 'medium' }) : catScores[catId];
    if (!s) continue;
    sum += s.score * weight;
    used += weight;
    parts.push({ id: catId, weight, score: s.score, confidence: s.confidence });
  }
  if (!used) return null;
  // relevance: share of the profile's weight that applies to this device category at all.
  return { score: sum / used, coverage: total ? used / total : 0, relevance: allWeight ? total / allWeight : 0, parts };
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
export function profileLeaderboard(category, profileId, { maxPrice = null, limit = 10, currency = null } = {}) {
  const profile = store.profileById.get(profileId);
  if (!profile) return [];
  let rows = store.devices.filter((d) => d.category === category);
  if (maxPrice) rows = rows.filter((d) => (displayPrice(d, maxPrice.currency)?.amount ?? Infinity) <= maxPrice.amount);
  const balanced = store.profileById.get('balanced');
  const catScores = new Map(rows.map((d) => [d.id, allCategoryScores(d)]));
  const needsValue = 'value' in profile.weights;
  let values = new Map();
  const valueCurrency = needsValue ? rankingCurrency(rows, currency ?? maxPrice?.currency) : null;
  if (valueCurrency) {
    const balancedMap = new Map(rows.map((d) => [d.id, profileScore(catScores.get(d.id), balanced, { category })?.score]));
    values = valueScores(rows, valueCurrency, balancedMap);
  }
  return rows
    .map((d) => ({ id: d.id, result: profileScore(catScores.get(d.id), profile, { category, valueScore: values.get(d.id)?.score ?? null }), cats: catScores.get(d.id) }))
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
