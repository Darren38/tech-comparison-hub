# Data model

All source data lives in `data/` as plain JSON. It is edited by hand (or by future import scripts) and compiled by `tools/build.py` into `generated/`, which the web app reads. **Never edit `generated/`**; it is rebuilt on every `python serve.py` run.

```text
data/
├── meta/taxonomy.json        evidence classes, source tiers, confidence levels, facets, document kinds, video categories, news types
├── meta/currencies.json      display currencies: exchange rates (MYR per unit), default currency, rate source and date
├── meta/live-feeds.json      RSS and YouTube feeds for the Latest headlines panel (Version 5)
├── categories/*.json         one file per device category: spec sheet layout, filters, score categories
├── brands/brands.json        brands, with parent (e.g. POCO → Xiaomi, REDMAGIC → nubia → ZTE)
├── sources/sources.json      source registry: manufacturers, labs, databases, publications, YouTube channels
├── metrics/metrics.json      every measurable quantity (benchmarks, lab tests, spec-derived metrics)
├── metrics/scoring.json      score categories (metric weights) and use-case profiles (category weights)
├── chipsets/<id>.json        one file per SoC
├── devices/<category>/<id>.json   one file per device
├── reviews/*.json            documents: lab reviews (records + findings)
├── benchmarks/*.json         documents: benchmark databases and technical analyses
├── videos/*.json             documents: YouTube videos
├── news/*.json               documents: news and official announcements
├── comparisons/featured.json curated comparisons shown on the homepage
└── schema/*.schema.json      JSON Schemas for devices, chipsets and documents (editor validation)
```

`live/headlines.json` is generated too, by `tools/fetch_headlines.py`; never edit it by hand (see *Live feeds* below).

**Editor support (Version 2).** `data/schema/` holds JSON Schemas for device, chipset and document files, and `.vscode/settings.json` maps them, so VS Code validates and autocompletes while you type. The schemas check the shape of a single file; `tools/build.py` checks everything that spans files (ids exist, units are plausible, sources are registered).

A file in `reviews/`, `benchmarks/`, `videos/` or `news/` may hold a single document or an array of documents. The folders only help humans organise the files; every document shares one schema.

## Identifiers

