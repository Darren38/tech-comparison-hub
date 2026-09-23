# Architecture

## Goals for this stage

- A working research platform now: homepage, database, device, chipset and compare pages, search, filters, and source attribution throughout.
- A data layer that can grow from 44 devices to thousands without rewriting the UI.
- Nothing to install beyond Python, and deployable to any static host (GitHub Pages included, with a ready workflow since Version 5).
- A clean path to a framework UI, a real API and an AI assistant later, without throwing work away.

## Stack decision

| Layer | Choice | Why |
| --- | --- | --- |
| UI | Native ES modules, no framework, no bundler | No Node.js toolchain to install or maintain, and no over-engineering. Modules load natively; each page is a lazily imported module. |
| Templating | `src/lib/html.js`: a tagged template that escapes every value by default | Safe against HTML injection from data, and readable. Easy to replace with React later. |
| Styling | Plain CSS with design tokens (`assets/css/tokens.css`), light and dark themes | No build step; tokens make a redesign or a framework move cheap. |
| Routing | Hash router (`#/device/<id>`) | Works on static hosts with no server rewrites. |
| Data | JSON source files compiled by `tools/build.py` | Validation, consensus and confidence computed once, at build time, in one place. |
| Dev server | `serve.py` (Python standard library) | Refreshes rates and headlines, builds the data, serves with the correct MIME types and no caching, and answers the Refresh button (`POST api/live/headlines`). |
| Hosting | GitHub Pages via GitHub Actions (`.github/workflows/pages.yml`) | Free static hosting; a scheduled run keeps rates and headlines fresh without a server. See `docs/DEPLOYMENT.md`. |

**Why not React/Vite now?** It would need a Node toolchain installed first. The value of Version 1 is in the data model, the evidence engine and the UX, and all of those carry over: `engine/` and `core/` are pure modules with no DOM access, and pages are plain functions returning markup. A later version can move the pages to React components and keep the engine and data layer unchanged.

## Folder structure

```text
./
├── index.html               app shell (header, main, footer, compare tray)
├── serve.py / start.bat     live-data refresh + build + local server (with the headlines endpoint)
├── README.md, CONTRIBUTING.md, CHANGELOG.md, LICENSE
├── sw.js                    service worker: every load checks the server for newer site files
├── .github/workflows/       pages.yml: scheduled build and deploy
├── assets/css/              tokens, base, components, pages
├── src/
│   ├── main.js              boot, route table (lazy imports), global events, picture fallback, live-rate check
│   ├── core/                store.js (data access), router.js, state.js (compare tray, theme, currency)
│   ├── engine/              scoring, compare, search, intent, money (incl. live rates), live (headlines), evidencePack
│   ├── ui/                  components (incl. deviceMedia, pageOutline), charts, layout (header/footer/tray/search box)
│   ├── pages/               one module per route
│   └── lib/                 html templating, formatting
├── data/                    source of truth (see DATA_MODEL.md), plus data/schema/ JSON Schemas
├── live/headlines.json      latest headlines (written by tools/fetch_headlines.py)
├── live/config.json         feeds, match rules and relay address for collecting in the browser (Version 12)
├── relay/worker.js          Cloudflare Worker: fetches listed feeds for the browser (Version 12; see relay/README.md)
├── tools/build.py           validate → aggregate → compile (+ --report for evidence coverage)
├── tools/update_rates.py    Bank Negara Malaysia rates → data/meta/currencies.json
├── tools/fetch_headlines.py registered RSS/YouTube feeds → live/headlines.json
├── tools/add_photo.py       attach a freely licensed Wikimedia Commons picture to a device
├── tools/new_device.py      scaffold a correctly structured device file
├── generated/               build output (never edited by hand; not committed)
└── docs/                    this documentation
```

## Runtime flow

```text
index.html → main.js
  ├─ loadCore(): core.json + index/devices.json + index/chipsets.json + index/documents.json (in parallel)
  ├─ render header, footer, compare tray
  └─ router → import('./pages/<page>.js') → page.render({params, query}) → {title, html, mount()}
                         │
                         ├─ core/store.js    loadDevice(id) / loadChipset(id) / loadSource(id) on demand (cached)
                         ├─ engine/*         scoring, verdicts, search, intent (pure functions)
                         └─ ui/*             components and charts (return html`` templates)
```

