// Live data that changes between builds: the latest headlines collected from registered sources.
//
// Refresh collects them now, by the first of these that is available:
//   1. the local server (serve.py): POST api/live/headlines;
//   2. the relay (relay/worker.js), when live/config.json names one (Version 12): the browser fetches each
//      listed feed through it and applies the same rules as tools/fetch_headlines.py (engine/collect.js);
//   3. otherwise the collection the scheduled build saved in live/headlines.json (every few hours).
// A live collection is kept for this visit, so the pages and the Ask panel show the newest one.
// All paths are relative, so the site also works from a sub-folder (username.github.io/repo/).

const HEADLINES = 'live/headlines.json';
const CONFIG = 'live/config.json';
const ENDPOINT = 'api/live/headlines';
const FRESH_MS = 5 * 60 * 1000; // a live collection younger than this is reused rather than collected again

let latest = null; // { data, at } from the last live collection in this visit
let pending = null;
let configPromise = null;

async function savedHeadlines() {
  const res = await fetch(`${HEADLINES}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`the headlines file could not be loaded (HTTP ${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data.items)) throw new Error('the headlines file is not in the expected format');
  return data;
}

/** live/config.json (feeds, rules and the relay address), or null when it is missing. */
function liveConfig() {
  configPromise ??= fetch(`${CONFIG}?t=${Date.now()}`, { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  return configPromise;
}

/** True when this copy of the site can collect headlines live (a relay is configured). */
export async function canCollectLive() {
  const config = await liveConfig();
  return Boolean(config?.relay && config.feeds?.length);
}

/** The newest headlines available without collecting: this visit's live collection, else the saved file. */
export async function loadHeadlines() {
  if (latest) return latest.data;
  return savedHeadlines();
}

/**
 * Collect now. Returns { data, collectedNow, server, live, error }.
 * `server` is true when the local server answered, `live` when the relay collected; `collectedNow` is false
 * when only the saved collection was re-read (static hosting without a relay, the once-a-minute limit, or a
 * failed collection: `error`).
 */
export async function refreshHeadlines() {
  pending ??= collectNow().finally(() => {
    pending = null;
  });
  return pending;
}

async function collectNow() {
  let error = null;
  let server = false;
  try {
    const res = await fetch(ENDPOINT, { method: 'POST', headers: { Accept: 'application/json' }, cache: 'no-store' });
    if ((res.headers.get('content-type') ?? '').includes('application/json')) {
      const body = await res.json();
      server = true;
      if (res.ok && Array.isArray(body.items)) {
        latest = { data: body, at: Date.now() };
        return { data: body, collectedNow: body.collectedNow !== false, server, live: false, error };
      }
      error = body.error ?? `HTTP ${res.status}`;
    }
  } catch {
    // No local server (static hosting or offline): try the relay, then the saved collection.
  }
  if (!server) {
    const config = await liveConfig();
    if (config?.relay && config.feeds?.length) {
      try {
        const { collectThroughRelay } = await import('./collect.js');
        const data = await collectThroughRelay(config);
        if (data.feeds.some((f) => f.ok)) {
          latest = { data, at: Date.now() };
          return { data, collectedNow: true, server, live: true, error };
        }
        error = 'no feed could be reached through the relay';
      } catch (e) {
        error = `the relay could not be used (${e.message})`;
      }
    }
  }
  // a failed collection keeps this visit's newer live collection, if there is one
  return { data: latest?.data ?? (await savedHeadlines()), collectedNow: false, server, live: false, error };
}

/**
 * Headlines for the Ask panel: collected live when this copy can (reusing one from the last five minutes),
 * else the saved collection. Returns { data, live }.
 */
export async function latestHeadlines() {
  if (latest && Date.now() - latest.at < FRESH_MS) return { data: latest.data, live: true };
  const res = await refreshHeadlines();
  return { data: res.data, live: res.collectedNow };
}

/** Only http(s) links are ever rendered. */
export const isSafeUrl = (url) => /^https?:\/\//i.test(url ?? '');

// YouTube view counts by video id (live/views.json, Version 16), read once per visit.
let viewsPromise = null;
export function loadViews() {
  viewsPromise ??= fetch('live/views.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return viewsPromise;
}
export const youtubeId = (url) => /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/.exec(url ?? '')?.[1] ?? null;


// ------------------------------------------------------------------ Version 17: archive + newest headlines
const ARCHIVE = 'live/archive.json';
let merged = null;

/**
 * Every matched headline the site knows: the rolling archive the scheduled build keeps (live/archive.json, about 400
 * days, re-matched on every run) plus the newest collection, one entry per article, newest first. Cached for the visit.
 */
export function loadMatchedItems() {
  merged ??= Promise.all([
    fetch(`${ARCHIVE}?t=${Math.floor(Date.now() / 600000)}`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] })),
    loadHeadlines().catch(() => ({ items: [] })),
  ]).then(([archive, latestItems]) => {
    const byKey = new Map();
    for (const item of [...(latestItems.items ?? []), ...(archive.items ?? [])]) {
      if (!isSafeUrl(item.url)) continue;
      const key = item.id ?? item.url;
      if (!byKey.has(key)) byKey.set(key, item);
    }
    return [...byKey.values()].sort((a, b) => String(b.published ?? '').localeCompare(String(a.published ?? '')));
  });
  return merged;
}
