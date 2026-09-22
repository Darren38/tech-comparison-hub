# Changelog

## Version 10 (10.0.0) — 2026-09-22

Fresh files on every visit, reviews for the latest flagships, and an AI that reads everything the site records.

**Every visit gets the newest version and starts clean**
- A small service worker (`sw.js`) makes the browser check the server for every file and data file of the site on each load, so an update is never hidden by the browser's cache, including on GitHub Pages. Unchanged files come back as a quick "not modified".
- The compare tray now lives in memory only, so a refresh starts with an empty comparison (the chat, search box and AI switch already did).
- Kept on purpose: the theme and currency choice, the exchange rates for up to three hours, and a downloaded AI model (1–5 GB; re-downloading it on every refresh wouldn't be practical). The worker never touches other sites' files, so the model is not fetched again.

**Reviews for the latest flagships**
- 30 new documents for each brand's newest top-tier phones: written reviews and hands-ons from Engadget, 9to5Mac, 9to5Google, MacRumors, Android Authority, SamMobile, DXOMARK, Lowyat.NET and Nasi Lemak Tech, and YouTube reviews from Dave2D, Ben Sin, Gizmochina, Trusted Reviews and SomeGadgetGuy. 28 of the 29 latest flagships now have at least one review; the Huawei Pura 90s Pro has none yet (only launch news and a sponsored article).
- Reviewers' points are summarised in the site's own words, with their scores and publishers. Sites whose robots.txt blocks Anthropic's crawlers (Android Police, CNN), sites that refused reading (The Verge, Notebookcheck), GSMArena, and sponsored content were not used. Every video's channel was confirmed through YouTube; one fake "MKBHD" re-upload was rejected.
- Three new test types, each compared only with itself: **Engadget video rundown** (Z Fold8, Fold8 Ultra, Fold7, HONOR Magic V6), **Tom's Guide battery test** (iPhone 18 Pro, 18 Pro Max, 17 Pro, 17 Pro Max) and **DXOMARK Camera score** (vivo X300 Ultra and OPPO Find X9 Ultra, 170 each). Numbers were recorded only when the exact sentence was read on the page.
- REDMAGIC 11 Pro: a finding that UL delisted it from several 3DMark tests for boosting performance when it recognises benchmark apps; its benchmark scores are not recorded.
- Correction: the iPhone 18 Pro was listed as announced on 19 June 2026 (a pre-launch price-rumour article). Apple announced both iPhone 18 Pro models on 9 September 2026, on sale from 18 September including Malaysia; the Pro Max was also still marked "pre-order".

**The AI uses everything the site knows**
- For a question about one or two devices the model now reads their whole record: the full specification sheet, every field that differs (a field recorded for only one device is marked as a gap, not a difference), what is the same, the site's scores with strong and weak areas, all Malaysian launch prices, review findings and test results with publishers, and the latest headlines. The context window is doubled to 8,000 tokens; if the facts are too long, the least important parts are left out first.
- New kinds of question: **"what is the difference between X and Y"** (a list of the main differences with both figures), **"what do reviewers say / any problems with X"** (review findings, credited) and **"any news about X"** (headlines, labelled as unchecked).
- **Show all the data the AI was given**: a closed section under every AI answer with the exact text the model read.
- Checks: a difference worked out from two figures in the same sentence ("38 g heavier") and comparisons with both figures in view (including Malay "lebih murah") are accepted; the tie check only fires when an answer names a winner.

**Model choice: Qwen3.5 4B recommended, 9B tested and not adopted**
- Qwen3.5 2B, 4B and 9B answered the same 24 questions on the same graphics card, and every answer went through the same checks. 4B: all 23 answers shown, 9% of sentences removed, 20 s per answer. 2B: 1 answer withheld, 21% of sentences removed, 13 s. 9B: 3 withheld, 21% removed, 29 s, and a 5 GB download needing 6.4 GB of graphics memory. The bigger model wrote more fluently but added its own descriptions ("top-tier", "excellent") and twice contradicted the site's ranking.
- So the offer now recommends **Qwen3.5 4B** on computers that can run it, with 2B as the smaller option (the browser's built-in AI stays first where it exists). If the built-in AI fails its check, 4B is offered first. 9B is not offered.
- New checks from the test answers: a publisher's test presented as the site's own ("based on our tests"), a comparison with its two figures the wrong way round ("lighter at 249 g than 211 g", also in Malay), and a spec question read as a verdict. Checks that were too strict were fixed (ranking order with brand-less names such as "Note 15 Pro+" or "S23"; strengths and weak points now checked per device and clause by clause, and praise of a device's own listed strengths is no longer removed; a comparison may use the figure in the sentence before).
- Understanding: a device name the model adds a model word to ("Redmi Note 14" planned as the "Redmi Note 14 Pro 5G" after an earlier answer about it) is refused; Chinese answers follow the question's script (simplified or traditional); "they"/"both"/"它们" in an answer refers to all the devices named just before.
- The site's comparison lines now say what is better in words ("charges faster (wired): 33 W vs 30 W", "has the bigger battery", "is brighter (claimed peak)") instead of "has the higher figure".
- Data fixes found while testing: the iPhone 18 Pro record's camera list (a 2× crop listed as a 12 MP camera), Bluetooth version and charging wording, and the Pro Max's missing camera megapixels, all re-read from Apple Malaysia's specification pages.

## Version 9 (9.0.0) — 2026-09-20

The AI in Ask the hub stops being a summariser and becomes the part that understands the question.

**The model now works out what you mean, in your own words and language**
- Version 8's model only reworded an answer the rules had already found, so a question the rules couldn't parse got no further. Version 9 gives the model a job it is good at: **reading the question**. It fills in a plan (a JSON shape it must match: what is being asked, which devices, budget, use case, which specs, which language), the site's own code looks that up, and the model then **explains the result** in the visitor's language.
- So "phone for my mum, long battery, not too expensive, below 1.5k" becomes the site's ranking of phones by battery under RM1,500; "s25 ultra vs iphne 16 pro which one better for photo" becomes the camera comparison of the Galaxy S25 Ultra and the iPhone 16 Pro, typo and all; "telefon murah yang bagus untuk pelajar bawah RM1000" and "我想买一个拍照好的手机，预算2000令吉" become the right rankings and are answered in Malay and Chinese.
- **The rules check the model's reading.** Anything the site's own parser recognises wins: a device name the visitor didn't write is dropped, a budget must appear in the question, "X vs Y … which is better for photos" is a comparison, "the lightest Samsung phone" is a ranking, and a brand, use case or kind of device the model invented is removed. This fixed every wrong reading found in testing (a phone "for my mum" was given three invented model names; a comparison became a check for NFC and eSIM; "best smartwatch for swimming" became a gaming ranking; a brand from an earlier question carried over).
- **"How to choose" questions are answered at last.** "Is 5,000 mAh enough for a day?" or "how much RAM do I need for gaming?" have no single device to look up, so the site answers them with the spread of that spec across the database (median, best 10%, highest and lowest), its own explanation of the term, and what a use-case ranking weighs.
- **Bigger model, and the browser's own.** The choice is now **Qwen3.5 2B** (1.1 GB, the default) or **Qwen3.5 4B** (2.4 GB, clearly better answers, best with a separate graphics card), and the browser's **built-in AI** where it exists (Chrome's Prompt API; English only). The built-in model is tried once before it is used, because some Chromium builds offer the interface with no model behind it.
- **What the AI looked up is shown with every answer** ("What I looked up: 'best phone for battery life under RM1500'"), above the verified answer and its sources, with up to three follow-up questions to tap.

**Checks: sentence by sentence instead of all or nothing**
- Version 8 threw a whole summary away when any check failed. Version 9 removes **only the sentences** that can't be confirmed and shows the rest, with a note ("2 sentences the checks couldn't confirm were left out"). An answer is still withheld when more than half of it would go, or when a whole-answer check fails.
- New checks: a figure given to the **wrong device** (each sentence is checked against the facts of the device it names, following "it" to the sentence before); a **tie** the site calls "too close to call" turned into a winner; **claiming a feature** the site records as not recorded ("supports eSIM, but this feature is not recorded"); saying the site has **no data on a device it does have**; repeated or cut-off sentences; a sentence left dangling by a removed one ("Both devices…"); "200 万像素" for 200 MP in Chinese.
- Loosened where testing showed the checks were too strict: a comparison with both figures in the sentence ("heavier at 224 g than the HONOR X9d at 193 g"), "best" for the device the site ranks first, "lighter" when the question asked for the lightest, and a ranking's later devices in any order (only the first must be the site's first).

**Fixes found in use**
- **Short model names people actually type.** "s24u", "24u", "s26u" and "16pm" now mean the Galaxy S24 Ultra, S26 Ultra and iPhone 16 Pro Max; before, "s24u" was read as the plain Galaxy S24 and "24u" as nothing. "s24u vs s24" correctly means two different phones, and a short name that a base model shares with its own variants ("y27", "note 13") now means the base model instead of matching nothing. Every one of the 457 full names still resolves to itself.
- **The conversation no longer scrolls sideways.** A wide comparison table (or a long follow-up suggestion) used to stretch the whole chat panel, so the left edge of every line was cut off. The table now scrolls inside its own box, long suggestions wrap, and the conversation itself never scrolls horizontally.

**Downloads that behave**
- The model download can be **cancelled**, says when it has stalled ("This is taking longer than expected"), and offers the smaller model instead. If the browser refuses to store a large file, the download moves to the browser's database (IndexedDB) instead of failing.
- Greetings and thanks are answered by the rules, without waking the model.

## Version 8 (8.0.0) — 2026-09-20

Optional on-device AI answers, and pictures on news and video cards.

**AI answers in Ask the hub (optional, no AI service)**
- An **AI answers** switch in the Ask panel. The first time, it explains what happens and asks before downloading **Qwen3 1.7B** (Apache 2.0; `Qwen3-1.7B-q4f16_1-MLC`, 984 MB in 30 files, or the q4f32 build on graphics chips without 16-bit shaders) from Hugging Face. **WebLLM 0.2.85** (from jsDelivr) runs it in a Web Worker on the device's graphics chip through WebGPU. Afterwards it loads from the browser's cache in about 3 seconds. Browsers without WebGPU get a plain explanation and the rule-based answers.
- **The rules still find the facts.** Each question is answered by the Version 7 engine first. The model receives only that answer (converted to plain text) and is asked for a one-to-three-sentence summary in the question's language. The panel shows its progress but reveals the text only after the checks below, so a withheld summary is never on screen. Qwen3's "thinking" mode is switched off and the model runs at temperature 0 with a repetition penalty.
- **Every summary is checked before it's shown.** It is withheld, and the verified answer shown with the reason, when it:
  - states a figure the site's answer doesn't contain;
  - turns "not recorded" into "doesn't have" (or never mentions that something isn't recorded);
  - praises an area the verdict lists as a weak point, or criticises a strength;
  - names ranked devices out of the site's order, or not starting with the first;
  - attaches a unit to the wrong spec ("4,970 mAh of storage");
  - adds a judgement ("more powerful", "faster", "recommended", "affordable"…) the data doesn't state.
- The verified answer and its sources are open under every AI summary, labelled "A short summary written by a small AI model… the verified answer is what counts." A **Stop** link interrupts a long answer; **Remove the model from this browser** deletes the download. The switch is off at the start of every visit; the chat still resets each time the panel opens.
- The assistant's own descriptions ("are you an AI?", help) and the methodology page explain the option and its checks.

**Pictures on news and videos**
- The headline collector now keeps the thumbnail each publisher puts in its own RSS item (media:thumbnail, image media:content or enclosure, or the first image in the summary): 105 of the latest 126 headlines. Only the address is stored; pictures load from the publisher's server. GSMArena's thumbnails are not kept.
- **Latest headlines** cards show the picture on the left. Headlines without one show the device they mention, or a tile with the publication's name, so rows stay aligned. A picture that fails to load turns into that tile.
- **Checked news, reviews and videos** cards (news and reviews pages, brand, chipset, source and search pages) show YouTube's thumbnail for videos and the related device's picture for other documents; on a device's own page only video thumbnails are shown.
- The news timeline shows a picture beside each item; the home page's news and video lists show small pictures.
- **Home page:** a new **Fresh from the feeds** row with the four newest headlines that have a picture (devices in this hub first).
- **Device pages:** an **In the headlines** strip with up to four recent headlines naming the device, above its checked news.

**Fixes found in testing**
- A budget question after a list ("bawah RM1000" after "best phone under RM1500") was answered about the previous list's devices; a budget without "it" now starts a new list. Malay budget words (bawah, di bawah, kurang dari/daripada, bajet) are understood.
- On a device page, a singular "it" after an answer about several devices now means the device on the page.

## Version 7 (7.0.0) — 2026-09-19

Full specification sheets, pictures for nearly every phone, a Back button with a folder path, a fresh start for each visitor, and an assistant that answers everyday questions.

**Full specification sheets**
- Phone pages follow a familiar order: Network, Launch, Body, Display, Platform, Memory, Main camera, Selfie camera, Sound, Comms, Features, Battery, Misc (74 fields; was 8 sections). Watches and bands gain Launch, Wi-Fi, Bluetooth, positioning, NFC, all sensors and durability rows.
- New fields read from each maker's own sheet (Samsung: its specification data for the Malaysian model code): technology and 2G/3G/4G/5G bands, CPU, GPU and process, RAM and storage types, card slot, each rear and front camera module (resolution, aperture, OIS), camera features, video modes, speakers, 3.5 mm jack, Wi-Fi, Bluetooth, positioning, radio, USB, sensors, fingerprint and face unlock, battery type, the maker's charging wording, colours and model codes. Only empty fields were filled.
- Derived from the same pages where they state them: 9 wired and 9 reverse charging figures, 38 optical zoom values (sensor-crop "optical-quality" zoom excluded), 10 IP ratings, main-camera sensor size, aperture and OIS for 264 phones, and security-update end dates from Samsung's data for 19 models. Pixel density calculated for 321 more phones, badged CALC.
- Rows a source doesn't state are listed once under each section ("Not stated by the sources: …"); sections with nothing recorded are named in one line below the sheet. Module lists and long band lists wrap inside their cell.
- **Removed maker pages**: 17 official pages that are no longer online were read from their Internet Archive copies (badged OFF, linked to the archived copy with its capture date). 130 values previously taken from launch reports were confirmed against them and now cite the maker's page.
- **Correction**: Samsung's own data gives the Galaxy S25 a 4,000 mAh battery; Version 6 recorded 4,900 mAh (the S25+ figure). Battery and weight values for every other phone with a cached official page were checked against that page and matched.

**Pictures**
- 445 of 457 devices now show a picture (V6: 257), including **366 of 373 phones**. 185 new official product images come from Samsung Malaysia's support pages, the product-colour images on vivo and iQOO's specification pages, Xiaomi's product data, Huawei's specification pages (live, other regions, or archived), HONOR, OPPO, Apple's tech-specs images, ASUS ROG, REDMAGIC and realme; 3 more are freely licensed Wikimedia Commons photos.
- Every candidate was checked by eye. Rejected: text banners, pictures of other models from page menus (two Huawei phones picked up tablet images before the filter was tightened), an unrelated promotion image, and images that no longer load.
- GSMArena was not used (its robots.txt asks Claude's crawlers not to fetch it). 7 phones without an official or free image that could be verified keep their to-scale outline.
- The build accepts an official image from the Internet Archive only when the archived address is the maker's own page and image server, and now also accepts ASUS, REDMAGIC and realme image servers.

**Navigation**
- Every page (except Home) starts with a **Back** button that names the page you came from ("Back to Methodology") and a clickable **folder path** ("Home › Methodology › Source registry › GSMArena"). With no earlier page (a shared link), Back goes one level up.
- Back returns to the same scroll position, retrying briefly while long pages finish laying out.
- Links to a page section (`?section=`) now land on the section even when opened directly or after a reload (an early re-render used to cancel the jump), and `#/page#section` links are understood too.
- Brand pages show their parent brands in the path (Devices › ZTE › nubia › REDMAGIC). A parent brand with no devices of its own (ZTE, nubia) lists its sub-brands' devices instead of an empty page. Chip-maker source pages (Qualcomm, MediaTek…) list that maker's chipsets.

**A fresh start for each visitor**
- The header search box is emptied when the site opens, after navigating and when the page is restored from the browser cache.
- The Ask panel starts a new conversation every time it opens.
- The comparison tray lasts for the browser session only (it used to persist for the next person on the same computer); picks saved by earlier versions are removed. Theme and currency preferences are kept.

**Ask the hub: everyday questions (still no AI service)**
- **Verdicts**: "Is it good?", "Worth buying?", "Should I buy the Galaxy A16?", "Pros and cons", "Good for gaming / photos / students?" give the device's rank overall or for that use, its rank among devices launched at a similar Malaysian price (±20%) with the top scorers there, its strongest and weakest areas with the spec behind each, its update promise and age. When the score rests on specification sheets only or leaves areas out, the answer says so and lists them. "Is the display / camera / battery good?" judges that one area.
- **Yes/no checks** for one or several devices: NFC, eSIM, dual SIM, 5G, wireless, fast and reverse charging, headphone jack, card slot, IR blaster, stereo speakers, UWB, OIS, telephoto, Wi-Fi 6/7, fingerprint, face unlock, GPS, ECG, SpO2 and water resistance. Answers are Yes, No, "Not listed" (the maker's sheet doesn't mention it) or "Not recorded", with the source.
- **Which is better**: comparisons add each device's overall (or use-case) score and name the leader, or call it too close under the site's 3-point tie margin, noting when scores are specification-only.
- **Spec terms**: about 40 short general explanations (IP ratings decoded digit by digit, ATM, mAh, silicon-carbon, LTPO, OLED/LCD, refresh rate, nits, PWM, HDR, eSIM, NFC, UWB, 5G/4G, Wi-Fi 6/6E/7, Bluetooth, USB, UFS, LPDDR, chipset, NPU, OIS, telephoto/periscope, aperture, megapixels, cover glass, benchmarks, wireless/reverse/fast charging, GNSS, IR blaster, SpO2, ECG, heart rate, stereo speakers, maker skins), labelled as general. On a device page the device's own value is added.
- Greetings, thanks, "are you ChatGPT?", and "does it…?" with no device named ("Which device do you mean?"). New starter questions on device, comparison and home pages.

**Fixes found in testing**
- Eight links to methodology sections (`#/methodology#scoring`) opened "Page not found".
- The ZTE and nubia brand pages were empty, and chip-maker source pages showed only zeros.
- "Gaming doesn't apply to smartphones" was shown when a phone simply had no gaming evidence.
- The "data as of" date ignored values checked at field level; it now reads 19 September 2026.

## Version 6 (6.0.0) — 2026-09-18

Four years of Malaysian models, fitness bands, official product images and a built-in assistant.

**Coverage: 44 → 457 devices**
- Every phone, smartwatch and fitness band from **Samsung, Apple, OPPO, vivo and iQOO, HONOR, Huawei, and Xiaomi with Redmi and POCO** with evidence of a Malaysian launch since January 2023: 413 new devices (337 phones, 59 smartwatches, 17 fitness bands). Candidates came from the makers' Malaysian sitemaps and product listings, checked against Malaysian launch reports.
- 16 candidates were left out, each with a recorded reason: no Malaysian launch evidence (for example vivo models reported only in India), not sold in Malaysia (Galaxy S25 Edge), not launched yet (HONOR X9e Pro), or no specifications anywhere.
- **Specifications**: 383 new devices from official sources (the maker's Malaysian spec page; Samsung's own spec data for 41 Samsung models whose pages render in the browser; another official regional or global page where the Malaysian one is gone), 30 from Malaysian launch reports, badged NEWS. GSMArena was not used.
- **Chips**: 94 new chipset records (name, maker and the phones that use it). 42 chip names came from launch reports because the maker's Malaysian data leaves them out.

**Malaysian launch prices**
- 560 new prices for 353 devices, each linked to the SoyaCincau, Lowyat.NET or Nasi Lemak Tech launch report it came from. Recommended retail prices are recorded; early-bird and promotional prices are noted beside them.
- Each price was matched to a sentence that names that exact model (sibling-aware, so a Pro or 5G price never lands on the base model) and every device was reviewed by hand against the article text.
- 58 devices sold in Malaysia without a found launch price say so.
- For V6 devices, "Announced" is the first Malaysian launch report's date; its source is shown on hover.

**Fitness bands**
- A new **Fitness bands** category (17 bands: Galaxy Fit3, Xiaomi Smart Band 8 to 10 and 11 Active, Huawei Band 8 to 11 and HONOR Band 9 and 10) with brand, price, year, battery-life and water-resistance filters, its own spec sections and the watch-style outline.

**Official product images**
- 226 devices show the maker's own product image, loaded from the maker's website and credited ("Product image: OPPO Malaysia · © the manufacturer"). Each candidate was checked visually; marketing banners (most vivo and iQOO candidates) were rejected. The build only accepts images from the makers' own image hosts with a credit.
- The methodology page's picture section summarises official images by maker and keeps the Wikimedia Commons credit table.

**Ask the hub**
- An **Ask** button on every page (a bottom sheet on phones) opens a built-in assistant. It recognises device names (including short forms like "S24" or "Reno14" and 4G/5G twins), the detail asked about, and question shapes: one device, comparisons, rankings with filters (brand, year, budget, 5G, foldable, sold in Malaysia), best-for lists, brand lists and questions about the site.
- It answers only from the site's data, names each value's source, says "not recorded" for gaps, and remembers the devices in the previous answer ("which is lighter, it or the Pixel 10?"). It is rule-based, not an AI chatbot, and nothing typed leaves the browser.
- Device pages have an **Ask about this device** card with starter questions.

**Browsing a bigger database**
- The device list shows 48 at a time with **Show more** (keeping your place), and a **release-year** filter.
- Long filter lists show the eight most common options with the rest folded under "All N options".

**Validation**
- The build accepts official images only from makers' image hosts, with a credit, and the `band` category.
- Phones and tablets without a named chip are listed once in a build note instead of a warning per device; wearables are not listed, since makers rarely name their chips.

**Fixes found in testing**
- Spec extraction no longer reads touch-sampling rates as refresh rates, "WLAN 5G" or other models' names as 5G support, or HONOR's "RAM Turbo" virtual memory as RAM.
- The brand filter showed seven of its eight top brands because the box was height-capped.
- Claimed wearable battery life read "504:00h" (the format for measured battery tests); it now reads "21 days" or "36 h" on cards, spec sheets and comparisons.
- Assistant: budget questions rank by the attribute asked about ("biggest battery under RM1,500"), "best … under RMx" uses the scores, and "smartwatchs" is now "smartwatches".

## Version 5 (5.0.0) — 2026-09-17

Real device pictures, live headlines with a Refresh button, exchange rates that update themselves, section navigation, source website links, and GitHub Pages publishing.

**Device pictures**
- **31 of 44 devices** now show a real picture instead of an outline: 26 photos and 5 drawings, all freely licensed files on Wikimedia Commons (CC0, CC BY or CC BY-SA). Each was looked at to confirm the model. Pictures load from Wikimedia and are credited with author, licence and file link on the device page, in its Sources table, and in a new **Photo credits** section on the methodology page.
- The Pixel 10, 10 Pro XL, 11 Pro and 11 Pro XL use back-view drawings, which show the camera bar, rather than front views with a blank screen.
- Devices without a free picture (13) keep their to-scale outline. If a picture fails to load (offline, blocked), the outline replaces it automatically.
- Rejected: manufacturer press images re-uploaded under a free licence, a Galaxy Watch photo that could not be confirmed as the Watch8 Classic, a photo of the base model standing in for a Pro or Ultra, and name-only wordmark files.
- New `tools/add_photo.py` looks up a Commons file, refuses non-free licences and missing authors, and writes the image block. `--focus` sets the crop for wide photos on small cards. The build validates every image block.

**Latest headlines with Refresh**
- The News and Reviews & videos pages open with a **Latest headlines** panel: headlines, reviews and videos from the public RSS and YouTube feeds of 19 registered sources (`data/meta/live-feeds.json`), from the last 45 days.
- **Refresh** collects on the spot when running `serve.py` (at most once a minute). On a static host it loads the newest scheduled collection. New items are marked **New**, and the status line says when the headlines were collected and how many feeds answered.
- Headlines are matched to devices by model name (for example "Galaxy A56", but not "unlike 17 Pro"), with an "Only devices in this hub" filter. Titles and links only, labelled as not checked by hand. They never affect scores.
- The hand-checked documents below the panel are now headed "Checked news" and "Checked reviews & tests".

**Exchange rates that update**
- `tools/update_rates.py` downloads Bank Negara Malaysia's latest middle rates, from its most recent session of the day. `serve.py` runs it at start-up and the GitHub workflow every 3 hours. If Bank Negara is unreachable, the saved rates stay.
- When the saved rates are not from today (Malaysia time), the browser fetches newer daily rates from ExchangeRate-API at page load. It caches them for 3 hours and re-renders prices. The footer and methodology page name the source and date in use.

**Easier reading**
- A new **"On this page"** outline on device, compare, methodology and coverage pages: a sticky side rail at 1180 px and wider, a sticky scrollable bar below that. It highlights the current section, shows reading progress and jumps to sections without hiding headings under the sticky header. It replaces the device page's old section tabs and the methodology page's tabs, which did not stay visible.
- "At a glance" on device pages no longer leaves an empty grey cell when its last row is short.

**Links to sources**
- The source registry has a **Website** column, and every manufacturer name links to its site. The exchange-rate and headline sources are linked too.
- Device pages link each launch price to the article it was read from, and each availability status to its evidence.
- Fixed four MediaTek chipset links (Dimensity 8350, 9400, 9400+ and 9500) that returned 404 or pointed at the homepage.

**Going live**
- `.github/workflows/pages.yml` refreshes rates and headlines, validates and builds the data, and publishes to GitHub Pages on every push, every 3 hours and on demand. A data error stops the run and keeps the previous version online.
- `.gitignore`, and a deployment guide in `docs/DEPLOYMENT.md`. All data and page paths are relative, so the site works from a sub-folder such as `username.github.io/repo/`.

## Version 4 (4.0.0) — 2026-09-16

Verified Malaysian launch prices for every device, and a stated data cut-off.

**Malaysian prices**
- **40 of 44 devices** now have their official Malaysian launch price (44 entries, as some list two configurations). Each was read from the launch article on 16 Sep 2026 and is linked: SoyaCincau (35 devices), Malay Mail (iPhone 17, 17 Pro, 17 Pro Max), Nasi Lemak Tech (iQOO 15, OnePlus 15).
- The other four state why there is no ringgit price, with the evidence:
  - vivo X200 Ultra: not sold in Malaysia (China only).
  - Xiaomi 17 Pro Max: not sold in Malaysia (not part of Xiaomi's global line-up).
  - Motorola Edge 60 Pro: no Malaysian launch found.
  - OnePlus Pad 3: listed on OnePlus Malaysia's site, but no official price found.
- **Correction:** the Galaxy S26 Ultra's RM6,799 was recorded as the 12 GB / 256 GB price. It is the 512 GB price; Samsung Malaysia's 256 GB model is RM5,999 (announced as "coming soon" at launch).
- New **“Sold in Malaysia”** filter in every category. Prices say “not sold in MY”, “no MY launch found” or “MY price not found” where that applies, and the device page explains why, with the source and the check date.
- In ringgit, rankings now score value from Malaysian launch prices (the currency with the most real prices), and so do comparisons between devices sold in Malaysia.
- SoyaCincau, Malay Mail and Nasi Lemak Tech added to the source registry. The vivo X200 Ultra gains its verified China launch price (CN¥6,499, GSMArena).
- Price tooltips name the source instead of its internal id.

**Data freshness**
- The footer states “Data as of 16 Sep 2026, not live” and the launch window covered (Sep 2024 to Sep 2026), with a link to a new “How current the data is” section on the methodology page.
- The build computes these dates from the data (the newest source check, the earliest and latest announcement), so they stay true after every edit.

**Data model**
- Price entries record when they were read (`accessed`). A new per-region `availability` block records status, check date, source and note. The build validates both, and rejects an availability status for a region that already has a price.
- Each currency in `currencies.json` names its region, which links ringgit to Malaysian availability.

**Final re-check fixes**
- The price filter drifted by a ringgit when switching currency and back (RM4,000 → $983 → RM4,001). A filter from a link keeps its own currency and values in the URL until you edit it.
- “Closest rivals” compared prices in US dollars only, so devices without a US price were matched on everything except price. Rivals are now matched on ringgit prices (the Malaysian price, or a conversion), which changes the suggestions for 36 devices.
- The unused `priceUsd` filter field was removed from the build.
- `--report` lists any device that has neither a Malaysian price nor an availability status, so new devices can't silently break the “every device” promise.
- The hidden compare tray no longer keeps stale buttons after it is cleared.
- Out-of-date examples fixed: the methodology page and docs still quoted the Galaxy S26 Ultra at RM6,799 (the 512 GB price) next to the 256 GB US price, and used a conversion example for a phone that now has a Malaysian price. The Lowyat.NET launch-day news summary now explains its RM6,799 figure.

**Layout**
- Browse tables were wider than their box at 1280 px when the browser shows a scrollbar, hiding part of the Compare column (by 120 px in the ranking view, already the case in Version 3). Table prices are now compact: the header names the currency, and conversions and reasons go on a second line. The ranking view shows the chipset under the device name instead of in its own column. All table views now fit at 1280 px.

## Version 3 (3.0.0) — 2026-09-15

Display currency with Malaysian ringgit as the default, plus a full bug and wording sweep.

**Currency**
- A currency menu in the header (inside the menu on phones): MYR (default), USD, EUR, GBP, SGD, CNY and INR. The choice is remembered on the device, and the current page re-renders in place, keeping its scroll position.
- A device shows its own launch price in the chosen currency when one is recorded (Galaxy S26 Ultra: RM6,799). Otherwise it shows a conversion marked **≈** with the source region (“≈ RM4,881 from US”). The tooltip and the device page give the original price, the rate and its date.
- Rates: Bank Negara Malaysia middle rates of 14 Sep 2026 in `data/meta/currencies.json`. The build checks them: positive rates, a valid date, a known default, and a rate for every currency a device price uses.
- The price filter, price sort and table column follow the chosen currency. Price links carry their currency (`?priceMax=4000&cur=MYR`) and are converted when opened in another one.
- Search understands RM, $, €, £, S$, ₹, CN¥, “ringgit” and “4k” (“best gaming phone under RM4,000”). An amount with no symbol uses the chosen currency.
- Value scores still use only real launch prices. Comparisons use the chosen currency when every device has a price in it, otherwise the first common one; rankings use the currency with the most real prices. Converted prices are never scored.
- New “Prices & currencies” section on the methodology page, with the rate table and source.

**Bugs fixed**
- Header: with the currency menu, the nav wrapped (“Reviews & videos” over three lines) and pushed the theme button off-screen between 1181 and 1439 px. The search box now becomes an icon in that range and nav labels never wrap.
- Prices with cents could print rounded ($1,299.99 as $1,300) when a whole-number price in the same currency had been formatted first.
- Singapore dollars would have printed as plain “$”; each currency now has a fixed symbol, and ringgit prints the Malaysian way (RM6,799).
- Plurals: “smartwatchs”, “1 sources”, “1 records”, “1 findings”, “1 devices” (device cards, document tags, the comparison bibliography, chart descriptions, video-feed stats, chipset and brand search results).
- A double full stop after the provenance note on device pages (“…launch coverage.. Rows with…”) and in tied overall verdicts.
- Partial dimensions printed as “? × ? × 7.99 mm”; now “Thickness 7.99 mm (height and width not recorded)”.
- Search-suggestion links to external sources had broken `target`/`rel` attributes (escaped quotes), so they opened without `noopener`; the compare tray's disabled button had the same fault.
- Unknown device, chipset, source or brand ids showed “Something went wrong” and logged a console error. They now show the not-found page.
- Empty `id=""` attributes on section headings; no main heading on the search and not-found pages.
- Watches were recommended “for gaming” and “for photography”. A use case now has to apply to at least half its weight before it is recommended or ranked, and comparisons say when the chosen use case barely applies.
- Leaderboard footers said “top 6” without the total; trailing “·” separators on the methodology page; “100 /100”; “Consensus (median)” shown for a single source.
- `serve.py` now declares UTF-8 for HTML, JS, CSS, JSON and Markdown, so ≈, ″, · and € always display correctly.

**Wording**
- “Best smartphones for balanced” → “Best smartphones overall”; “X is the better pick for balanced” → “for most buyers”; ties name both devices.
- Search intents read naturally (“Best smartphones for gaming under RM4,000”).

## Version 2 (2.0.0) — 2026-09-15

Quality checks 3–10 on top of Version 1.

**Comparison engine**
- Key differences: a digest of the biggest real gaps. The leader is compared with the next-best device, a gap qualifies at 12% or more (2+ years for updates), chipset stand-ins are excluded, and each item shows its evidence class, source and confidence.
- Custom weights: sliders per score category plus value, stored in the URL; recomputes only the overall verdict.
- Ties read symmetrically (“A ahead on … / B ahead on …”) instead of “Why / But”.
- The camera verdict for the flagship comparison is now decided, after three camera specs were sourced (S26 Ultra and iPhone 17 Pro Max main-sensor sizes, Xiaomi 17 Ultra zoom range).

**Source transparency**
- The source name is shown under every value in the comparison benchmark table (“chipset stand-in” where applicable).
- Bibliography on every comparison: documents per device, chipset evidence used as stand-ins, and specification sources.
- Evidence badge on device pages (independent measurements · documents).

**Evidence coverage (new)**
- `/coverage` page and `index/coverage.json`: metric coverage per category, untested devices, missing key tests, records per original tester, extraction status, planned sources.
- `python tools/build.py --report` prints the same report; specs checked more than a year ago raise a warning.

**Data tooling**
- JSON Schemas for devices, chipsets and documents (`data/schema/`), mapped in `.vscode/settings.json`.
- `tools/new_device.py` scaffolds a correctly structured device file after checking brand, category, chipset and id.

**Accessibility and polish**
- WCAG contrast audit of the design tokens in both themes: every text pair now meets 4.5:1 (it failed on `--faint`, buttons, badges, series letters, the platform badge and warning tags).
- New `--accent-strong` for filled accent surfaces, dark text on accent in dark mode, and a distinct colour for the Estimated class.
- Device-page scrollspy; sensor sizes formatted as optical formats (1″, 1/1.28″).

**Code quality**
- Removed dead exports (`goCompare`, `verdictSentence`, `fmtDateShort`, `capitalize`, `metricBars`, a `join` re-export) and unused imports.
- The intent→URL mapping now lives only in `engine/intent.js`.
- The non-enumerable-property workaround in profile scoring is replaced by an explicit `category` parameter.

## Version 1 (1.0.0) — 2026-09-15

First release. Zero-build web app with a Python data build: 44 devices, 22 chipsets, 61 documents, 244 attributed evidence records; home, browse, device, compare, chipset, search, feeds, methodology, source and brand pages; quality checks 1–2.