- Lower-case slugs: `samsung-galaxy-s26-ultra`, `snapdragon-8-elite-gen-5`.
- Devices and chipsets share one **subject** namespace, because evidence records point at either. The build rejects an id used by both.
- Dates are `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. A month-precision date whose exact day is unknown also sets `"publishedApprox": true` on documents (shown as “c. Mar 2026”).

## Device

```jsonc
{
  "id": "samsung-galaxy-s26-ultra",
  "name": "Galaxy S26 Ultra",            // model name without brand
  "brand": "samsung",                     // → brands.json
  "category": "smartphone",               // → categories/*.json
  "series": "Galaxy S",
  "form": "bar",                          // bar | foldable | tablet | watch
  "status": "released",                   // rumored | announced | pre-order | released | discontinued
  "announced": "2026-02-25",
  "released": "2026-03-11",
  "segment": "flagship",
  "aliases": ["S26U"],                    // used by search
  "summary": "…", "highlights": ["…"],    // short, original wording
  "prices": [{ "region": "MY", "currency": "MYR", "amount": 5999, "config": "12 GB / 256 GB", "date": "2026-02-26",
               "type": "launch", "source": "soyacincau", "url": "…", "class": "news", "accessed": "2026-09-16",
               "note": "Announced at launch as coming soon; the 512 GB model went on sale first." }],
  "availability": { "MY": { "status": "not-launched", "checked": "2026-09-16",   // only for regions with no price
                            "source": "soyacincau", "url": "…", "note": "…" } },
  "image": { "kind": "photo",                                  // photo | drawing (Version 5) | official (Version 6); optional
             // official: { "kind": "official", "src": "<maker image URL>", "page": "<maker product page>",
             //             "credit": "OPPO Malaysia", "checked": "2026-09-18" }  (no licence: © the manufacturer)
             "src": "https://upload.wikimedia.org/…/500px-….jpg", "page": "https://commons.wikimedia.org/wiki/File:…",
             "title": "…", "author": "…", "license": "CC BY-SA 4.0", "licenseUrl": "…",
             "focus": "24% 50%",                               // optional crop centre for card thumbnails
             "checked": "2026-09-17" },
  "specs": {
    "display":      { "size_in": 6.9, "resolution": "3120 × 1440", "ppi": 498, "refresh_hz": 120, "peak_nits": 2600, … },
    "platform":     { "chipset": "snapdragon-8-elite-gen-5", "chipset_note": "…" },
    "memory":       { "ram_gb": [12, 16], "storage_gb": [256, 512, 1024] },
    "battery":      { "capacity_mah": 5000 },          // tablets: capacity_wh; watches: life_h
    "charging":     { "wired_w": 60, "wireless_w": 25 }, // 0 = explicitly none, absent = unknown
    "camera":       { "rear": [{ "role": "main", "mp": 200, "sensor": "1/1.3\"", "zoom_x": null }], "zoom_optical_x": 5 },
    "build":        { "dimensions": { "height_mm": 163.6, "width_mm": 78.1, "depth_mm": 7.9 }, "weight_g": 214, "ip": "IP68" },
    "connectivity": { … }, "biometrics": { … }, "audio": { … },
    "software":     { "launch_os": "Android 16, One UI 8.5", "os_updates_years": 7, "security_updates_years": 7 }
  },
  "provenance": {
    "default": { "class": "official", "source": "samsung", "url": "…", "checked": "2026-09-15", "note": "…" },
    "fields":  { "specs.display.pwm": { "class": "measured", "source": "gsmarena", "url": "…" } }
  },
  "dataStatus": "checked"                 // checked | compiled
}
```

**Unknown values are left out.** The UI shows “Not recorded”; nothing is guessed.

**Provenance.** Every spec field inherits `provenance.default`. A more specific key in `provenance.fields` overrides it for that path and everything below it (so `specs.camera` covers the whole camera block). This is how a spec sheet mixes official values with measured, reported (`database`), estimated or platform-calculated ones, and the spec sheet shows the right badge on each row.

**`dataStatus`.** `checked` means the key specs were cross-checked against the cited sources on the `checked` date. `compiled` means they came from launch material and still need re-checking. The device page shows which.

**Prices and availability (Version 4).** A price is a launch price in its own currency, with the article or store page it was read from (`url`), when it was read (`accessed`) and an optional `note` (a launch promotion, a configuration that came later). Record every configuration you can source; the site shows the cheapest and lists the rest. When a region has no price, `availability.<region>` says why, and the device page shows it with its source:

| `status` | Meaning | Needs |
| --- | --- | --- |
| `not-launched` | A source says the device is not sold there (for example China only) | `source`, `url`, `note` |
| `not-found` | No launch found in local tech media or on the brand's sites | `note` describing where you looked |
| `price-not-found` | The brand lists the device there, but no official price was published | `source`, `url` of the listing |

Every entry needs a `checked` date. The build rejects an unknown status, and an availability entry for a region that already has a price. The browse filter “Sold in Malaysia” (`f.soldMY`) is true for a Malaysian price or `price-not-found`.

**Pictures (Version 5).** Add them with the tool, never by hand:

```bash
python tools/add_photo.py samsung-galaxy-s26 "File:Galaxy S26.jpg"
python tools/add_photo.py google-pixel-10 "File:Pixel 10 back (Indigo).svg" --drawing
python tools/add_photo.py samsung-galaxy-s26-ultra "File:<wide photo>.jpg" --focus "24% 50%"
python tools/add_photo.py samsung-galaxy-s26 --remove
```

It reads the file's licence and author from the Commons API, refuses anything other than CC0, public domain, CC BY or CC BY-SA (and CC BY without an author), and writes the block with a 500 px thumbnail URL. **Look at the file first:** it must show this exact model and be the uploader's own photo or drawing, not a re-uploaded press image. The build rejects a non-Wikimedia `src` or `page`, an unknown `kind`, a licence outside that list, a CC BY picture without an author, and a malformed `focus`.

Fields a category's `specSections` does not list are still kept, but not shown in the spec sheet. Add them to the category file to display them.

**Official product images (Version 6).** `kind: "official"` needs `src` on one of the makers' image hosts (listed in `OFFICIAL_IMAGE_HOSTS` in `tools/build.py`), a `page` on the maker's own website, a `credit` naming that site, and `checked`. The page shows "Product image: <credit> · © the manufacturer".

Version 7 also accepts a removed maker page through its Internet Archive copy: `page` may be `https://web.archive.org/web/<14-digit timestamp>/<maker page URL>` and `src` may be `https://web.archive.org/web/<timestamp>im_/<maker image URL>`; the build checks the maker URL inside. ASUS (`dlcdnwebimgs.asus.com`), REDMAGIC (`global.redmagic.gg`) and realme (`static2.realme.net`, `image01.realme.net`) image servers were added to the host list.

