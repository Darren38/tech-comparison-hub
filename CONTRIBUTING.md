# Contributing

Most contributions are **data**: a device, a test result, a launch price, a review finding or a picture. It is all plain JSON in `data/`, and you don't need to write JavaScript. The full field reference is [docs/DATA_MODEL.md](docs/DATA_MODEL.md).

---

## The rules that matter

This project is only useful if its numbers can be trusted.

- **Never invent a value.** If you can't find it, leave the field out. The site shows "Not recorded", which is correct.
- **Cite the page you read it from.** Every value needs a registered source and a link to the page itself, not a search-result summary. Search summaries have been wrong before, for example promotional prices shown as retail prices.
- **Label the kind of evidence honestly.** A manufacturer claim is `official`, your own calculation is `platform`, and a lab's reading is `measured`. When a publication reports another lab's test, set `testedBy` to that lab so the test is counted once.
- **Write findings in your own words.** Short summaries only; never paste review text.
- **Record "not sold" or "not found" explicitly** rather than guessing a price.

## Check your change

```bash
python tools/build.py --check --strict    # must end with 0 errors and 0 warnings
python tools/build.py --report            # optional: what evidence is still missing
python serve.py --open                    # look at the pages you changed
```

The build rejects unknown ids, bad dates, unregistered sources, implausible values (a unit mistake, for example) and malformed pictures or feeds. The GitHub workflow runs the same build, so a change that fails locally will not deploy.

## Adding a device

1. If its chipset or brand is new, add `data/chipsets/<id>.json` or an entry in `data/brands/brands.json`.
2. Create the file:
   ```bash
   python tools/new_device.py --id vivo-x300-ultra --name "vivo X300 Ultra" --brand vivo --category smartphone --chipset snapdragon-8-elite-gen-5 --announced 2026-03-30
   ```
3. Fill in only the specs you can source, and delete the rest. Mark any value that isn't the manufacturer's in `provenance.fields`.
4. Add the **Malaysian launch price** with its `url` and `accessed` date, read from the launch article or official store page. If there is none, add `availability.MY` with the reason (`not-launched`, `not-found` or `price-not-found`).
5. Optionally add a picture (below), then run the checks above.

## Adding evidence

A review, video, benchmark page or news article is a **document** in `data/reviews/`, `data/videos/`, `data/benchmarks/` or `data/news/`. It holds the numbers (`records`) and the qualitative points (`findings`) taken from that one source. The publisher must be in `data/sources/sources.json`; add it there first if it's new. YouTube channels must be real, verified channels.

## Adding a picture

A picture is either the **maker's official product image**, linked from the maker's own product, spec or support page, or a **freely licensed file on Wikimedia Commons**. Pictures are always shown from their owner's server, never copied into this repository.

**Official image:** add an `image` block with `kind: "official"`, the image address on the maker's image server as `src`, the maker's page it appears on as `page`, the maker's name as `credit`, and the date you `checked` it. The build only accepts the makers' own image hosts (`OFFICIAL_IMAGE_HOSTS` in `tools/build.py`). Look at it first: it must show this exact model, not a sibling. Details in [docs/DATA_MODEL.md](docs/DATA_MODEL.md).

**Commons file:** it must be CC0, public domain, CC BY or CC BY-SA. Look at the file first. It must show this exact model, not a sibling such as the base model for a Pro, and it must be the uploader's own photo or drawing, not a manufacturer press image someone re-uploaded.

```bash
python tools/add_photo.py samsung-galaxy-s26 "File:Galaxy S26.jpg"
python tools/add_photo.py google-pixel-10 "File:Pixel 10 back (Indigo).svg" --drawing
python tools/add_photo.py <device-id> "File:<wide photo>.jpg" --focus "30% 50%"   # keep the device in the card crop
```

The tool checks the licence and author and writes the credit; the site shows the picture from Wikimedia.

## Adding a news or video feed

Add an entry to `data/meta/live-feeds.json` with a registered `source`, a `kind` (`news`, `review` or `video`) and an https feed `url`. Check it with `python tools/fetch_headlines.py`. Only titles and links are ever stored.

## Code changes

- There is no build step and nothing to install: native ES modules in `src/`, plain CSS in `assets/css/`, and Python standard library tools in `tools/`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- The `html` template escapes every value. For a conditional attribute, pass a nested template: `${open ? html`target="_blank"` : ''}`. A plain string would be escaped.
- Keep pages working at phone width (375 px) and in dark mode, and test with `python serve.py`.

## Pull requests

Describe what changed and link the sources you used. Run `python tools/build.py --check --strict` first. Don't include personal information (email addresses, local file paths) in files or commits.
