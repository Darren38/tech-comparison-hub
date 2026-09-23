// Tech Comparison Hub headline relay (a Cloudflare Worker).
//
// A browser may not read another site's news feed directly (the feed would need to allow it, and most
// don't), and GitHub Pages has no server of its own. This relay fetches a feed for the site and hands it
// back with permission for the site to read it.
//
// It only fetches the feed addresses the site itself publishes in live/config.json, so it cannot be
// used to reach any other address. Nothing is stored, and each feed is kept in Cloudflare's cache for
// two minutes, so many visitors pressing Refresh do not hit a publisher more than once in that time.
//
// Use: GET <relay address>/feed?url=<feed address from live/config.json>
// Setup: see relay/README.md. Settings (optional, under the Worker's Settings > Variables):
//   SITE             the site's address, ending in "/" (default below)
//   ALLOWED_ORIGINS  extra origins allowed to call the relay, separated by spaces

const DEFAULT_SITE = 'https://darren38.github.io/tech-comparison-hub/';
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const FEED_CACHE_SECONDS = 120;
const CONFIG_CACHE_SECONDS = 600;
const MAX_BYTES = 4_000_000;
const UA = 'Mozilla/5.0 (compatible; TechComparisonHub/12.0; headline relay)';

export default {
  async fetch(request, env = {}) {
    const site = env.SITE || DEFAULT_SITE;
    const origin = request.headers.get('Origin') || '';
    const allowed = [new URL(site).origin, ...String(env.ALLOWED_ORIGINS || '').split(/\s+/).filter(Boolean)];
    const cors = allowed.includes(origin) || LOCAL_ORIGIN.test(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    }
    if (request.method !== 'GET') return reply(405, 'Only GET is supported.', cors);

    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '') return reply(200, 'Tech Comparison Hub headline relay. It only fetches the feeds listed by ' + site, cors);
    if (url.pathname !== '/feed') return reply(404, 'Not found.', cors);

    const target = url.searchParams.get('url') || '';
    let feeds;
    try {
      feeds = await listedFeeds(site);
    } catch (error) {
      return reply(502, `The site's feed list could not be read (${error.message}).`, cors);
    }
    if (!feeds.has(target)) return reply(403, 'That address is not one of the feeds the site lists.', cors);

    let res;
    try {
      res = await fetch(target, {
        headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8' },
        cf: { cacheTtl: FEED_CACHE_SECONDS, cacheEverything: true },
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      return reply(502, `The feed could not be reached (${error.name === 'TimeoutError' ? 'timed out' : error.message}).`, cors);
    }
    if (!res.ok) return reply(502, `The feed answered HTTP ${res.status}.`, cors);
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return reply(502, 'The feed is larger than the relay passes on.', cors);
    return new Response(body, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': res.headers.get('Content-Type') || 'application/xml',
        'Cache-Control': `public, max-age=${FEED_CACHE_SECONDS}`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
};

async function listedFeeds(site) {
  const res = await fetch(new URL('live/config.json', site), {
    cf: { cacheTtl: CONFIG_CACHE_SECONDS, cacheEverything: true },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const config = await res.json();
  return new Set((config.feeds || []).map((f) => f.url));
}

function reply(status, text, cors) {
  return new Response(text, { status, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
}
