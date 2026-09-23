# Headline relay (live Refresh on GitHub Pages)

GitHub Pages only serves files, and a browser may not read most publishers' news feeds directly. So on the
live site, Refresh on the News and Reviews pages can only re-read the headlines the scheduled build saved
(every 3 hours). `worker.js` is a small relay that runs free on Cloudflare Workers. With it, Refresh and the
Ask panel collect the headlines live, straight from the publishers' feeds.

What it does and doesn't do:

- It fetches **only** the feed addresses the site lists in `live/config.json` (written by
  `tools/fetch_headlines.py` from `data/meta/live-feeds.json`). Any other address is refused, so it can't be
  used as a general proxy.
- It answers only the site itself (and `localhost` for testing), only `GET`, and passes the feed back
  unchanged. The browser then applies the same rules as the Python collector (`src/engine/collect.js`).
- Each feed is cached for two minutes, so many visitors pressing Refresh reach a publisher at most once in that
  time. Nothing is stored or logged by the relay's code.
- The free Workers plan allows 100,000 requests a day. One Refresh uses one request per feed (19), so that is
  about 5,000 refreshes a day.

## Setting it up (about 5 minutes, once)

1. Create a free account at <https://dash.cloudflare.com/sign-up> (only the site owner can do this).
2. In the dashboard: **Workers & Pages** → **Create** → **Create Worker** (the "Hello World" template).
   Name it `tech-hub-relay` and press **Deploy**.
3. Press **Edit code**, replace everything in `worker.js` with the contents of this folder's `worker.js`,
   and press **Deploy** again.
4. Copy the Worker's address, for example `https://tech-hub-relay.<your-subdomain>.workers.dev`.
   Opening it in a browser shows "Tech Comparison Hub headline relay…".
5. Put that address in `data/meta/live-feeds.json` as `"relay"` and push. The next build publishes it in
   `live/config.json`, and Refresh starts collecting live.

If the site moves to another address, set the Worker's `SITE` variable (Settings → Variables) to the new
address, ending in `/`. To switch live collection off, set `"relay"` back to `""`: Refresh then re-reads
the saved collection as before.

## Testing without Cloudflare

The worker only uses standard web APIs, so Node 18+ can run it for a local test: call its `fetch(request, env)`
with `env.SITE` set to a local copy of the site whose `live/config.json` has `"relay"` pointing at the test
server.
