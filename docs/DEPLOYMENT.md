# Deployment

The site is static (HTML, CSS, JavaScript and JSON) and is published to GitHub Pages by the workflow in [`.github/workflows/pages.yml`](../.github/workflows/pages.yml). No server, database, API key or secret is needed.

## What the workflow does

It runs on every push to `main`, **every 3 hours**, **once a day at 00:05 UTC (08:05 Malaysia time)**, and on demand (Actions tab > **Build and deploy** > **Run workflow**):

1. `tools/update_rates.py` downloads Bank Negara Malaysia's latest exchange rates. If Bank Negara is unreachable, the rates in the repository are used.
2. `tools/fetch_headlines.py` collects the latest headlines from the feeds in `data/meta/live-feeds.json`. Feeds that fail are skipped; if all fail, the committed `live/headlines.json` is used.
3. `tools/build.py` validates `data/` and compiles `generated/`. **If the data has an error, the run stops and the previous deployment stays online.**
4. The site files (`index.html`, `sw.js`, `assets/`, `src/`, `generated/`, `live/`) are published.

Refreshed rates and headlines are not committed back; each run fetches its own.

## First-time setup

1. Push this repository to GitHub.
2. Settings > Pages > Build and deployment > Source: **GitHub Actions**.
3. Run the workflow once from the Actions tab (a push also starts it). The site appears at `https://<owner>.github.io/<repository>/` after about a minute.

Every path the site uses is relative, so it works from that sub-folder, from a custom domain, or from any other static host.

## What updates by itself

| Part | How often | Source | If the source is down |
| --- | --- | --- | --- |
| Exchange rates | Every 3 hours, and in each visitor's browser if the published rates are not from today (Malaysia time) | Bank Negara Malaysia; the browser falls back to ExchangeRate-API | The last rates stay in use, labelled with their date |
| Latest headlines, videos and YouTube view counts | Every 3 hours | Public RSS feeds; videos through the YouTube Data API (needs the `YOUTUBE_API_KEY` secret) | The previous collection stays; without the key the videos collected earlier stay |
| iOS releases and betas, Samsung's monthly security update, Apple Malaysia service programmes, Samsung Malaysia service pages | At most every 6 hours | `tools/fetch_official.py`: Apple's and Samsung's own pages (Samsung's service pages are checked for offer wording, dates and regions, and for changes) | The saved part stays |
| Benchmark databases (UL 3DMark device pages, DXOMARK's public list, AnTuTu's ranking) | Once a day; later runs that day reuse the result from the Actions cache | `tools/refresh_benchmarks.py`: only phones already matched in `data/benchmarks/`; changes over 30% are held, not applied | That source keeps its saved values |
| Test results for phones not matched by hand yet (3DMark, DXOMARK, AnTuTu) | Once a day, same cache | `tools/auto_benchmarks.py`: exact model name, plus the same chip where the source names one; DXOMARK must match the full name including "5G"; changes over 30% are held | That source keeps its saved matches |
| Geekbench 6 averages (CPU chart) | About once a week | `tools/auto_benchmarks.py`: NanoReview device pages, matched by exact name and chip | The saved averages stay |
| Device pictures | Once a day, same cache | `tools/check_images.py` | A picture that no longer loads shows the outline drawing |
| Pictures for devices without one, and where the product sits in new pictures | Every 3 days | `tools/find_images.py`, `tools/image_boxes.py` | Nothing changes until the next week |
| Specs, tests, prices, findings | When `data/` changes | Checked by hand | — |

On the live site, **Refresh** loads the newest collection; it cannot collect on the spot, because GitHub Pages cannot run code. Run `python serve.py` locally and Refresh collects immediately.

## Live Refresh (optional relay)

A browser may not read most publishers' feeds directly, and GitHub Pages has no server, so on the published site Refresh needs a relay to collect headlines on the spot. `relay/worker.js` is a Cloudflare Worker (free plan) that fetches only the feed addresses the site publishes in `live/config.json`, answers only the site's own origin, and caches each feed for two minutes. Setup steps are in [relay/README.md](../relay/README.md); put the Worker's address in `data/meta/live-feeds.json` as `"relay"`. With `"relay": ""`, Refresh re-reads the collection saved by the last scheduled run, as before.

## Good to know

- **The schedule keeps itself on.** GitHub pauses scheduled workflows after 60 days without repository activity; the daily run's `keepalive` job uses GitHub's "enable workflow" switch so that never happens (no commits are made). If it ever did, a push or **Enable workflow** in the Actions tab restarts them.
- **YouTube Data API key.** YouTube's robots.txt asks automated readers not to fetch its channel feeds, so videos are read through the official API. Create a key in Google Cloud (enable *YouTube Data API v3*, create an API key restricted to that API) and add it as the repository secret `YOUTUBE_API_KEY` (Settings > Secrets and variables > Actions). The site uses about 250 of the free 10,000 daily units.
- **Security.** See [SECURITY.md](../SECURITY.md): a Content Security Policy on every page, only `http(s)` links from feeds, a read-only build with GitHub's actions pinned to exact commits, and no workflow trigger that runs other people's code.
- **Some sites block cloud servers.** A feed that works locally but keeps failing in Actions shows as unreachable in the headline panel's status line. Replace or remove it in `data/meta/live-feeds.json`.
- **Visitors always get the latest version.** GitHub Pages lets browsers keep files for about ten minutes. The site's `sw.js` makes each visitor's browser check for newer files on every load, so an update shows on the next refresh. It needs HTTPS (which Pages provides) and never touches an AI model a visitor downloaded.
- **AI answers need nothing from the server.** The optional on-device models are downloaded by each visitor's browser from Hugging Face (WebLLM from jsDelivr) only after they agree; the site hosts no model and has no API key.
- **Device pictures load from Wikimedia Commons.** If Commons is unreachable, cards show the to-scale outline instead.
- **Custom domain:** Settings > Pages > Custom domain, then add the DNS records GitHub shows.
