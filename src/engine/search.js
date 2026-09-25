// Client-side search over the generated search index (devices, chipsets, brands,
// documents and sources). Handles aliases ("S26U"), "+" / "plus", prefixes and one-letter typos.

import { loadSearchIndex, store, deviceTitle, sourceName } from '../core/store.js';
import { loadMatchedItems } from './live.js';
import { GLOSSARY } from '../ui/plain.js';

export const TYPE_ORDER = ['device', 'chipset', 'brand', 'page', 'review', 'video', 'news', 'headline', 'source'];
export const TYPE_LABELS = {
  device: 'Devices',
  chipset: 'Chipsets',
  brand: 'Brands',
  review: 'Reviews & analysis',
  video: 'Videos',
  news: 'News',
  headline: 'Latest headlines, tests & videos',
  page: 'On this site',
  source: 'Sources',
};
const TYPE_BOOST = { device: 6, chipset: 4, brand: 3, page: 2, review: 0, video: 0, news: 0, headline: -1, source: 1 };

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

// The site's own pages and topics, so "how are scores calculated", "IP68", "size" or "charts" find the right place.
const SITE_PAGES = [
  { id: 'methodology', title: 'How scores are calculated', sub: 'Methodology', path: '/methodology', keys: ['methodology', 'scoring', 'score', 'weights', 'how it works', 'confidence', 'badges', 'evidence'] },
  { id: 'glossary', title: 'Tech words explained (glossary)', sub: 'Methodology', path: '/methodology', section: 'glossary', keys: ['glossary', 'what is', 'meaning', 'explain', 'ip68', 'ltpo', 'oled', 'amoled', 'mah', 'anc', 'nits', 'refresh rate', 'hz', 'ldac', 'codec', 'ois', 'telephoto', 'beginner'] },
  { id: 'charts', title: 'Charts: battery, performance, price, size', sub: 'Charts', path: '/charts', keys: ['charts', 'chart', 'graph', 'price vs', 'ranking', 'leaderboard'] },
  { id: 'coverage', title: 'What the hub covers, and new models spotted', sub: 'Coverage', path: '/coverage', keys: ['coverage', 'missing', 'new models', 'spotted', 'upcoming', 'database'] },
  { id: 'reviews', title: 'Reviews & videos', sub: 'Latest reviews and YouTube analysis', path: '/reviews', keys: ['reviews', 'videos', 'youtube', 'most viewed'] },
  { id: 'news', title: 'Technology news', sub: 'Latest news from Malaysian and global sources', path: '/news', keys: ['news', 'headlines', 'latest'] },
  { id: 'compare', title: 'Compare devices side by side', sub: 'Compare', path: '/compare', keys: ['compare', 'versus', 'vs', 'size comparison', 'to scale'] },
  { id: 'devices-earbuds', title: 'All earbuds', sub: 'Device database', path: '/devices/earbuds', keys: ['earbuds', 'tws', 'airpods', 'buds', 'earphones'] },
  { id: 'devices-tablet', title: 'All tablets', sub: 'Device database', path: '/devices/tablet', keys: ['tablets', 'ipad', 'pad'] },
  { id: 'devices-smartwatch', title: 'All smartwatches', sub: 'Device database', path: '/devices/smartwatch', keys: ['watches', 'smartwatch'] },
  { id: 'devices-band', title: 'All fitness bands', sub: 'Device database', path: '/devices/band', keys: ['bands', 'fitness band', 'tracker'] },
  { id: 'devices-smartphone', title: 'All smartphones', sub: 'Device database', path: '/devices/smartphone', keys: ['phones', 'smartphones'] },
];

const TOPIC_NAMES = { test: 'test benchmark', review: 'review', video: 'video youtube', software: 'software update', price: 'price deal', issue: 'problem issue bug', launch: 'launch', news: 'news' };

function prepare(e) {
  const keys = (e.keys ?? []).filter(Boolean);
  const tokens = new Set([...tokenize(e.title), ...keys.flatMap(tokenize)]);
  return { ...e, normTitle: normalizeText(e.title), compactTitle: compact(e.title), compactKeys: keys.map(compact), tokens: [...tokens] };
}

let headlinesPrepared = null;
/** Recent matched headlines (archive + newest), searchable by title, device names, source and topic. */
function headlineEntries() {
  headlinesPrepared ??= loadMatchedItems()
    .then((items) => items.map((i) => prepare({
      type: 'headline',
      id: i.id ?? i.url,
      title: i.title,
      url: i.url,
      topic: i.topic,
      date: i.published,
      sub: `${sourceName(i.source)}${i.published ? ` · ${String(i.published).slice(0, 10)}` : ''}`,
      keys: [...(i.devices ?? []).map((id) => { const r = store.deviceById.get(id); return r ? deviceTitle(r) : id; }), ...(i.chipsets ?? []).map((id) => store.chipsetById.get(id)?.name ?? id), sourceName(i.source), TOPIC_NAMES[i.topic] ?? ''],
    })))
    .catch(() => []);
  return headlinesPrepared;
}

export async function ensureSearchIndex() {
  if (!prepared) {
    // every glossary word is findable too ("what is LTPO"), and opens the glossary
    const glossary = GLOSSARY.map(([term, text]) => ({ type: 'page', id: `g-${term}`, title: `${term}: what it means`, sub: text.length > 90 ? `${text.slice(0, 88)}…` : text, path: '/methodology', section: 'glossary', keys: term.split(/[/()]/).map((k) => k.trim()).filter(Boolean) }));
    const entries = [...(await loadSearchIndex()), ...SITE_PAGES.map((p) => ({ ...p, type: 'page' })), ...glossary];
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
  const entries = [...(await ensureSearchIndex()), ...(!types || types.includes('headline') ? await headlineEntries() : [])];
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
  // "iphone 18 pro bug": no device matches every word, but the words before "bug" name one. Offer it too.
  if (!types && !results.some((r) => r.type === 'device') && qTokens.length > 1) {
    for (let n = qTokens.length - 1; n >= 1; n -= 1) {
      const sub = qTokens.slice(0, n).join(' ');
      if (sub.length < 3) break;
      const devs = [];
      for (const entry of entries) {
        if (entry.type !== 'device') continue;
        const score = scoreEntry(entry, normalizeText(sub), tokenize(sub), compact(sub));
        if (score >= 60) devs.push({ ...entry, score: score - 30 });
      }
      if (devs.length) {
        devs.sort((a, b) => b.score - a.score);
        results.unshift(...devs.slice(0, 3));
        break;
      }
    }
  }
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
