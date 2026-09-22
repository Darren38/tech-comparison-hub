<div align="center">

# Tech Comparison Hub

**Compare phones, smartwatches, fitness bands and tablets sold in Malaysia, and see where every number comes from.**

*Official specs, independent lab tests, benchmark databases and reviewer findings, each labelled by source and confidence.*

[![Open the site](https://img.shields.io/badge/OPEN%20THE%20SITE-darren38.github.io-2ea44f?style=for-the-badge)](https://darren38.github.io/tech-comparison-hub/)

<a href="https://darren38.github.io/tech-comparison-hub/"><img src="docs/screenshot.jpg" alt="Tech Comparison Hub comparing the Galaxy S26 Ultra with the iPhone 18 Pro Max: a verdict that calls it too close to call, and the key differences with their sources. Click to open the site." width="820"></a>

</div>

## What it is

- **457 devices** (373 phones, 63 smartwatches, 17 fitness bands, 4 tablets) and **116 chipsets**: every Samsung, Apple, OPPO, vivo/iQOO, HONOR, Huawei and Xiaomi/Redmi/POCO model with a verifiable Malaysian launch since 2023, plus other brands' flagships.
- **Every value says where it came from**: manufacturer, lab measurement, benchmark database, reviewer, news, estimate or the site's own analysis, with a confidence level. **254 attributed evidence records** from 91 source documents and 57 registered sources, plus full specification sheets.
- **Reviews for the latest flagships**: findings from written reviews, hands-ons, lab tests and YouTube reviews, summarised in the site's own words and credited to each publisher.
- **Fair comparisons** of up to 4 devices: key differences, category verdicts based only on evidence all of them share, your own weighting, same-test results and a full source list.
- **Prices in Malaysian ringgit**: verified Malaysian launch prices for 393 devices (US dollar, euro and four other currencies available). Converted prices are marked **≈** and never used to score value.
- **Ask the hub**: a built-in assistant that answers from the site's data ("Is it worth buying?", "Does it have NFC?", "Galaxy S26 or iPhone 18 Pro?"). Optionally, an **AI model runs in your own browser** (Qwen3.5 4B or 2B, or the browser's built-in AI): it reads questions in your own words or language, the site's code looks up the answer, and every sentence is checked against the data before it is shown. No question is sent to any AI service.
- **Latest headlines** from 19 publications and **exchange rates** from Bank Negara Malaysia, refreshed automatically.

## How current is it?

| Part | Updated |
|---|---|
| Specs, test results, launch prices, reviewer findings | Checked by hand. **Data as of 22 September 2026**, covering devices announced January 2023 – September 2026 |
| Exchange rates | Automatically, every 3 hours, and again in your browser if the saved rates are not from today |
| Latest headlines | Automatically, every 3 hours |
| The site itself | Every visit checks for newer files, so an update shows on the next refresh |

## Run it locally

Needs Python 3.9 or newer, and nothing else.

```bash
python serve.py --open
```

On Windows you can double-click `start.bat` instead. Running locally, the **Refresh** button on the News and Reviews pages collects headlines on the spot. The optional AI answers need a recent Chrome or Edge with WebGPU.

## Contributing

All the data is plain JSON in `data/`. See [CONTRIBUTING.md](CONTRIBUTING.md) for adding devices, evidence, prices and pictures. Check your changes with `python tools/build.py --check --strict`.

Further reading: [how scoring and confidence work](docs/METHODOLOGY.md) · [data model](docs/DATA_MODEL.md) · [architecture](docs/ARCHITECTURE.md) · [deployment](docs/DEPLOYMENT.md) · [changelog](CHANGELOG.md)

## Credits and licence

The code is under the [MIT licence](LICENSE). Facts are credited to the sources they came from, with links. Reviewer findings are short summaries in this project's own words. Device pictures are the makers' official product images or Wikimedia Commons files under their own free licences, credited on each device page; they load from their owners' servers. Headlines belong to their publishers and link to the original articles. The optional AI models (Qwen3.5, Apache 2.0) are downloaded by each visitor's browser from Hugging Face.
