// Collect the latest headlines in the browser, through the relay (relay/worker.js).
//
// The same feeds and rules as tools/fetch_headlines.py: the feed list, the topic and review patterns and the
// device names come from live/config.json, which that script writes, so an item is kept and tagged the same
// way whichever collected it. Only the title, link, source, kind, date and the publisher's thumbnail address
// are kept; no article text.

const ATOM = 'http://www.w3.org/2005/Atom';
const MEDIA = 'http://search.yahoo.com/mrss/';
const CONTENT = 'http://purl.org/rss/1.0/modules/content/';
const DC = 'http://purl.org/dc/elements/1.1/';
const IMG_EXT = /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i;
const FEED_TIMEOUT_MS = 15000;
const PARALLEL = 6;

// Chinese brand names, read as the English ones (from live/config.json: the same list as tools/fetch_headlines.py)
let zhBrands = [];
// A feed date. Some Chinese feeds give "2026-09-24 12:07:30" with no offset; the feed's `tz` ("+08:00") says whose clock it is.
function parseFeedDate(text, tz) {
  const m = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d(?::\d\d)?)$/.exec(text);
  if (m) return new Date(`${m[1]}T${m[2]}${/^[+-]\d\d:\d\d$/.test(tz ?? '') ? tz : 'Z'}`);
  return new Date(text);
}

export function setZhBrands(list) {
  zhBrands = list ?? [];
}

export function normalize(text) {
  let t = String(text ?? '');
  for (const [zh, en] of zhBrands) t = t.split(zh).join(` ${en} `);
  return t
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/(\d)([a-z]{2,})\b/g, '$1 $2') // "17Pro", "X200Ultra" (Chinese headlines leave no space)
    .replace(/\b([a-z]{3,})(\d+)\b/g, '$1 $2') // "Fold8" reads the same as "Fold 8"
    .replace(/\s+/g, ' ')
    .trim();
}

let decoder;
function unescapeHtml(text) {
  if (!text.includes('&')) return text;
  decoder ??= document.createElement('textarea');
  decoder.innerHTML = text;
  return decoder.value;
}