- **Data access** goes only through `core/store.js`. Replacing static JSON with an API (for example `/api/devices/:id`) touches that one file.
- **Pages** return markup plus an optional `mount(root)` for interactive bindings. Global behaviour (compare toggles, theme, menu) uses event delegation in `main.js`.
- **Loading, error and empty states** are shared components. A failed fetch shows a retry, and opening the site from `file://` explains how to run the server instead. An id that isn't in the database (404) shows the not-found page instead of an error.
- **Changing the currency** stores the choice (`core/state.js`) and calls `refreshRoute()` (`core/router.js`), which re-renders the current page in place and keeps the scroll position.

## Build pipeline (`tools/build.py`)

1. **Load** every JSON file in `data/`.
2. **Validate**: unique ids, references (brand, category, chipset, source, metric, subject), date formats, evidence classes, plausible value ranges per metric, scoring configuration, featured comparisons. Errors stop the build; warnings are reported (`--strict` treats warnings as errors for CI).
3. **Derive spec records**: spec fields become metric records carrying their field-level provenance (official, estimated or platform-calculated).
4. **Collect evidence records** from documents, resolving the origin (the original tester) separately from the publisher.
5. **Aggregate** per subject and metric: median per origin, then median across origins; range, spread and confidence with a written reason; chipset consensus from chip-level and device-level results; inheritance for untested devices (flagged).
6. **Compile** indexes, one file per device, chipset and source, the search index and head-to-head tables. Output is written to a staging folder and swapped in, so a failed build never leaves a half-written `generated/`.

## Scaling to thousands of devices

- Device detail is **one file per device**, loaded on demand; list and search pages use a compact index row (about 1 KB per device). At 2,000 devices the index is about 2 MB uncompressed (~300 KB gzipped), which is still fine. Past that:
  - shard `index/devices.json` by category (the build already groups by category), and
  - move search to a prebuilt inverted index or a small search service.
- Aggregation is linear in the number of records. The build runs in well under a second today, and even hundreds of thousands of records stay in the seconds range.
- Data is organised **by document**, the natural unit of evidence entry: one review page, video or database snapshot. Contributors add documents without touching device files.

## AI-ready evidence layer

The architecture separates the stages an AI assistant would need:

```text
question ─► engine/intent.js ─► retrieval ─► engine/evidencePack.js ─► LLM ─► answer with citation ids ─► claim check
            (who, what, use case)   (device files)  (cited, class-labelled JSON)
```

- `intent.js` already turns phrasing such as “S26 Ultra vs iPhone 17 Pro Max for photography” or “best gaming phone under RM4,000” (any supported currency symbol, or “4k”) into structured intents.
- `evidencePack.js` builds the grounded input: specs, consensus metrics with every source value, reviewer findings, news, and the platform's own verdicts, each tied to a citation id, plus instructions to answer only from the evidence. The compare page exports it today.
- A future assistant would send the pack to a Claude model, require citation ids on every claim, then verify that each cited id exists and supports the claim before showing the answer.

## Accessibility and responsiveness

- Landmarks, skip link, visible focus styles, an ARIA combobox for search suggestions, real text for every chart value (bars are HTML; the dot plot has a text alternative), and badges that never rely on colour alone (letters and shapes).
- Layouts are fluid grids that collapse to one column. Wide tables scroll inside their own container, and the comparison tables keep the label column sticky.
- `prefers-reduced-motion` and `prefers-color-scheme` are respected, with a manual theme toggle.

## Display currency (Version 3)

