# Methodology

This document describes exactly what the code does (`tools/build.py` for aggregation and confidence; `src/engine/scoring.js` and `src/engine/compare.js` for scores and verdicts). The in-app Methodology page reads the same configuration.

## 1. Evidence classes

| Class | Badge | Meaning |
| --- | --- | --- |
| Official | `OFF` | Manufacturer specification or announcement: what the product *is*, never proof of how it *performs*. |
| Measured | `LAB` | Independent test with a documented, repeatable method (lab review, reviewer test rig). |
| Database | `DB` | Aggregated or compiled results: benchmark database medians, publications collecting scores. |
| Reviewer | `REV` | Qualitative reviewer observation. |
| News | `NEWS` | Reported by a news outlet (launches, prices, updates, issues). |
| Community | `COM` | User reports / crowd data. Low weight. |
| Estimated | `EST` | Estimates, leaks, prototype results, or values inferred from a pattern, not a commitment. |
| Platform analysis | `CALC` | Computed by this platform: consensus values, conversions, scores, verdicts. Never a new measurement. |

Examples in the Version 1 data:
- Apple publishes no update commitment, so iPhone update years are **Estimated**, with the reasoning attached.
- Apple lists charging as a time claim with an adapter rating, so the iPhone wired-watt value is **Estimated**.
- Tablet Wh values converted from mAh at 3.85 V, IP-rating levels, and the Pixel 11 Pro stress stability computed from GSMArena's lowest and highest loops are all **Platform analysis**.
- Values read from a search excerpt of an article (not the page itself) carry an **excerpt** tag and count as secondary.

## 2. Source tiers

- **O**: the manufacturer.
- **A**: established lab, database or reviewer with a published, repeatable method (GSMArena, Notebookcheck, UL, Geekerwan, MKBHD for experience reviews, JerryRigEverything for durability).
- **B**: reputable, but with a limited or undocumented method, or mainly reporting others' results (Gizmochina, Beebom, Mrwhosetheboss battery rundowns, Geekbench Browser listings).
- **C**: unverified or community.

YouTube channels are verified against YouTube's oEmbed record before a video is added. Candidate videos whose channels could not be verified, or that looked like AI-generated review farms, were excluded.

## 3. Consensus

For each subject (a device or chipset) and each metric:

1. Group records by **origin**: the organisation that actually ran the test (`testedBy`, else the publisher). A test reported by three outlets counts once.
2. Take the median of each origin's records.
3. **Consensus** = median across origins (the mean of the two when there are two). **Range** = lowest and highest origin value. **Spread** = range ÷ consensus.

A chipset's consensus combines chip-level records with results measured on phones that use the chip. The spread between those phones is shown separately as “Same chip, different phones”.

A device with no result of its own for a chip-level metric (Geekbench, AnTuTu, peak 3DMark) **inherits** the chipset consensus. The value is labelled “chipset”, drawn with a hatched bar, and capped at medium confidence. Device-level metrics (stress-test stability, battery, charging, brightness) are never inherited.

**Versions never mix.** AnTuTu v10 and v11 are separate metrics. **Single-run tests** (one reviewer's battery rundown, one lab's power draw) are only compared within that test, in head-to-head tables.

## 4. Confidence

Evaluated in order:

1. Only official values → **High** (“Official specification”).
2. Only official plus platform conversions of them → **High**.
3. Only estimates → **Low**.
4. Only pre-release or prototype listings → **Low**.
5. At least three independent origins within 10% of each other → **High**.
6. Two or more within 12%, at least one a tier-A lab or database (not an excerpt) → **High**.
7. Two or more within 25% → **Medium**.
8. Two or more that disagree by more than 25% → **Low**.
9. A single tier-A measurement → **Medium**.
10. Otherwise (a single secondary source) → **Low**.

Then early-software results are capped at **Medium**, and inherited chipset values are capped at **Medium**. Every value carries a one-line reason, for example: “2 independent sources agree within 6% (GSMArena, Notebookcheck)”.

## 5. Scores

**Metric score (0–100)** relative to the best consensus value in the same device category:
- higher is better: `value ÷ best`
- lower is better: `best ÷ value`
- log scale (charging power, zoom): `ln(1 + value) ÷ ln(1 + best)`