**Categories (Version 6).** `band` (fitness bands) joins smartphone, tablet and smartwatch. Bands use `battery.life_h` (and `battery.claim`), `build.water`/`water_m`, `display.size_in` and `build.weight_g` like watches; `data/categories/band.json` defines their filters and spec sections.

**Full specification fields (Version 7).** Phone `specs` may also hold, all optional and in the maker's wording unless noted:

| Path | Example |
| --- | --- |
| `connectivity.technology`, `connectivity.bands_2g` … `bands_5g` | "GSM / HSPA / LTE / 5G", "4G FDD LTE: B1(2100), …" |
| `connectivity.sim`, `wifi`, `bluetooth`, `positioning`, `radio`, `usb` | "Dual-SIM; Nano-SIM (4FF), Embedded-SIM", "Bluetooth v5.4" |
| `connectivity.nfc`, `connectivity.uwb`, `audio.jack` | booleans |
| `platform.cpu`, `platform.gpu`, `platform.process` | "Octa-Core; 4.47GHz, 3.5GHz" |
| `memory.ram_type`, `memory.storage_type`, `memory.card` | "LPDDR5X", "UFS 4.0", "MicroSD (Up to 1TB)" or "No" |
| `camera.rear_detail`, `camera.front_detail` | lists, one string per module: "50 MP, f/1.8, OIS" |
| `camera.features`, `camera.video`, `camera.front_video` | text |
| `camera.rear[].sensor`, `.aperture`, `.ois` | main-module details: `"1/1.56\""`, `"f/1.7"`, `true` |
| `audio.speakers`, `sensors`, `biometrics.fingerprint`, `biometrics.face` | text |
| `battery.chemistry`, `charging.claim` | "Li-ion", the maker's own charging sentence |
| `build.back`, `build.frame`, `build.durability` | text |
| `misc.colors`, `misc.models` | text |
| `software.security_until` | ISO date from Samsung's data; `software.security_updates_years` is derived from it and the launch date |

`display.ppi` without a stated figure is calculated from `display.resolution` and `display.size_in`, with a field override `{"class": "platform", "source": "platform", "note": "Calculated from resolution and screen size."}`.

**Spec sheet layout.** `specSections` in `data/categories/*.json` lists the rows each category shows, in order. A field `key` is a dotted path under `specs`, or a top-level device field prefixed with `@` (`@announced`, `@released`, type `date`). Types: `number` (with `unit`, `digits`, `better`), `text`, `bool`, `list`, `lines` (one line per list item), `storage`, `dimensions`, `chipset`, `cameras`, `date`. Rows without a value are collected into one "Not stated by the sources" line per section.

**Launch-date provenance (Version 6).** `announced` can have its own entry in `provenance.fields`, for example `"announced": {"class": "news", "source": "lowyat", "url": "…", "note": "Date of the first Malaysian launch report found…"}`. Field overrides use dotted paths such as `specs.platform` or `specs.memory`.

## Chipset

Same idea: `process`, `cpu.clusters[] {count, core, ghz}`, `gpu`, `npu`, `modem`, `memory`, `storage`, `variants[]`, plus `provenance` with per-field overrides (for example, clocks Apple does not publish are marked `database`).

## Documents (the evidence store)

A **document** is one source artifact: a review page, a video, a database page, a news article, a press release. Records and findings hang off documents, so publisher, URL, date and method are stated once and inherited.

```jsonc
{
  "id": "gsma-s26u-lab",
  "kind": "review",                  // review | video | benchmark | news | analysis | official
  "source": "gsmarena",              // publisher (→ sources.json)
  "testedBy": null,                  // original tester when the publisher reports someone else's test
  "title": "…", "url": "…",
  "published": "2026-03", "publishedApprox": true, "accessed": "2026-09-15",
  "class": "measured",               // default evidence class of this document's records
  "devices": ["samsung-galaxy-s26-ultra"], "chipsets": [],
  "facets": ["display", "battery"],
  "method": "Light-meter brightness readings …",
  "verification": "excerpt",         // optional: values read from a search excerpt, not the page itself
  "records": [
    { "subject": "samsung-galaxy-s26-ultra", "metric": "gsma_active_use", "value": 16.383,
      "note": "…", "variant": "EU model, 5,440 mAh", "chip": "snapdragon-8-elite-gen-5" /* Version 14: the tested unit's chipset when it differs by region; counted for that chip, shown apart on the phone */, "flags": ["pre-release" | "early-software" | "disputed" /* Version 15: a published figure contradicted by every other test of the same hardware (the note says why); shown with its reason, counted nowhere */],
      "class": "platform", "derived": { "formula": "lowest ÷ highest loop", "inputs": "2,647 ÷ 3,394" } }
  ],
  "findings": [
    { "subject": "samsung-galaxy-s26-ultra", "facet": "thermals", "stance": "negative", "text": "Our own summary …" }
  ],
  "extraction": "complete",          // complete | partial | metadata-only
  // video-only:  "platform": "YouTube", "category": "full-review", "verified": { "metadata": "…" }
  // news-only:   "type": "price", "region": "MY", "summary": "…"
}
```