- Rates live in `data/meta/currencies.json` and reach the app through `core.json`. The build validates them.
- `engine/money.js` is the only place that decides what price to show. `displayPrice(row, currency)` returns the amount, whether it is a real local launch price, and the recorded price it came from. `priceText()` adds the ≈ marker for conversions and `priceExplanation()` writes the tooltip (original price, rate, date). `convert()` goes through MYR.
- `ui/components.js` `priceTag()` renders that result everywhere prices appear: device cards, the browse table, comparison headers. The device page lists the converted estimate first, then every recorded launch price.
- **Typical values for missing evidence (Version 11).** `typicalScore(category, deviceId, kind, id)` returns the score a device is given for evidence it doesn't have, cached per device and metric: similar devices by brand, year and launch price → the brand's own recent devices for charging and software → any brand's similar devices → the lower quartile of devices no newer than it. `categoryScore(entity, sc, { pick, fill })` returns `filled` beside `used` and keeps `coverage` as the real share; `profileScore(cats, profile, { category, id, fill })` fills whole missing categories the same way and marks those parts `typical`. `fill` defaults to off wherever a `pick` makes the scoring like-for-like, so comparisons are untouched. `isOnSale(row)` keeps announced and pre-order devices out of `profileLeaderboard` and last in the database ranking view.
- Value scoring stays in `engine/scoring.js` and uses only real prices: `sharedCurrency(entities, preferred)` for comparisons, `rankingCurrency(rows, preferred)` for rankings.
- `lib/format.js` `fmtPrice()` uses a fixed symbol per currency (RM, $, €, £, S$, CN¥, ₹), so “$” only ever means US dollars.
- **Availability (Version 4).** `availabilityIn(row, currency)` maps the chosen currency to its region (`region` in `currencies.json`) and returns why a device has no launch price there (not sold, no launch found, no verified price). `priceTag()` shows it in short form (“not sold in MY”); the device page shows the full reason with its source and check date.

## Data freshness (Version 4)

The build writes `build.data` into `core.json`:
- `asOf`: the newest date any value was read (document `accessed`, spec `checked`, price `accessed`, availability `checked`);
- `announcedFrom` and `announcedTo`: the launch window;
- `ratesAsOf`: the exchange-rate date.

The footer and the methodology page read these fields, so the stated cut-off always comes from the data itself rather than from the build time.

## Live data (Version 5)

Two things change between data edits, and each has a server side and a browser side:

```text
                    local (serve.py)                                GitHub Pages (pages.yml, every 3 h)
rates      start-up: tools/update_rates.py ─┐                 build: tools/update_rates.py ─┐
                                            ├─ currencies.json → core.json                   │
           browser: engine/money.js refreshRatesLive() — if asOf < today (Asia/Kuala_Lumpur), fetch ExchangeRate-API,
                    cache 3 h, replace store.core.currencies, re-render footer and page
headlines  start-up + POST api/live/headlines (≤ 1/min) ─┐    build: tools/fetch_headlines.py ─┐
                                                          ├─ live/headlines.json ◄──────────────┘
           browser: engine/live.js refreshHeadlines() — POST the endpoint; if there is no JSON answer (static host),
                    collect through the relay named in live/config.json (engine/collect.js, Version 12);
                    otherwise re-read live/headlines.json
```

- Bank Negara Malaysia's API does not allow browser requests (no CORS), so it is read at build time. ExchangeRate-API does allow them, so it is the browser's fallback.
- `pages/feed.js` renders the panel. It shows 12 items (6 on phones), marks items that were not in the previous list as New, filters to matched devices, keeps relative times current with a 60-second timer (cleared when the page unmounts), and reports every outcome in a `role="status"` line. Only `http(s)` links are rendered, and titles go through the escaping template.
- All paths are relative (`live/…`, `api/…`, `generated/…`), so the site works from a sub-folder.

## Pictures (Versions 5 and 6)

`ui/components.js` `deviceMedia(row, {size})` renders the device's Commons picture (`card` 64 × 92 cover crop using `focus`, or `hero`), with the to-scale `schematic()` hidden beside it. `main.js` listens for image `error` events in the capture phase and swaps in the outline, so an unreachable Wikimedia never leaves a broken image. `photoCredit()` writes the attribution line.

Version 6 adds `kind: "official"`: `deviceMedia` shows the maker's image contained (not cropped) on a light panel, with `referrerpolicy="no-referrer"`, and `photoCredit()` credits the maker's page.

## Ask the hub (Version 6)