**Category score**: the weighted mean of the metric scores that have evidence (weights in `data/metrics/scoring.json`). Coverage is the share of the category's weight that had evidence. Confidence is the weighted mix of the metrics' confidence, lowered when coverage is thin.

**Database ranks** (device page: #n of m) are **like-for-like**: a device is ranked only against devices that have evidence for every metric its own score uses, scored on those metrics. A phone scored on measured brightness is never ranked against phones scored only on claimed brightness. No rank is shown when fewer than four devices share the evidence.

**Evidence that isn't recorded counts as typical for a similar device (Version 11).** In database-wide rankings and use-case fits, a missing metric — or a whole missing category — takes the median of the same brand's devices of the same kind from the same or the previous year at a similar Malaysian launch price (at least three of them); for charging and software support, which follow the maker rather than the price, the brand's own devices from the last three years (two years either side for charging, which rarely changes); then any brand's similar devices (at least six); and otherwise the lower quartile of devices of that kind launched no later than it. Coverage still reports the share of evidence that is real, the score's confidence drops, and the device page lists the values counted as typical. Comparisons and like-for-like database ranks are unaffected: they already score every device on the same evidence. Before this, a gap could only help — a 2023 phone with only its 1-inch main sensor recorded scored 100 for camera hardware, above a 2026 phone whose 4.3× zoom was recorded too, and mid-range phones whose chipsets have no benchmark data led the overall ranking because performance was skipped.

**Devices not on sale yet** (`announced`, `pre-order`) are left out of the site's rankings and sorted after the rest in the database ranking view, since their figures come from pre-release listings at best.

**Camera** is hardware-only (sensor size, optical reach) and labelled that way until image-quality lab data exists.

## 6. Comparison verdicts

For each score category:
1. Use only metrics **every compared device** has evidence for. For `alt` groups, pick the first alternative all devices share (for example AnTuTu v11, otherwise v10).
2. Score each device on those shared metrics.
3. If shared coverage is below 34% → “Insufficient shared evidence”.
4. If the leader is less than 3 points ahead → “Too close to call”.
5. Otherwise name the winner, with the margin and the lower of the two devices' confidence levels.
6. **Why**: the shared metrics where the winner gains the most weighted points, with values, relative difference and source names. **But**: up to two metrics where the runner-up leads.

**Use-case profiles** weight the category scores (Balanced, Gaming, Photography, Battery, Student/value, Long-term, Raw performance). **Value** is the balanced score per unit of launch price, computed only from real launch prices in one currency (see section 7).

**Use-case relevance (Version 3).** Some profiles are mostly about things a category doesn't have: gaming and camera scores don't exist for watches. A profile's relevance is the share of its weight that applies to the device's category. A device is only recommended (“Who should buy”) or ranked for a use case with at least 50% relevance, and a comparison under a less relevant profile says so and suggests another.

**Custom weights (Version 2).** On the compare page, “Custom…” shows one slider (0–5) per score category plus value. The overall verdict is recomputed with those relative weights; category verdicts do not change, because they never depend on weights. The weights are stored in the URL (`?profile=custom&w=battery:5,camera:3,…`), so a custom comparison can be shared.

**Key differences (Version 2).** A short digest at the top of each comparison lists the largest real gaps:
- For each key metric, the leader is compared with the **next-best** device, never with the worst, so gaps are not exaggerated.
- A gap qualifies at **12% or more** (2 years or more for update commitments).
- **Chipset stand-ins never count**: only a device's own evidence can make it the leader.
- Independent measurements rank above specification differences (weighted ×1.6), and each item shows its evidence class, source and confidence.

## 7. Prices and currencies (Version 3)

- **Stored as recorded.** A launch price is kept in the currency it was announced in, with its region, configuration, date and source (Galaxy S26 Ultra 12 GB / 256 GB: RM5,999 in Malaysia, $1,299.99 in the US).
- **Shown in the reader's currency.** The currency menu defaults to Malaysian ringgit. A device shows its own launch price in that currency when one is recorded (the lowest configuration if there are several). Otherwise it converts one of its recorded prices, preferring USD, then EUR, GBP, SGD, MYR, INR and CNY. The result is rounded to a whole unit and marked **≈** with the source region (“≈ RM3,944 from CN” for the China-only vivo X200 Ultra).
- **Conversions are labelled estimates.** The tooltip and the device page state the original price, the rate and its date, for example: “Estimate converted from CN¥6,499 (CN launch price, 12 GB / 256 GB) at 1 CNY = 0.6068 MYR, Bank Negara Malaysia rate of 14 Sep 2026. Not a local price.” On device pages the converted price carries the platform-analysis badge.
- **Rates** are Bank Negara Malaysia middle rates in `data/meta/currencies.json`, stored as the MYR value of one unit, with their date and session. Cross rates go through MYR. Since Version 5 they refresh automatically (section 8).
- **Value scores never use conversions.** Launch prices differ by region for reasons an exchange rate doesn't capture (taxes, bundles, market strategy). A comparison scores value in the reader's currency when every compared device has a real price in it, otherwise in the first currency they all share (USD first). When there is none, value is not scored and the page says why. Rankings use the currency in which the most devices have a real price; devices without one get no value score.
- **Filters and search use the reader's currency**, including conversions, because they answer “roughly what does this cost in my money”, not “which is better”. A price in a link or query keeps its currency (`?priceMax=4000&cur=MYR`, “under $900”) and is converted when opened in another currency.
- **Malaysia (Version 4).** Every device has either a verified Malaysian launch price or an availability status saying why not:
  - **not sold in Malaysia**: a source says so, for example a China-only model;
  - **no Malaysian launch found**: nothing in Malaysian tech media or on the brand's sites;
  - **sold without a verified price**: the brand lists it in Malaysia, but no official price was published.

  Prices were read from the launch article itself, not from a search snippet or a price-comparison site. Where there was a regular price and a launch promotion, the regular price is recorded and the promotion noted. When several configurations launched, the cheapest is used for display and the others are listed on the device page.

## 8. How current the data is (Versions 4 and 5)

- **The research data is a dated snapshot.** Every specification, test result, price and finding records when it was read from its source. The build reports the newest of those dates as "data as of" (16 Sep 2026 in this build) and the launch window covered (devices announced from Sep 2024 to Sep 2026). Both appear in the site footer and on the methodology page. This data changes only when the files in `data/` are edited and the site is rebuilt.
- **Launch prices do not change** once recorded; current shop prices are not tracked.
- **Ageing is flagged.** Specifications last checked more than a year ago raise a build warning, and the coverage page lists what still needs checking.
- **Exchange rates update automatically (Version 5).**
  - Every build downloads Bank Negara Malaysia's latest middle rates (`tools/update_rates.py`): at `serve.py` start-up locally, and every 3 hours on GitHub Pages.
  - When a visitor opens the site, the browser compares the saved rate date with today's date in Malaysia. If the rates are older, it fetches daily rates from ExchangeRate-API, uses them and caches them for 3 hours.
  - Whichever rates are in use are named with their date in the footer, the price tooltips and the methodology page. If both sources fail, the saved rates stay and keep their date.
  - Rates only move the **≈** conversions, never launch prices or value scores.
- **Latest headlines update automatically (Version 5).**
  - The News and Reviews pages show titles and links collected from the public RSS and YouTube feeds of registered sources: every 3 hours online, or on the spot with Refresh on the local server.
  - They are labelled "collected automatically, not checked by hand", are not documents or evidence, and never change a score, confidence level or verdict.
  - Only the publisher's own title and link are stored, never article text.
- **Every page load uses the newest files and starts clean (Version 10).**
  - A small service worker (`sw.js`) makes the browser check the server again for every file of this site on every load (`no-cache`: unchanged files return a quick "not modified"), and data files are fetched the same way. So after an update nobody sees an old script, style or data file, even on hosts such as GitHub Pages that let browsers keep files for about ten minutes. The local server already sends `no-store`.
  - Nothing from a previous visit carries over: the compare picks now live in memory only (a refresh empties them), and the chat, search box and AI switch already started fresh.
  - Deliberately kept: the theme and currency choice (display preferences), the exchange-rate answer for up to three hours (so the free rate service isn't asked on every page), and a downloaded AI model. Re-downloading 1–5 GB on every refresh would not be practical; the model is removed with the panel's "Remove the model from this browser" or the browser's site-data settings. The worker never touches other sites' files, so the model and fonts are not fetched again.

## 9. Pictures (Versions 5 to 7)

- **Official product images (Versions 6 and 7)**: the maker's own product picture from its Malaysian product, specification or support page (or, if gone, another official regional page, or the Internet Archive copy of the maker's page, whose archived address must still be the maker's page and image server), shown directly from the maker's image server to identify the model and credited to that page. They remain © the manufacturer and are not copied into this project. Each was looked at; marketing banners and wrong models were rejected. The build accepts them only from the makers' own image hosts and only with a credit.
- **Commons pictures (Version 5)**: freely licensed files on Wikimedia Commons (CC0, public domain, CC BY or CC BY-SA) that are the uploader's own photo or drawing. Manufacturer press images re-uploaded to Commons under a free licence are not used.
- Each picture was looked at to confirm the model. A picture shows the model, not necessarily the colour, region or configuration whose price is listed.
- Every picture is credited (author, licence, link to the file) on its device page and in the methodology page's Photo credits. Pictures are shown directly from Wikimedia and are not copied into this project.
- Devices without a suitable picture show a to-scale outline drawn from their recorded dimensions. That outline is a platform drawing, not a photo.
- **Not used for pictures:** GSMArena (its robots.txt asks Claude's crawlers not to fetch it), news sites' copies of press images, and any site that refuses automated requests (Sony's, for example). Seven phones therefore keep an outline in Version 7.

## 10. Coverage and specification sources (Versions 6 and 7)

- **Scope.** For Samsung, Apple, OPPO, vivo and iQOO, HONOR, Huawei, and Xiaomi with Redmi and POCO: every phone, smartwatch and fitness band with evidence of a Malaysian launch since January 2023. Evidence means a listing on the maker's Malaysian website or a Malaysian launch report (SoyaCincau, Lowyat.NET, Nasi Lemak Tech). Models reported only abroad are left out, with the reason recorded. Other brands are covered by their flagships only.
- **Specification sources, in order of preference:** (1) the maker's Malaysian specification page; (2) for Samsung pages that render only in a browser, Samsung's own specification data for the Malaysian model codes listed on Samsung Malaysia's support site, which is the data those pages display; (3) another official page of the same maker (a regional or global page) when the Malaysian page is gone, noted on the device; (4) the Malaysian launch report, class **news**, when no official page survives.
- **Reading and review.** Values were read from those pages by deterministic pattern matching, then reviewed: a script flags implausible values (a refresh rate that is really a touch-sampling rate, RAM that includes virtual "RAM Turbo", a price configuration the spec lists do not contain) and each flag was checked against the page. Anything a page does not state stays **Not recorded**; gaps are not filled from other devices or guesses.
- **Mixed sources on one device** are labelled per field. For example, most of a Samsung record is the maker's data (OFF) while its chip name came from a launch report (NEWS).
- **Malaysian prices** are matched to a sentence naming that exact model, with 4G/5G twins and Pro/Plus/Ultra siblings told apart, and every device's prices were reviewed against the article text. The recommended retail price is recorded; launch promotions are noted.
- **Launch dates** of Version 6 devices are the first Malaysian launch report's date, which can trail the global announcement. Where only a global announcement was reported, the date's source says so.
- **Not used:** GSMArena, whose robots.txt disallows Claude's crawlers and whose licence file forbids AI use of its content.
- **Full sheets (Version 7).** Every other field on the maker's sheet (bands, CPU and GPU, memory types, each camera module, video, audio, wireless, positioning, USB, sensors, biometrics, colours, charging wording) was read from the same official pages and added only where the record was empty. Values are shown in the maker's own wording; a few are derived from it and only when the maker states them: charging watts (the headline wired figure; adapter ratings and protocol voltages are not charging claims), optical zoom (real telephoto lenses only; sensor-crop "optical-quality" zoom, zoom-out and zoom-range figures are excluded) and IP ratings. Pixel density is calculated from resolution and diagonal and badged CALC.
- **Removed pages (Version 7).** When the maker's page has been taken down, the Internet Archive's copy of that page is read. Values from it are class **official**, cite the archived copy and name its capture date. Values recorded earlier from a launch report that also appear on the archived official page now cite it; the rest keep class **news**.
- **Cross-checks (Version 7).** Recorded battery capacities and weights were checked against each phone's cached official page, and Samsung values against Samsung's own specification data; one mismatch was corrected (Galaxy S25 battery).

## 10a. Reviews for the latest flagships (Version 10)

- **Which phones.** Each brand's newest top-tier line announced since August 2025: 29 phones (iPhone 18 Pro and Pro Max, iPhone Duo, Galaxy S26 series, Z Fold8, Fold8 Ultra and Flip8, Pixel 11 Pro and Pro XL, Huawei Pura 90s Pro and Pro Max, Mate 80 Pro and Mate X7, Xiaomi 17 Ultra and 17 Pro Max, vivo X300 Ultra and Pro, OPPO Find X9 Ultra, X9 Pro and Find N6, HONOR Magic8 Pro and Magic V6, OnePlus 15, realme GT 8 Pro, iQOO 15, POCO F9 Ultra, REDMAGIC 11 Pro). 28 have at least one review or review video; the Pura 90s Pro had no independent review yet (launch news and a sponsored article only).
- **Which sources.** Only outlets whose robots.txt allows Anthropic's crawlers, checked before any page was read: Engadget, 9to5Mac, 9to5Google, MacRumors, Android Authority, SamMobile, DXOMARK, Lowyat.NET and Nasi Lemak Tech (Malaysian). Not used: GSMArena (as before); Android Police and CNN, whose robots.txt blocks Anthropic's crawlers; The Verge and Notebookcheck, which refused automated reading; Trusted Reviews' site (error), though its YouTube review is linked; sponsored articles (SoyaCincau's Pura 90s piece says "brought to you by HUAWEI").
- **Findings** are short summaries in the site's own words, with the reviewer's score where given, tied to the review and its publisher. Hands-on and first-impression pieces say so in the text.
- **Measurements** were recorded only when the exact sentence was read back from the page: Engadget's video rundowns (Galaxy Z Fold8 28 h 14 min, Fold8 Ultra 32 h 11 min, Fold7 26 h 22 min on the cover screen; HONOR Magic V6 30 h 12 min on the main screen), Tom's Guide's battery test as reported by MacRumors (iPhone 18 Pro Max 18 h 27 min, 18 Pro 16 h 17 min, 17 Pro Max 17 h 54 min, 17 Pro 15 h 21 min) and DXOMARK camera scores (vivo X300 Ultra and OPPO Find X9 Ultra, 170 each). Each is a new metric compared only within the same test; DXOMARK scores are shown as evidence and do not yet feed the camera score. Numbers that appeared only in a search engine's summary were not recorded (PhoneArena's iPhone 18 Pro Max charging test, for example, because its page refused automated reading).
- **Videos** are linked only after YouTube's oEmbed record confirms the channel and title; they are linked, not summarised (the site cannot watch them). One search result titled "iPhone 18 Pro, Review (MKBHD)" was a re-upload by another channel and was rejected.
- **A correction found on the way:** the iPhone 18 Pro's "announced" date was 19 June 2026, taken in Version 6 from a pre-launch price-rumour article. Apple's announcement is 9 September 2026 (on sale from 18 September, Malaysia included); both iPhone 18 Pro records now cite it.

## 11. The built-in assistant (Versions 6 and 7)

- **Ask the hub** answers questions from the same data files the pages use. It is rule-based: it recognises device names, the detail asked about and the question's shape, then reads recorded values. It does not generate text beyond fixed sentence templates and never estimates a missing value.
- **Verdicts (Version 7)** such as "is it good?" or "worth buying?" are read from the scoring engine, not written: the device's position in the balanced (or asked-for use-case) leaderboard, its position among devices with a Malaysian launch price within ±20% of its own, the score categories where its like-for-like rank is in the top or bottom quarter, and its recorded update promise. When every category score is specification-only, or areas the profile weighs have no evidence, the answer is worded as partial and names those areas. "Is the display good?" uses that category's like-for-like rank only.
- **Yes/no checks** answer Yes or No only from a recorded value. When a maker's sheet lists the relevant section but not the feature (for example a SIM section without eSIM), the answer is "Not listed", not "No". When nothing is recorded, it is "Not recorded".
- **"Which is better"** uses each device's profile score, requires the site's minimum evidence coverage for every device named, and applies the same 3-point tie margin as the comparison page.
- **Spec-term explanations** are short general texts written for the site and labelled "General explanation, not a value measured or recorded by this site"; on a device page the device's own recorded value is added below, with its source.
- Every answer names the source of each value (from the field's provenance) and links the device page. Rankings say which devices were left out for lack of a value.
- Nothing typed is sent anywhere; the assistant runs in the browser.

## 11a. Optional AI answers (Versions 9 and 10)

- **What runs where.** Qwen3.5 4B (recommended where the device can run it) or 2B (Apache 2.0), quantised by the MLC project for WebLLM, runs in the visitor's browser on their graphics chip (WebGPU); or the browser's own built-in model where it offers one (Chrome's Prompt API), which the browser downloads and manages. The site does not host any model and no question is sent to an AI service. The visitor is told the download size and asked before anything is downloaded; the files stay in that browser until removed from the panel or with the browser's site data.
- **Division of labour.** The model does two jobs and is never a source of facts:
  1. **Understanding.** It reads the question into a plan whose shape is fixed by a JSON schema (what is being asked, device names as the visitor wrote them, budget, use case, which specs, which language). The site's own parser then re-reads the question and overrules the plan wherever it is sure: a device name the visitor never wrote is dropped, a budget must appear in the question, "X vs Y" is a comparison, "the lightest …" is a ranking, and an invented brand, use case or kind of device is removed.
  2. **Explaining.** The rule-based engine (section 11) answers the planned question. The model then writes the answer in the visitor's language from those facts only. Since Version 10 that is the device's whole record, not a handful of key facts: the full specification sheet (or the sections asked about first), for two or more devices every field that differs and what is the same (a field recorded for only one of them is marked as a gap, not a difference), the site's category scores with ranks and strong and weak areas, every Malaysian launch price, reviewer findings and test results with their publishers, and the latest headlines naming the device (labelled as unchecked). The model reads up to 8,000 tokens at once; if the facts are longer, the least important parts are left out first.
  3. **New question types (Version 10):** "what is the difference between X and Y" (a list of the main differences), "what do reviewers say / any problems" (review findings, credited) and "any news about X" (headlines, labelled as not checked).
- **Model choice (Version 10).** Qwen3.5 2B, 4B and 9B were run on the same 24 questions and every answer went through the same checks: 4B had none withheld, 2B one and 9B three, with 9%, 21% and 21% of sentences removed. 9B, although the largest, added more descriptions of its own and twice contradicted the site's ranking, and needs a 5 GB download. 4B is therefore recommended and 9B not offered.
- **Questions the rules cannot answer alone** ("is 5,000 mAh enough for a day?") are explained from the database spread and the site's explanations, and the panel says that is what it used.
- **Checks before display.** Each sentence is checked against the facts it was given; those that fail are removed and the rest is shown with a note. The answer is withheld altogether, and the verified answer shown with the reason, when more than half the sentences fail or a whole-answer check does. A sentence fails when it: states a figure not in the facts, or one belonging to a different device; claims a device has something recorded as "not recorded", or turns "not recorded" into "it doesn't have it"; says the site has no data on a device it does have; praises a listed weak point or criticises a listed strength; picks a winner where the site says "too close to call"; puts a unit on the wrong spec (including "200 万像素" for 200 MP); compares two figures the wrong way round ("lighter at 249 g than 211 g", also "lebih ringan … berbanding"); presents a publisher's test as the site's own ("our tests"); or uses a judgement word (faster, premium, recommended, affordable…) the facts don't. Repeated, cut-off and dangling sentences are dropped too.
- **Labelling.** A shown answer is marked "AI answer · <model> on your device", with "What I looked up", the verified answer and its sources open beneath it, and a note when sentences were removed. Since Version 10 a closed "Show all the data the AI was given" section holds the exact text the model read, so any answer can be checked line by line. The checks cannot catch every loose wording, which is why the verified answer is never hidden.
- **Worked-out differences (Version 10).** A figure that is the difference between two figures in the same sentence ("249 g against 211 g, 38 g heavier") is accepted; comparisons such as "lighter" or "cheaper" are accepted when both figures are in the sentence, so the reader can see them.

## 12. What the platform will not do

- Present an estimate or a chipset stand-in as a device measurement.
- Present a converted price as a local price, or score value from converted prices.
- Compare AnTuTu versions with each other, or single-run tests across different runs.
- Fill gaps with guesses: unknown specs are “Not recorded”, missing tests are “No data”, and verdicts without shared evidence say so.
- Republish review text: findings are short summaries in our own words, linked to the source.
- Treat an automatically collected headline as evidence, copy a publisher's picture into the site, or show an AI answer without what it looked up and the verified answer beside it.
- Let an AI model supply a fact. Every figure in an AI answer comes from the site's own lookup and is checked against it before the sentence is shown.
