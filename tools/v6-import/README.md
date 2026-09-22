# Version 6 import pipeline

How the 413 devices added in Version 6 were collected. The site does not use these files at run time; they document where every new record came from and let the records be regenerated.

Cached copies of third-party pages (makers' spec pages, launch articles, article-title lists) are **not** included: they are other people's content. The scripts that fetched them are, so the caches can be rebuilt.

## Steps and files

| Step | Script | Output kept here |
| --- | --- | --- |
| 1. Candidates from the makers' Malaysian sitemaps and listings | `sitemaps.py`, `catalog.py` | `catalog_<brand>.json` (id, name, category, series, spec page URLs) |
| 2. Fetch official spec pages (per-host delays; HONOR 30 s) and accept only pages that name the model and hold specifications | `fetchcache.py`, `validate_cache.py` | `spec_index_<brand>.json` (URL, final URL, status, title, accepted) |
| 3. Read specifications with fixed patterns | `extract.py`, `pagetext.py` | `extract_<brand>.json` |
| 3b. Samsung pages that render only in a browser: Samsung's spec data for the Malaysian model codes | `samsung_api.py` | `samsung_api_extract.json`, `samsung_mem.json`, `samsung_support_codes.json` |
| 3c. Other official pages and launch-report specs, written and reviewed by hand | `manual_specs.py` | `manual_specs.json` |
| 4. Malaysian launch prices: find launch articles, pull price sentences | `soya_titles.py`, `site_titles.py`, `price_find2.py` | (cache only) |
| 5. Reviewed decisions: prices, dates, statuses and drops, one line per device | hand-written, checked by `apply_decisions.py` | `dec_<brand>.txt`, `decisions_prices.json` |
| 6. Corrections, chip names from launch reports, extra drops | `chip_decide.py` and hand-written | `extra_decisions.json`, `chip_sources.json` |
| 7. Official product images, reviewed on contact sheets | `find_images.py` | `images.json` |
| 8. Write `data/devices/<category>/<id>.json` and minimal chipset records (never overwrites) | `build_new.py`, `chips.py` | the device files |

`dec_<brand>.txt` format: `id | CFG=RM[@site], … [@site] | options`. `CFG` is `8/256`, `12/1T`, `256`, `-` (no configuration) or quoted text for watches. Options: `ann=`, `annsrc=`, `annnote=`, `status=`, `pnote=`, `src=`, `set:path=`. A middle part starting `drop:` removes the device and records why.

GSMArena was not used at any step.
