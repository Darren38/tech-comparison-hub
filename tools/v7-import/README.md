# Version 7 import pipeline

The scripts and reviewed results behind Version 7's full specification sheets and pictures. They were run once; the
results are already in `data/`. Cached third-party pages (makers' spec pages, Samsung API responses, Internet Archive
copies) are not kept here, so re-running needs the Version 6 caches rebuilt first (`../v6-import/fetchcache*.py`).
`../v6-import/extract.py` provides the page-to-text helper.

Order used:

1. `wayback.py wayback_targets.json`: Internet Archive copies of removed official spec pages (CDX index, then the raw copy; 4 s between requests). `wayback_index.json` lists what was recovered.
2. `sheet.py` + `sheets_all.py`: read every cached official page (or Samsung's spec data) into about 40 fields → `sheets.json`.
3. `spec_sections.py`: the GSMArena-style section order in `data/categories/*.json`.
4. `merge_sheets.py [--dry]`: fill empty fields only, with field-level provenance where the page isn't the device's default source; derive charging watts, optical zoom, IP rating and main-camera details from the maker's own wording.
5. `samsung_core.py [--dry]`: compare Samsung core values with Samsung's own data (one correction: Galaxy S25 battery) and fill gaps.
6. `verify_core.py`: check recorded battery and weight against each phone's official page.
7. `upgrade_archived.py [--dry]`: values confirmed on an archived official page cite that page.
8. `compute_ppi.py`: pixel density from resolution and diagonal (class platform).
9. `images_v7.py <brand>` / `images_v7.py archived k/n`, `images_last.py`, `commons_find.py`: image candidates → `images_v7.json`, `images_arch_*.json`, `images_last.json`, `commons_candidates.json`. Every candidate was reviewed by eye on contact sheets before use.
10. `apply_images.py [rejected ids…]`: write reviewed official images into the device files; Commons photos go through `../add_photo.py --batch photos_v7.json`. The last ones (from `images_last.json`, plus the Galaxy A07 5G, POCO X8, realme GT 8 Pro and iPhone 18 Pro Max images) were written by hand after review.

Then `python tools/build.py --strict`.
