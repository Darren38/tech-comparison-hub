// Client-side search over the generated search index (devices, chipsets, brands,
// documents and sources). Handles aliases ("S26U"), "+" / "plus", prefixes and one-letter typos.

import { loadSearchIndex } from '../core/store.js';

export const TYPE_ORDER = ['device', 'chipset', 'brand', 'review', 'video', 'news', 'source'];
export const TYPE_LABELS = {
  device: 'Devices',
  chipset: 'Chipsets',
  brand: 'Brands',
  review: 'Reviews & analysis',
  video: 'Videos',
  news: 'News',
  source: 'Sources',
};
const TYPE_BOOST = { device: 6, chipset: 4, brand: 3, review: 0, video: 0, news: 0, source: 1 };

export function normalizeText(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\+/g, ' plus ')
    .replace(/[()[\]{}.,:;!?'"’“”/\\|–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const compact = (text) => normalizeText(text).replace(/\s+/g, '');
const tokenize = (text) => normalizeText(text).split(' ').filter(Boolean);

function editDistanceWithin1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

let prepared = null;

export async function ensureSearchIndex() {
  if (!prepared) {
    const entries = await loadSearchIndex();
    prepared = entries.map((e) => {
      const keys = (e.keys ?? []).filter(Boolean);
      const tokens = new Set([...tokenize(e.title), ...keys.flatMap(tokenize)]);
      return {
        ...e,
        normTitle: normalizeText(e.title),
        compactTitle: compact(e.title),
        compactKeys: keys.map(compact),
        tokens: [...tokens],
      };
    });
  }
  return prepared;
}

function scoreEntry(entry, q, qTokens, qCompact) {
  if (!qTokens.length) return 0;
  if (entry.normTitle === q) return 100;
  if (entry.compactKeys.includes(qCompact) || entry.compactTitle === qCompact) return 95;
  let score = 0;
  if (entry.normTitle.startsWith(q)) score = 82;
  else if (entry.normTitle.includes(` ${q}`)) score = 70;

  // Every query token must match some entry token (prefix, or one typo for longer words).
  let matched = 0;
  let exact = 0;
  for (const qt of qTokens) {
    let hit = false;
    for (const t of entry.tokens) {
      if (t === qt) {
        hit = true;
        exact += 1;
        break;
      }
      if (t.startsWith(qt) && (qt.length >= 2 || /\d/.test(qt))) {
        hit = true;
        break;
      }
    }
    if (!hit && qt.length >= 4) hit = entry.tokens.some((t) => t.length >= 4 && editDistanceWithin1(qt, t));
    if (hit) matched += 1;
  }
  if (matched === qTokens.length) {
    score = Math.max(score, 50 + (exact / qTokens.length) * 20 - Math.max(0, entry.tokens.length - qTokens.length) * 0.4);
  } else if (!score) {
    return 0;
  }
  // Numbers are decisive: "s26" must not match "s25".
  const qNums = qTokens.filter((t) => /\d/.test(t));
  if (qNums.length && !qNums.every((n) => entry.tokens.some((t) => t.startsWith(n)))) return 0;
  return score + (TYPE_BOOST[entry.type] ?? 0);
}

/** Ranked flat list of matches. */
export async function search(query, { limit = 40, types } = {}) {
  const entries = await ensureSearchIndex();
  const q = normalizeText(query);
  if (!q) return [];
  const qTokens = tokenize(query);
  const qCompact = compact(query);
  const results = [];
  for (const entry of entries) {
    if (types && !types.includes(entry.type)) continue;
    const score = scoreEntry(entry, q, qTokens, qCompact);
    if (score > 0) results.push({ ...entry, score });
  }
  results.sort((a, b) => b.score - a.score || String(b.date ?? '').localeCompare(String(a.date ?? '')));
  return results.slice(0, limit);
}

/** Results grouped by type in a stable order. */
export function groupResults(results) {
  const groups = new Map(TYPE_ORDER.map((t) => [t, []]));
  for (const r of results) groups.get(r.type)?.push(r);
  return [...groups.entries()].filter(([, items]) => items.length).map(([type, items]) => ({ type, label: TYPE_LABELS[type], items }));
}

/** Best single device match for a phrase, or null if nothing convincing. */
export async function resolveDevice(phrase) {
  const [best] = await search(phrase, { limit: 1, types: ['device'] });
  return best && best.score >= 50 ? best : null;
}