- **Records** are numbers tied to a metric. Their unit and direction come from `metrics.json`.
- **Findings** are qualitative statements, always paraphrased and always tied to a document.
- **`testedBy`** makes the *origin* (the lab that did the test) distinct from the *publisher*. Consensus counts origins, so a test reported by three outlets still counts once.
- **`extraction`** records how far along the pipeline a document is: a video can be linked and categorised (`metadata-only`) long before its results are extracted.

## Metrics

```jsonc
{ "id": "wle_stability", "name": "3DMark WLE Stress Test stability", "unit": "%", "better": "higher",
  "facet": "gaming", "level": "device", "comparability": "global", "plausible": [10, 100] }
```

- `level: "chipset"` lets a device without its own result inherit the chipset consensus, labelled and capped at medium confidence. `level: "device"` metrics such as sustained stability are never inherited.
- `comparability: "document"` marks values that only make sense within one test run (one reviewer's battery rundown). They appear only in head-to-head tables.
- `derive` turns a spec field into a metric (`spec_battery_mah`, `spec_ip` via a transform, `spec_battery_wh` with an mAh → Wh fallback labelled as platform analysis).
- `plausible` ranges catch unit mistakes (for example minutes entered as hours) at build time.
- Versions are separate metrics (`antutu_v10`, `antutu_v11`), so they are never mixed.
- Publisher-specific tests are separate metrics too (Version 10): `engadget_video` (Engadget's video rundown, h), `tg_web` (Tom's Guide's web-surfing battery test, h) and `dxomark_camera` (DXOMARK Camera score, pts). Each is compared only with results of the same test, and none of them feeds the scoring configuration yet.
- A record reported by one outlet about another's test sets the document's `testedBy` (MacRumors reporting Tom's Guide's battery results, for example), so consensus counts the lab once.

## Scoring configuration

`scoring.json` defines score categories as weighted metric lists (optionally per device category, and with `alt` groups such as `["antutu_v11", "antutu_v10"]`), use-case profiles as category weights, and the verdict thresholds (`tieMargin`, `minCoverage`). The logic is described in `docs/METHODOLOGY.md`.

## Currencies (Version 3)

Device prices stay in the currency they were announced in (`prices[]` above). `data/meta/currencies.json` defines the currencies a reader can choose and how to convert between them:

```jsonc
{
  "default": "MYR",                                  // shown until the reader picks another
  "base": "MYR",                                     // every rate is the MYR value of one unit
  "asOf": "2026-09-14",
  "source": { "name": "Bank Negara Malaysia", "url": "https://www.bnm.gov.my/latest-rates", "note": "…" },
  "conversionPreference": ["USD", "EUR", "GBP", "SGD", "MYR", "INR", "CNY"],  // which recorded price to convert first
  "conversionNote": "Converted prices are estimates …",                      // shown on the methodology page
  "currencies": [
    { "code": "MYR", "name": "Malaysian ringgit", "label": "RM · MYR", "toMYR": 1, "region": "MY", "regionName": "Malaysia" },
    { "code": "USD", "name": "US dollar", "label": "$ · USD", "toMYR": 4.0705, "region": "US", "regionName": "the US" }
  ]
}
```

- The build rejects a non-positive rate, an unknown default, a bad `asOf` date, and any device price in a currency that has no rate.
- **Rates update themselves (Version 5):** `python tools/update_rates.py` (run by `serve.py` and the GitHub workflow) writes Bank Negara Malaysia's latest middle rates, `asOf`, `session` and `fetchedAt`. If Bank Negara is unreachable, the file is left as it was. To set rates by hand, change `toMYR` and `asOf`, then rebuild.
- To add a currency, add an entry. Add its symbol to `PRICE_SYMBOLS` in `src/lib/format.js` if it has a common one; otherwise prices show the ISO code (“JPY 5,000”).
- A category filter `{ "id": "price", "type": "range", "unit": "currency" }` filters on the price in the reader's currency.

## Live feeds (Version 5)

`data/meta/live-feeds.json` lists the feeds for the Latest headlines panel, and since Version 12 the optional `relay` address (the Cloudflare Worker in `relay/`; empty means no live collection on a static host). `tools/fetch_headlines.py` also writes `live/config.json`: the feed list, `relay`, the topic and review patterns and the device match keys, which the browser uses to collect through the relay with the same rules.

The main camera's sensor size may carry its own provenance, `provenance.fields["specs.camera.rear.main.sensor"]` (Version 12), when it comes from a different source than the rest of the camera list (for example DXOMARK's camera test where the maker states none); the camera score then credits that source.

Feeds:

```jsonc
{
  "maxAgeDays": 45,      // drop items older than this
  "perFeed": 20,         // at most this many items kept per feed
  "maxItems": 240,
  "feeds": [
    { "source": "sammobile", "kind": "news", "url": "https://…/feed" },
    { "source": "mkbhd", "kind": "video", "url": "https://www.youtube.com/feeds/videos.xml?channel_id=…" }
  ]
}
```

- `source` must be in `sources.json`; `kind` is `news`, `review` or `video`; `url` must be https. The build checks all three.
- `tools/fetch_headlines.py` reads each feed and keeps items about phones, tablets or watches. Items whose title reads as a review are reclassified `review`. Each item gets the ids of devices in the database it names, which requires a model number, so a brand alone never matches. The result goes to `live/headlines.json` (`fetchedAt`, per-feed status, and items with `id`, `title`, `url`, `source`, `kind`, `published`, `devices`). If every feed fails, the previous file is kept.
- Only titles and links are stored, plus (Version 8) `image`: the https address of the thumbnail the publisher attached to the item in its own feed (`media:thumbnail`, an image `media:content` or enclosure, or the first `<img>` in the summary), or `null`. The picture itself is never downloaded. Sources in `NO_IMAGE_SOURCES` (GSMArena) always get `null`.

## Adding a device (checklist)

1. If the chipset is new, add `data/chipsets/<id>.json`. If the brand is new, add it to `brands.json`.
2. Scaffold the device file:
   ```bash
   python tools/new_device.py --id vivo-x300-ultra --name "vivo X300 Ultra" --brand vivo --category smartphone --chipset snapdragon-8-elite-gen-5 --announced 2026-03-30
   ```
   This checks the brand, category and chipset exist and the id is free, then writes a file with an empty spec block for every section the category displays.
3. Fill in only the values you can source, and delete the rest. Add `provenance.fields` overrides for any value that is not official. Set `dataStatus` to `checked` (with a `checked` date) once the key specs are verified. Add the Malaysian launch price (with `url` and `accessed`) read from the launch article or store page, or an `availability.MY` status saying why there is none; `--report` lists devices that have neither.
4. Add evidence as documents in `data/reviews`, `data/benchmarks`, `data/videos` or `data/news`, citing a registered source.
5. Run `python tools/build.py --check --report`. Fix every error (unknown ids, bad dates, implausible values), review the warnings (including specs checked over a year ago), and see where the device now stands in the coverage report.
6. Optionally add a picture with `tools/add_photo.py` (above).
7. Run `python serve.py` and open the device page.

## Generated output (`generated/`)

| File | Contents |
| --- | --- |
| `core.json` | taxonomy, categories, brands, sources, metrics, scoring, per-category metric stats, featured comparisons, currencies, the live feed list (`liveFeeds`), build info (including `build.data`: the data's as-of date and launch window) |
| `index/devices.json` | one compact row per device: key specs, prices (currency, amount, region, configuration, source), availability statuses, picture (`image`: kind, src, page, title, author, licence, focus), filter fields (`f`), consensus metrics (`m: {id: [value, confidence, inherited]}`) |
| `index/chipsets.json`, `index/documents.json`, `index/search.json`, `index/head-to-head.json` | indexes for lists, feeds, search and same-test tables |
| `index/coverage.json` | evidence coverage: per-category metric coverage (direct / chipset stand-in / none), devices with no independent tests, key tests missing per phone, records per original tester, extraction status, planned sources |
| `devices/<id>.json` | the device, its chipset, aggregated metrics with every origin and record, its documents with their records and findings, head-to-head tests, related devices |
| `chipsets/<id>.json` | the chipset, consensus metrics (chip-level plus device-level results), per-device implementation results, documents |
| `sources/<id>.json` | the source, its documents and record count |

**Automatic layer (Version 16).** `live/auto/benchmarks.json` and `live/auto/images.json` are written by the daily refresh tools and applied by the build on top of `data/`; they are never edited by hand, and deleting them simply returns the site to the checked values. `live/views.json` holds YouTube view counts by video id.