const cleanTitle = (text) => unescapeHtml(String(text ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 220);

/** A direct child element by namespace (null = no namespace) and local name. */
const child = (node, ns, name) => [...node.children].find((c) => c.localName === name && (c.namespaceURI ?? null) === ns) ?? null;
const childText = (node, ns, name) => child(node, ns, name)?.textContent ?? null;

function feedImage(node) {
  const candidates = [...node.getElementsByTagNameNS(MEDIA, 'thumbnail')].map((t) => t.getAttribute('url'));
  for (const c of node.getElementsByTagNameNS(MEDIA, 'content')) {
    const url = c.getAttribute('url') ?? '';
    if (c.getAttribute('medium') === 'image' || (c.getAttribute('type') ?? '').startsWith('image') || IMG_EXT.test(url)) candidates.push(url);
  }
  for (const e of node.children) if (e.localName === 'enclosure' && !e.namespaceURI && (e.getAttribute('type') ?? '').startsWith('image')) candidates.push(e.getAttribute('url'));
  const body = (childText(node, null, 'description') ?? '') + (childText(node, CONTENT, 'encoded') ?? '') + (childText(node, ATOM, 'summary') ?? '');
  for (const m of body.matchAll(/<img[^>]+src=["']([^"']+)/g)) candidates.push(unescapeHtml(m[1]));
  for (let url of candidates) {
    url = (url ?? '').trim();
    if (url.startsWith('//')) url = `https:${url}`;
    if (url.startsWith('https://') && !/feedburner|pixel|tracking|gravatar|emoji|1x1/i.test(url)) return url.slice(0, 500);
  }
  return null;
}

/** The view count a YouTube feed publishes for a video (media:statistics views), or null. */
function feedViews(node) {
  const v = node.getElementsByTagNameNS(MEDIA, 'statistics')[0]?.getAttribute('views');
  return v != null && /^\d+$/.test(v) ? Number(v) : null;
}

/** [{ title, link, date, image, views }] from RSS 2.0 or Atom text; throws when it is not XML. */
export function parseFeed(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('not a readable feed');
  const out = [];
  for (const item of doc.getElementsByTagName('item')) {
    if (item.namespaceURI) continue;
    out.push({ title: childText(item, null, 'title'), link: childText(item, null, 'link'), date: childText(item, null, 'pubDate') ?? childText(item, DC, 'date'), image: feedImage(item), views: feedViews(item) });
  }
  for (const entry of doc.getElementsByTagNameNS(ATOM, 'entry')) {
    const link = [...entry.children].find((l) => l.localName === 'link' && l.namespaceURI === ATOM && (l.getAttribute('rel') ?? 'alternate') === 'alternate');
    out.push({ title: childText(entry, ATOM, 'title'), link: link?.getAttribute('href') ?? null, date: childText(entry, ATOM, 'published') ?? childText(entry, ATOM, 'updated'), image: feedImage(entry), views: feedViews(entry) });
  }
  return out;
}

/** The device names from live/config.json, indexed by their first word, longest first. */
function keyIndex(keys) {
  const byFirst = new Map();
  for (const [key, id] of keys) {
    const tokens = key.split(' ');
    if (!byFirst.has(tokens[0])) byFirst.set(tokens[0], []);
    byFirst.get(tokens[0]).push({ key, tokens, id });
  }
  return byFirst;
}

/** Device (or chipset) ids a headline names, in the same order tools/fetch_headlines.py finds them (longest name
 * first). A name several devices share ("iPad Air M4") links to all of them (Version 17). */
export function matchDevices(titleNorm, byFirst, nextReject, prevReject = new Set()) {
  const words = titleNorm ? titleNorm.split(' ') : [];
  const hits = [];
  words.forEach((w, i) => {
    for (const k of byFirst.get(w) ?? []) {
      if (k.tokens.some((t, j) => words[i + j] !== t)) continue;
      const next = words[i + k.tokens.length];
      if (next !== undefined && nextReject.has(next)) continue;
      if (i > 0 && prevReject.has(words[i - 1])) continue;
      hits.push({ ...k, start: i, end: i + k.tokens.length });
    }
  });
  hits.sort((a, b) => b.key.length - a.key.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) || a.start - b.start);
  const taken = [];
  const found = [];
  for (const h of hits) {
    if (taken.some(([s, e, key]) => h.start < e && h.end > s && key !== h.key)) continue;
    taken.push([h.start, h.end, h.key]);
    if (!found.includes(h.id)) found.push(h.id);
  }
  return found;
}

/** Version 17: which section of a device page a headline belongs to (the rules in tools/fetch_headlines.py). */
export function topicOf(title, kind, rules) {
  const test = rules.find(([name]) => name === 'test');
  if (test && test[1].test(title)) return 'test';
  if (kind === 'review' || kind === 'video') return kind;
  for (const [name, re] of rules) if (name !== 'test' && re.test(title)) return name;
  return 'news';
}

/** Compiled tagging rules from live/config.json: devices, chipsets and topic, as tools/fetch_headlines.py tags them. */
export function tagger(config) {
  const byFirst = keyIndex(config.keys ?? []);
  const chipsFirst = keyIndex(config.chipKeys ?? []);
  const nextReject = new Set(config.nextReject ?? []);
  const chipNext = new Set(config.chipNextReject ?? []);
  const chipPrev = new Set(config.chipPrevReject ?? []);
  const rules = (config.topicRules ?? []).map(([name, pattern]) => [name, new RegExp(pattern, 'i')]);
  // Version 18: section flags (ios, oneui, problem, chip, offer), as flags_of() in tools/fetch_headlines.py
  const flagRules = (config.flagRules ?? []).map(([name, pattern]) => [name, new RegExp(pattern, 'i')]);
  const offerRules = (config.offerRules ?? []).map((pattern) => new RegExp(pattern, 'i'));
  const offerMy = config.offerMy ? new RegExp(config.offerMy, 'i') : null;
  const mySources = new Set(config.mySources ?? []);
  const software = rules.find(([name]) => name === 'software')?.[1];
  const flagsOf = (title, source) => {
    const flags = flagRules.filter(([, re]) => re.test(title)).map(([name]) => name);
    if (flags.includes('problem') && !flags.includes('ios') && !flags.includes('oneui') && !software?.test(title)) flags.splice(flags.indexOf('problem'), 1);
    if (offerRules.length && offerRules.every((re) => re.test(title)) && (mySources.has(source) || offerMy?.test(title))) flags.push('offer');
    return flags;
  };
  setZhBrands(config.zhBrands);
  return (title, kind, source = '') => {
    const norm = normalize(title);
    const chipsets = matchDevices(norm, chipsFirst, chipNext, chipPrev);
    const flags = flagsOf(title, source);
    return { devices: matchDevices(norm, byFirst, nextReject), ...(chipsets.length ? { chipsets } : {}), topic: topicOf(title, kind, rules), ...(flags.length ? { flags } : {}) };
  };
}

async function sha1Hex(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const isoMinutes = (d) => `${d.toISOString().slice(0, 16)}+00:00`;
const isoSeconds = (d) => `${d.toISOString().slice(0, 19)}+00:00`;

async function fetchFeed(relay, url) {
  const res = await fetch(`${relay.replace(/\/+$/, '')}/feed?url=${encodeURIComponent(url)}`, { cache: 'no-store', signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 403 ? ' (not a listed feed)' : ''}`);
  return res.text();
}

/** Collect every listed feed through the relay. Returns data in the shape of live/headlines.json. */
export async function collectThroughRelay(config) {
  const now = new Date();
  const cutoff = now.getTime() - (config.maxAgeDays ?? 45) * 86400000;
  const perFeed = config.perFeed ?? 20;
  const tag = tagger(config);
  const noImage = new Set(config.noImageSources ?? []);
  const topic = new RegExp(`(?<![a-z0-9])(?:${(config.topicPatterns ?? []).join('|')})(?![a-z0-9])`);
  const review = new RegExp(config.reviewWords, 'i');
  const topicZh = config.topicPatternsZh ? new RegExp(config.topicPatternsZh) : null;
  const reviewZh = config.reviewWordsZh ? new RegExp(config.reviewWordsZh) : null;

  const texts = new Array(config.feeds.length);
  let next = 0;
  const worker = async () => {
    while (next < config.feeds.length) {
      const i = next++;
      try {
        texts[i] = { ok: true, text: await fetchFeed(config.relay, config.feeds[i].url) };
      } catch (error) {
        texts[i] = { ok: false, error: error.name === 'TimeoutError' ? 'timed out' : error.message };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, config.feeds.length) }, worker));

  const items = new Map();
  const feeds = [];
  for (const [i, feed] of config.feeds.entries()) {
    const status = { source: feed.source, kind: feed.kind };
    let parsed;
    try {
      if (!texts[i].ok) throw new Error(texts[i].error);
      parsed = parseFeed(texts[i].text);
    } catch (error) {
      feeds.push({ ...status, ok: false, kept: 0, error: String(error.message).slice(0, 120) });
      continue;
    }
    let kept = 0;
    for (const raw of parsed) {
      const title = cleanTitle(raw.title);
      const link = (raw.link ?? '').trim();
      if (!title || !/^https?:\/\//.test(link)) continue;
      const when = raw.date ? parseFeedDate(raw.date.trim(), feed.tz) : null;
      const published = when && !Number.isNaN(when.getTime()) ? when : null;
      if (published && published.getTime() < cutoff) continue;
      const norm = normalize(title);
      const kind = feed.kind === 'video' ? 'video' : review.test(title) || reviewZh?.test(title) ? 'review' : feed.kind;
      const tags = tag(title, kind, feed.source);
      if (!tags.devices.length && !topic.test(norm) && !topicZh?.test(title) && !tags.flags) continue;
      const id = (await sha1Hex(link)).slice(0, 12);
      if (items.has(id)) continue;
      items.set(id, {
        id,
        title,
        url: link,
        source: feed.source,
        ...(feed.lang ? { lang: feed.lang } : {}),
        kind,
        published: published ? isoMinutes(published) : null,
        ...tags,
        image: noImage.has(feed.source) ? null : raw.image,
        ...(raw.views != null ? { views: raw.views } : {}),
      });
      kept += 1;
      if (kept >= perFeed) break;
    }
    feeds.push({ ...status, ok: true, kept });
  }
  const ordered = [...items.values()].sort((a, b) => (b.published ?? '').localeCompare(a.published ?? '')).slice(0, config.maxItems ?? 240);
  return {
    fetchedAt: isoSeconds(now),
    maxAgeDays: config.maxAgeDays ?? 45,
    feeds: feeds.sort((a, b) => a.source.localeCompare(b.source)),
    items: ordered,
    collectedNow: true,
    live: true,
  };
}