- `src/ui/assistant.js` mounts the **Ask** launcher and panel once (from `main.js`): a dialog on wide screens and a bottom sheet at 640 px and below. The launcher and panel move up when the compare tray is open. The engine module loads on first open. It reads the current route for context (`/device/:id`, `/compare/:ids`), keeps up to 40 messages, remembers the devices of the last answer for "it" and "them", and closes with Esc. Any element with `data-ask-question` (the device page's "Ask about this device" card) opens the panel and asks.
- `src/engine/assistant.js` exports `ask(question, context)` and `suggestions(context)`:
  - **Devices**: exact names, titles and aliases in a compacted form; "5G"-less forms and brand-less short forms ("S24", "Reno14") only when no other device shares them; a continuation guard ("S24" never matches "S24 Ultra" or "S245"); the longest match wins; fuzzy search as a fallback.
  - **Attributes**: price, battery, charging, display, chip, performance, memory, cameras, weight, size, water, release, software and network, by keyword.
  - **Shapes**: one device (facts with sources), comparison (table plus verdicts), ranking (by the asked attribute, with brand, year, budget, 5G, foldable and Malaysia filters), best-for (the scoring engine's profile leaderboard), lists, and help texts about the site.
- Answers are built with the escaping `html` template. Values come from `store` rows or the device file, and sources from `provenanceFor`.

## On-device AI answers (Versions 9 and 10)

Three stages: the model reads the question, plain code looks the answer up, the model explains it. Nothing reaches an AI service.

Version 10 additions:
- `engine/assistant.js` turns the whole record into text: `specSheetText(id, { sections, skip })` (the category's spec sections, band lists and module details only when asked), `differencesText(ids)` → `{ differences, same, partial, detail }` (a field recorded for only some devices is a gap, not a difference; `detail` holds values that are the same thing worded with more detail for one, "IP68" / "IP68 (6 m, 30 min)", via `moreDetail()`), `scoresText(id)` (category scores, like-for-like ranks, strong and weak areas as on the device page), `pricesText(id)`, `reviewsText(id)` (document findings, measured records with publishers, news summaries, titles of linked but unsummarised videos) and `headlinesText(id)` (collected headlines tagged with the device), plus `sectionsFor(attributes)`.
- `engine/ai-agent.js` `lookUp()` assembles those per intent into titled sections (KEY FACTS, SPECIFICATIONS, DIFFERENCES, THE SAME ON BOTH, WORDED DIFFERENTLY, RECORDED FOR ONLY ONE, SCORES, MALAYSIAN LAUNCH PRICES, REVIEWS AND TESTS, LATEST HEADLINES, ACROSS THE DATABASE, BACKGROUND), drops the least important first to fit `ctx.budget`, and returns `deviceFacts` (each device's own texts, ranking line and comparison-table column, under its full names and any brand-less name unique among the devices, such as "Note 15 Pro+ 5G" or "S23") for the per-device figure check, and `ranked` with the same names for the ranking check. `reconcile()` also clears a verdict's specs when the visitor named none, and turns a "… specs" verdict into a specification question. New intents: `differences`, `reviews`, `news`, backed by keyword rules in `reconcile()`. `writeSystem(language, intent)` gives each kind of question its own task.
- `engine/ai.js`: WebLLM runs with an 8,192-token context window (`context_window_size`) and answers up to 420 tokens; each back-end has a `factsBudget` (15,000 characters for WebLLM; for the browser's built-in model, derived from its context window). The checks accept differences worked out from two figures in the same sentence and comparisons with both figures in view; the tie check fires only when an answer names a winner. New checks: `comparesBackwards()` ("heavier at 211 g than 249 g"; a sentence starting "this"/"it" may use the figure in the sentence before), `OWN_TESTS` (a publisher's test presented as the site's own), strengths and weak points per device (`standings` from its SCORES line) and per clause. `MODELS` lists Qwen3.5 2B and 4B; 9B was tested and dropped (see the methodology).
- `ui/assistant.js` passes the budget, lists the extra data in "What I looked up", and adds a closed "Show all the data the AI was given" block. The offer recommends Qwen3.5 4B when `deviceSupport()` says the device is strong enough (a model already saved in the browser is listed first), and when the built-in AI fails its check it offers 4B, then 2B.

- `engine/ai.js` — the back-ends and the checks.
  - `deviceSupport()`: WebGPU adapter (`shader-f16` picks the `q4f16_1` builds), a cautious "strong" flag for offering the 4B model, and `LanguageModel.availability()` for the browser's own model.
  - `class WebLLMBackend`: `savedIn()` / `isDownloaded()` (looks in Cache Storage and IndexedDB), `load(onProgress)` (imports WebLLM 0.2.85 from jsDelivr, runs it in `engine/ai-worker.js`; falls back to `cacheBackend: 'indexeddb'` when the browser refuses a large file, and `cancel()` stops a stalled download), `plan(system, user, schema)` (JSON forced to the schema by grammar-constrained decoding, temperature 0), `write(system, user, onText)` (streamed, temperature 0, `frequency_penalty` 0.4, `max_tokens` 420, `enable_thinking: false`), `stop()`, `remove()`.
  - `class BuiltinBackend`: the same two methods on Chrome's Prompt API (`responseConstraint` for the plan, `promptStreaming` for the text), with a one-off `probe()` that rejects a browser that only echoes the prompt or has too small a context window.
  - Checks: `checkAnswer(answer, facts, { question, ranked, echo, devices })` splits the answer into sentences, drops those `sentenceProblem()` rejects, and returns `{ text, removed, reason }`. Behind it: `ungroundedFigures` (per device, following "it" to the previous sentence), `deniesKnownDevice`, `affirmsUnknowns`, `negatesUnknowns`, `dropsUnknowns`, `contradictsStandings`, `ignoresTie`, `misordersRanking`, `mislabelsUnits`, `unsupportedClaims`.
- `engine/ai-agent.js` — the agent: `PLAN_SCHEMA` and `PLAN_SYSTEM`, `understand()` (plan + `reconcile()`, where the site's own parser overrules the model), `lookUp()` (device resolution, `queriesFor()` → `eng.ask()`, then the facts block: SITE ANSWER, NOT IN THIS DATABASE, KEY FACTS, ACROSS THE DATABASE, BACKGROUND, ABOUT THE SITE, plus `deviceFacts` for the per-device checks), `writeSystem()`/`explain()` and `followUps()`.
- `engine/assistant.js` adds the tools the agent needs: `resolveDevices`, `devicesInText`, `analyse` (attributes, features, use case, category, budget, brands), `keyFacts`, `dataContext`, `explainTerm(s)`, `useCaseInfo`, `officialName`, `answerText`, `isSmallTalk`.
- `ui/assistant.js`: the **AI answers** switch (`aria-pressed`), the offer card (built-in AI, 2B, 4B with sizes and licence), a progress card with Cancel and a "taking longer than expected" notice, the three-step progress list while an answer is prepared (only a word count while the model writes), then the answer with "What I looked up", the open verified answer and follow-up chips — or a "withheld" notice with the same. Greetings are answered by the rules without loading the model.
- Everything loads lazily: visitors who never switch AI on download nothing extra. The site stays static, so it works the same on GitHub Pages; the browser fetches WebLLM from `cdn.jsdelivr.net`, the model library from GitHub (`binary-mlc-llm-libs`) and the weights from `huggingface.co`.

## Headline and video pictures (Version 8)

- `tools/fetch_headlines.py` stores each item's feed thumbnail address (`image`).
- `ui/components.js` `youtubeId(url)`, `cardThumb({ image, url, devices }, { allowDevice })` (feed thumbnail, else YouTube thumbnail, else the first tagged device's picture) and `thumbLink(thumb, { url, size, placeholder })` (links to the article, or to the device page for device pictures; `placeholder` draws the publication-name tile when there is no picture).
- Used by the headline cards (`pages/feed.js`), `docCard()` (all checked-document grids), the news timeline, the home page lists and its new "Fresh from the feeds" row, and the device page's "In the headlines" strip (both filled after render from `live/headlines.json`, hidden if it can't be read).
- `main.js`'s capture-phase image `error` handler replaces a failed thumbnail with the name tile (`data-label`) or removes it.

## Assistant additions (Version 7)

`engine/assistant.js` adds, before the older shapes in `ask()`:
- `SMALL_TALK` (greetings, thanks, "are you an AI?") and `GLOSSARY` (about 40 regex → short general text entries, each optionally tied to an attribute so the current device's value can be added);
- `FEATURES` for yes/no questions: each entry has a keyword pattern, a label, a `test(specs, row)` returning `true`, `false` or `null`, an optional `detail()` and an `unsure` text for "Not listed";
- `answerVerdict()`: a use case from `detectProfile()` (or a single area when the question names one, such as the display), the position in a cached `profileLeaderboard()`, peers within ±20% of the Malaysian launch price, `rankOf()` strengths and weak points, the update promise, and an explicit "partial" note when the scores are specification-only or areas are missing;
- `overallCompare()` in comparisons, using `profileScore()` with the site's minimum coverage and tie margin.
The router asks "which device?" when a pronoun or yes/no question has no device in the question, the page or the previous answer.

## Navigation trail (Version 7)

- `core/trail.js` keeps the pages visited in this tab (`href`, path, title, scroll position; at most 50). `enterPage(loc)` is called before each render: returning to the previous entry pops the trail and gives back its scroll position; a new path is pushed; a same-path change (filters, sort) updates the entry in place. `titlePage()` records the title once the page has rendered.
- `ui/components.js` `pageTrail(crumbs)` draws the **Back** button and the folder path (`nav.pagetrail`). Back uses `history.back()` (`data-history-back`, handled in `main.js`) when the trail has an earlier page, otherwise it links one level up the crumbs. Every page except Home calls it; brand pages include their parent brands.
- `main.js` keeps the scroll a navigation asked for (`pendingScroll`: a saved position, or the `?section=` target) until a render of that path finishes, so an in-place re-render at start-up (exchange rates) cannot drop it; saved positions are re-applied for up to a second while long pages grow. Browser scroll restoration is off.
- `core/router.js` treats `#/page#anchor` as `#/page?section=anchor`.

## Fresh sessions (Version 7) and fresh files (Version 10)

The compare tray lives in memory only since Version 10 (`core/state.js`), so every page load starts empty; picks left in `localStorage` (V1–V6) or `sessionStorage` (V7–V9) are removed. Theme and currency stay in `localStorage`. The header search box is cleared on load, on navigation (when not focused) and on `pageshow`. The Ask panel clears its history each time it opens.

`sw.js` (registered from `main.js` after the page loads, secure contexts only) answers every same-origin GET with `fetch(request, { cache: 'no-cache' })`, so the browser revalidates each file of the site on every load (304 when unchanged). Other origins (Hugging Face, jsDelivr, fonts, the rate API) are not intercepted, so a downloaded AI model stays cached. `core/store.js` fetches data with `cache: 'no-cache'` as well. `serve.py` already sends `Cache-Control: no-store`; the worker matters on hosts such as GitHub Pages, which allow ten minutes of caching. The Pages workflow copies `sw.js` into the published site.

## Page outline (Version 5)

`pageOutline(items, {variant})` and `bindOutline(root, {stickySelector})` in `ui/components.js` give device, compare, methodology and coverage pages an "On this page" navigation:
- a sticky rail beside the content at 1180 px and wider, and a sticky horizontally scrolling bar below that (compare always uses the bar, above its sticky device headers);
- entries whose section is missing are hidden and renumbered;
- the current section is the last one whose top has passed a reading line (30% of the viewport, or below the sticky header). Sections side by side count as one, preferring the one clicked, and a click keeps its target highlighted for 1 second while the page scrolls;
- a progress bar shows how far through the page you are;
- `scroll-margin` values keep headings clear of the site header, the outline bar and compare's device headers.

## Evidence coverage (Version 2)

The build also writes `index/coverage.json`, a map of what the database does *not* know. It powers the `/coverage` page, the device-page evidence badge and `python tools/build.py --report`. Specs whose `checked` date is more than a year old raise a build warning. At scale this is the work queue: which devices need testing, which key measurements are missing, and whether one lab supplies too much of the evidence.

## Testing approach

- `python tools/build.py --check --strict`: data validation (run before every commit).
- A route smoke test: every route renders without an error state or console error, including edge cases (unknown ids, single-device compare, mixed-category compare, empty searches).
- An overflow sweep at phone width: `scrollWidth - clientWidth` must be 0 on every route.
- A link crawler (Version 3), run in the browser: it starts from every page type, follows every internal link, and on each page checks for console errors, overflow, raw values (`undefined`, `NaN`, `[object Object]`), mis-encoded characters, visible HTML entities, wrong plurals, doubled punctuation, empty or duplicate ids, broken attributes, unnamed links and controls, and exactly one `h1`.
- Header layout measured at 1180, 1181, 1280, 1439, 1440 and 1920 px: no overflow, nav on one line.
- A WCAG contrast audit of the design tokens (both themes) for every text/background pair in use.
- Visual review at desktop (1440 px, via headless Edge) and phone (358–390 px) widths, in light and dark themes.
- **Version 5:** the crawl runs against a static copy served from a sub-folder with no API (as on GitHub Pages); scripted Refresh tests cover local, static, server-error and offline cases; the live-rate path is forced with an old `asOf`; picture fallback is tested with a failing URL; all external data URLs are checked.
