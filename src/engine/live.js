// Live data that changes between builds: the latest headlines collected from registered sources.
//
// On the local server (serve.py), Refresh asks the server to collect them now (POST api/live/headlines).
// On a static host such as GitHub Pages that endpoint does not exist, so Refresh re-reads
// live/headlines.json, which the scheduled build rewrites every few hours.
// Both paths are relative, so the site also works from a sub-folder (username.github.io/repo/).

const HEADLINES = 'live/headlines.json';
const ENDPOINT = 'api/live/headlines';

export async function loadHeadlines() {
  const res = await fetch(`${HEADLINES}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`the headlines file could not be loaded (HTTP ${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data.items)) throw new Error('the headlines file is not in the expected format');
  return data;
}

/**
 * Returns { data, collectedNow, server, error }.
 * `server` is true when the local server answered; `collectedNow` is false when only the saved
 * collection was re-read (static hosting, the once-a-minute limit, or a failed collection: `error`).
 */
export async function refreshHeadlines() {
  let error = null;
  let server = false;
  try {
    const res = await fetch(ENDPOINT, { method: 'POST', headers: { Accept: 'application/json' }, cache: 'no-store' });
    if ((res.headers.get('content-type') ?? '').includes('application/json')) {
      const body = await res.json();
      server = true;
      if (res.ok && Array.isArray(body.items)) return { data: body, collectedNow: body.collectedNow !== false, server, error };
      error = body.error ?? `HTTP ${res.status}`;
    }
  } catch {
    // No local server (static hosting or offline): fall back to the saved collection below.
  }
  return { data: await loadHeadlines(), collectedNow: false, server, error };
}

/** Only http(s) links are ever rendered. */
export const isSafeUrl = (url) => /^https?:\/\//i.test(url ?? '');
