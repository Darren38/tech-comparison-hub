# Changelog

## 24 September 2026 (third update)

A bug sweep of every page at phone and desktop widths, YouTube view counts with a "Most viewed" sort, and a daily automatic refresh of the benchmark databases and device pictures.

**Phone and desktop display**
- The EN/中文 switch no longer breaks "中文" onto two lines. It happened in English mode on phones up to 390 px wide and on desktops 1680 px and wider, because Chinese text may wrap between any two characters when the header squeezes the button. The switch now never shrinks or wraps.
- On small phones (320–360 px) the header was wider than the screen and pushed the menu button off it. The site name may now take two short lines and the tools sit closer, so the menu is always reachable.
- The header's width rules use the classic media-query form, so older phone browsers (for example Safari before iOS 16.4) apply them too.
- Table headings keep Chinese words whole: on a phone the Methodology scoring table showed "做工与便携" one character per line; a table that gets too wide now scrolls inside its own box.
- Checked on 21 page types at 360, 390, 768, 1024, 1366 and 1920 px in both languages: no sideways scrolling, nothing sticking out of the screen, no wrapped buttons or labels, no broken pictures. The header was measured at 18 widths from 320 to 1920 px.

**View counts and "Most viewed"**
- YouTube's channel feeds publish each video's view count; the collectors (on GitHub and in the browser's Refresh) now read it, and videos show "16M views" (in Chinese "1650万次观看").
- The Reviews & videos page has a Newest / Most viewed switch, both for the live list and for the checked reviews below it. Items without a count keep their newest-first order after the counted ones, and the page says when nothing in the list has a count.
- `live/views.json` keeps the counts for every video seen in the tracked channels, so a checked review video keeps showing how often it was watched after it drops out of the channel's latest videos.
- Articles do not publish view counts (none of the 18 news feeds does, and their comment counts are almost all 0), so only videos can be sorted this way. A count shows how many people a video reached, not whether it is accurate; the page says so.

**Daily automatic refresh, 08:05 Malaysia time**
- `tools/refresh_benchmarks.py` re-reads UL's 3DMark page for each of the 274 phones already matched, DXOMARK's public score list (117 phones) and AnTuTu's ranking. Only phones already matched by hand are refreshed, through the link or listed name recorded for them; a value that moves by more than 30% is held for a person to check; a source that can't be read keeps its saved values. AnTuTu has moved its ranking page (the recorded address now returns 404), so its values stay as checked until the new page is set up.
- `tools/check_images.py` checks that every device picture still loads (456 of 456 today); a picture that stops loading shows the outline drawing until it is fixed.
- The build applies both as a layer on top of the checked data (data/ is never rewritten). An update applies only while the value it replaces is still the one in data/, so a later correction by hand always wins. Documents re-read successfully count as checked that day.
- The GitHub workflow runs this once a day at 00:05 UTC (08:05 Malaysia time) and keeps the result in a cache for that day's later builds, so each source is visited once a day. The footer, the Charts page and Methodology say when the last check ran and how many values changed.
- Specifications, prices, reviewers' test tables and new devices are still read and added by hand: they need judgement that an automatic job can't give.

**Other fixes**
- A source's "Specification source for" section was labelled "Official data" even for news outlets; it now says "From launch reports" unless the source is the maker.

## 24 September 2026 (second update)

English and Chinese; Chinese and more Malaysian news sources in the live headlines; a picture of the device itself on almost every page.

**English and Chinese (简体中文)**
- An EN/中文 switch in the header. The choice is remembered on this device; a first visit follows the browser's language.
- The interface is written in English and translated as it is drawn, so no page had to be rewritten: 685 fixed phrases plus 117 patterns for text built from numbers ("463 台设备", "在 121 台证据相同的智能手机中排名第 3", "共识（中位数）：3 个独立来源相差在 4% 以内"). Navigation, the home page, charts, filters, device, compare, chipset, news, reviews, coverage and search pages, scores, verdicts, metric names and browser tab titles are all in Chinese.
- Left in the original language on purpose: review findings, headlines, source notes, device, chip and brand names, and the long Methodology text (a note says so). Numbers, sources and confidence are identical in both languages.

**Chinese sources and news**
- 快科技 (MyDrivers), IT之家 (IT Home) and 爱范儿 (ifanr) join the live headlines, both in the saved collection and the on-the-spot Refresh (the relay fetches whatever feeds the site lists, so no relay change is needed). Chinese brand names (小米, 华为, 荣耀, 三星, 一加…) are matched to the hub's devices, and Chinese topic words (手机, 平板, 骁龙, 天玑…) keep phone news and leave out car news.
- 极客湾 Geekerwan is registered as a reviewer. Its data site (socpk.com) serves its figures in an obscured format, so they were not extracted.
- Chinese-language headlines carry a "中文 / In Chinese" tag. An "Include Chinese-language sources" filter is on by default in Chinese and off in English.
- Fixed on the way: MyDrivers writes times in China time with no zone, which put its headlines eight hours in the future ("just now"). Feeds can now state their time zone.

**Malaysian outlets**
- **TechNave** and **Zing Gadget** (Malaysian tech news written in Chinese) are in the live headlines. Their robots rules were checked: TechNave blocks only Anthropic's training crawler, and Zing Gadget allows access outside its admin and search pages.
- Malaysian launch prices from their launch reports: the iPhone 18 Pro's RM5,499 now cites Zing Gadget's launch-day report instead of a June pre-launch article, and the OPPO A7 Pro Max gets its launch price (RM2,499, 8 GB / 256 GB).

**The newest China launches, with remarks**
- Added the flagships launched in China on 21–23 September 2026, each marked as not yet sold in Malaysia (with the source for when it is expected) and as having no independent tests yet: Xiaomi 18 Pro and 18 Pro Max (pre-order; Xiaomi Malaysia confirms a launch this year), OPPO Find X10 Pro Max, Find X10 and Find X10 E (on sale in China since 24 September) and vivo X500 Pro Max, X500 Pro and X500 (vivo Malaysia expects them towards the end of October). Chinese launch prices in yuan; specifications only where at least two launch reports agree (TechNave, Gizmochina, Zing Gadget, SoyaCincau, 快科技). Where reports disagreed, the note says which figure was used: FoneArena gave the Xiaomi 18 Pro the Extreme chip; TechNave swapped the Find X10 and Find X10 E prices; the X500 Pro Max battery is 8,000 mAh typical (7,800 mAh in TechNave's report).
- New chips: Snapdragon 8 Elite Gen 6, Dimensity 9600 Pro, Dimensity 9600M and Dimensity 9500S.
- Pictures from OPPO's and vivo's own Chinese product pages (the phone alone). mi.com refuses automated access, so the two Xiaomi phones have no picture yet.
- The Lowyat.NET feed was removed from the live headlines, since its robots rules disallow reading the feed. Lowyat.NET stays in the source registry for the prices it is cited for.

**Charts that name the real models**
- The Generations chart (following socpk.com's direct labelling) names actual phones everywhere: each line is labelled with its latest measured model ("Galaxy S26 Ultra", not "Galaxy S Ultra") in a column beside the plot with a leader to its last dot; the legend names each series by its first and latest model ("Galaxy S23 Ultra → S26 Ultra", "iPhone 15 Pro Max → iPhone 18 Pro Max"), with every model listed on hover; with four lines or fewer every dot is labelled with its model; a corner badge says whether higher or lower is better. On phones the chart keeps a readable size and scrolls sideways inside its box.

**Wrong published figures kept from spreading**
- A new "disputed" flag: a published result that every other test of the same hardware contradicts is shown on the device page with the reason, but counts towards no consensus, score or chipset stand-in.
- Trusted Reviews' OPPO Reno12 Pro Geekbench 6 (510 / 2,011) is under half its own single-core result for the same Dimensity 7300 on the Motorola Edge 50 Neo (1,052 / 3,031, now recorded for the chip). It had become the chip's value and was passed on to the Reno12 and Reno16 F; those three phones now show 1,052 / 3,031 as a chipset stand-in.
- Trusted Reviews' Galaxy Z Flip7 FE single-core (1,163) contradicts the review's own text (13% below the Flip6, about 1,660) and every other Exynos 2400 result (2,142–2,214). Its multi-core, which matches the text, is kept.

**Bug sweep of the whole site**
- Every page (688 routes: all 463 devices, 117 chipsets, sources, brands, categories, search and error pages) was opened in English and in Chinese, and about 440 buttons, filters and menus were used on 22 page types in each language. No script errors, broken images, dead links or "undefined"/"NaN" text remain.
- Fixed in Ask the hub: "Snapdragon 8 Elite Gen 5 phones" (a home-page example) listed every phone instead of the ones with that chip; "cheapest phone with wireless charging" ignored the wireless condition; "best …" answers ignored brand, chip and feature filters; chip-versus-chip questions ("A19 Pro vs A20 Pro", "Exynos 2600 vs Snapdragon 8 Elite Gen 5") got no answer or the wrong device; a device's performance line and the comparison table's performance row said "no tests" for phones that have scores. Questions in Chinese (小米17 Ultra 续航, RM3000以下最好的手机, 三星 … 和 … 哪个好) are now understood.
- Fixed the header on desktop screens between 1180 and 1600 px wide, where the new language switch pushed the theme button off-screen in English. Below 1680 px the switch shows only the language it switches to.
- Translated the remaining interface text found in Chinese mode (comparison verdicts, "+N pts", empty-state messages, error page).
- "Xiaomi Leica Leitzphone powered by Xiaomi" no longer repeats the brand.

**Pictures of the device itself**
- 456 of 471 devices have a picture (446 of 463 before), including the six new OPPO and vivo phones. Fourteen existing ones were added or replaced with the makers' own product images: iPhone 16 Pro Max, Apple Watch Series 11 and Ultra 3, iPad Air 13-inch (M3) and iPad Pro 13-inch (M5), Galaxy S25 Ultra, vivo X200 Pro, iQOO Z9, Redmi Note 14 Pro+ 5G, OPPO Watch X, OnePlus Pad 3, Huawei Watch GT Cyber and Watch Fit 3, and Galaxy A56 (a Commons photo of the phone alone).
- All 450 were checked by eye. Only two still show a hand: the Nothing Phone (3) (no other free picture) and the iPhone Duo (every picture Apple publishes shows it held).

## 24 September 2026 (first update)

Test results for most phones, flagships first; Samsung's Exynos and Snapdragon versions kept apart; rankings that use every lab's tests; a Charts page; and the latest checked news.

**Independent test results: 254 evidence records → 1,912**
- Phones with independent test data: 33 of 378 → 300. Among the 65 flagship-line phones of 2023–2026: Geekbench 6 17 → 49, 3DMark 14 → 55, battery tests 11 → 44, charging tests 7 → 52, measured brightness 6 → 31, camera lab tests 0 → 35, AnTuTu 15 → 32.
- **UL's official 3DMark device pages** (Wild Life Extreme, Steel Nomad Light, Solar Bay; the median of users' results) for 270 phones. Where a name was ambiguous ("5G" or not, a region tag, a page shared by two models), UL's chipset column had to name the same chip as the record.
- **AnTuTu's own V11 ranking** (the average of all results for each model, global data) for 65 Android phones, matched by name and chip.
- **DXOMARK's scores** (camera, display, battery, audio) for 117 phones. Camera scores from DXOMARK's previous protocol (version 5) and current one (version 6) are separate metrics, never compared with each other.
- **Tom's Guide's test tables** (48 reviews: Geekbench 6, battery on its web test, charging after 15 and 30 minutes, light-meter brightness, 3DMark stress stability) and **Trusted Reviews' Test Data** (119 reviews: Geekbench 6, charging, and battery used by an hour of HDR video, a new metric). Tom's Guide revised its battery test in 2025, so each phone's most recent figure is used. Results that depend on a mode (HONOR foldables' default power mode, the ROG Phone's X Mode) are noted or left out, and charging results for phones sold without a charger (measured with a generic charger that cannot use the brand's fast charging) are not recorded.
- Not used: Geekbench's browser, Notebookcheck and PhoneArena show a bot challenge; Sammy Fans, CNET and ZDNet bar Claude's crawlers; GSMArena's robots rules disallow it.

**Samsung's two chips kept apart**
- A result now carries the chip of the unit tested. Results for a Galaxy's Snapdragon version (the US S24, S24+, S26 and S26+, the Z Flip8) show on the phone's page as "Snapdragon … version, not counted in the value above", count towards that chip's results, and appear as their own striped bar on the Charts page; the Malaysian Exynos model's value uses Exynos results only. Tom's Guide's Galaxy S26+ review tested both chips; both are recorded.

**Rankings checked against each generation**
- Every flagship was compared with its direct predecessor in five rankings (75 pairs each). Newer models lead in performance 74, gaming 73, balanced 68, photography 65 and battery 55. Most of the remaining exceptions are what the tests found (the Galaxy S24+ lasts less than the S23+ in two labs' tests, the HONOR Magic7 Pro drains faster than the Magic6 Pro, the Xiaomi 15T Pro charges at 90 W against 120 W) or a newer phone not yet battery-tested.
- The battery score now averages every lab's battery test the phone has (GSMArena, Tom's Guide, DXOMARK, Trusted Reviews), each scored by where the result falls among that lab's own results, so a lab's scale can't decide it. Charging averages time to full and charge after 30 minutes; display adds DXOMARK's display score; the camera score adds DXOMARK's lab score to sensor size and zoom and is no longer "hardware only".
- Data fixed on the way: six iPhones (15, 15 Plus, 16, 16 Plus, 16e, 17e) listed Apple's "2x Telephoto" crop mode as a telephoto camera; the vivo X200's three cameras are now recorded from vivo Malaysia's page.

**Flagships first, charts and sources**
- New **Charts** page: ranked bars for each measured test (CPU, GPU, AnTuTu, battery, charging, display, camera) with each phone's name in its brand colour and every bar naming who measured it; and a **Generations** chart drawing each flagship series through the years. Flagships by default, all phones on request, filters by year and brand.
- Home page: flagship leaderboards (with sources on every row), "Best flagships for…", latest flagships. Devices: a "Flagship models" filter.
- Every phone page names who tested it ("Tested by" UL, DXOMARK, Tom's Guide…, with how many results each), linking to each source's page.

**Checked news**
- Galaxy S26 series stable One UI 9 rollout (SamMobile), Galaxy S26 price rise in India (SamMobile; India only), Motorola Signature 27 launch (Engadget; its seven-year OS promise added to the record). Reviews: Malay Mail's iPhone 18 Pro Max hands-on; Mrwhosetheboss's iPhone 18 Pro review and JerryRigEverything's durability test and teardown (a new "Teardown" video category). Headlines collected again at the end of the update: nothing newer needed checking.

## 23 September 2026 (third update)

The newest flagships everywhere the site suggests a comparison, the flagships launched up to today, and pictures of the phones themselves.

**Newest models by default**
- Quick compare and the "2026 flagship showdown" now start from the newest flagship of each brand: Galaxy S26 Ultra, iPhone 18 Pro Max, Xiaomi 17 Ultra and vivo X300 Ultra (the iPhone 17 Pro Max and vivo X300 Pro were a generation behind). "Battery kings" now pits the OnePlus 15, HONOR Magic8 Pro and OPPO Find X9 Ultra (7,050–7,300 mAh) against the Galaxy S26 Ultra, and "Premium smartwatches" compares the Apple Watch Ultra 4, Galaxy Watch Ultra 2 and Pixel Watch 5.
- The search examples, the search box hint and the Ask panel's examples name current models (Galaxy S26, iPhone 17, Redmi Note 17, Galaxy A27 instead of the Galaxy S25, iPhone 16, Redmi Note 14 and Galaxy A26). Each example was asked again and gets a real answer; for "Does the iPhone 17 have eSIM?" the iPhone 17's SIM line was added from Apple's page.

**Flagships launched up to 23 September 2026**
- Added: Pixel 11 and Pixel 11 Pro Fold (on sale in Malaysia from 20 August, from RM3,999 and RM7,999) and Pixel Watch 5 (RM1,799 / RM1,999), read from Google's own specification pages; Sony Xperia 1 VIII (RM6,499 in Malaysia from 5 August); Motorola razr ultra (2026); and the Motorola Signature 27, announced on 22 September, with the new Snapdragon 8 Elite Extreme Gen 6 added as a chipset. The Signature 27 is marked "announced": only what was confirmed is recorded, and it stays out of the rankings until it goes on sale.
- Sony's and Motorola's own sites refuse this crawler, so their phones come from SoyaCincau's Malaysian launch report and Android Authority's and Tech Advisor's specification lists, labelled as news.
- Checked and not added: the vivo X500 series, OPPO Find X10 series and Xiaomi 18 Fold have launched in China only (the site lists these brands' phones once they launch in Malaysia); the HONOR Magic 9 launches on 28 September; Nothing made no Phone (4) this year and ASUS cancelled the ROG Phone 10.

**Pictures of the phone itself**
- Photographs of phones held in a hand or in a shop were replaced with the makers' own product images or clean drawings: iPhone 17, 17 Pro and 17 Pro Max (Apple), Xiaomi 17 Ultra and 15 Ultra (Xiaomi), vivo X300 and X300 Pro (vivo Malaysia), iQOO 15 (iQOO Malaysia), OnePlus 15 and 13 (OnePlus), HONOR Magic8 Pro (HONOR Malaysia), Huawei Pura 80 Ultra (Huawei Malaysia), and Wikimedia Commons drawings for the Pixel 11 and Pixel 10 Pro. OnePlus's image server was added to the list of maker servers the build accepts.
- Still without a picture: Pixel 11 Pro Fold, Xperia 1 VIII, the two Motorola phones (no maker image the site may use, and no free one yet).

## 23 September 2026 (second update)

Headlines collected live when you press Refresh, news answers in Ask the hub, and flagship records filled in from the makers' own material.

**Live Refresh on the published site**
- A small relay (`relay/worker.js`, a free Cloudflare Worker the site owner sets up once; steps in `relay/README.md`) lets the browser read the publishers' feeds, which browsers otherwise may not. With it, Refresh on the News and Reviews pages collects the headlines on the spot instead of re-reading the collection saved every few hours, and a saved collection older than 20 minutes is replaced by a live one when the page opens.
- The relay fetches only the feed addresses the site itself publishes in `live/config.json`, answers only the site (and `localhost` for testing), passes the feed back unchanged and keeps each feed for two minutes, so it cannot be used to reach any other address and does not multiply requests to publishers.
- The browser applies the same rules as the Python collector (`src/engine/collect.js`, reading the feed list, topic and review patterns and device names from `live/config.json`), so a headline is kept and tagged the same way whoever collects it; a test collection matched the Python one headline for headline. If the relay cannot be reached, the page says so and keeps the newest collection it has. Until a relay address is set, the site behaves exactly as before.

**News in Ask the hub**
- "Any news about the Galaxy S26?", "Red Magic 12 Pro+ rumours", "when will the Galaxy S27 Ultra launch?", "latest tech news": the assistant lists the matching headlines with their publisher and age, collected live where the site can, and says when they were collected and that they are not checked by the site. Phones the site doesn't list yet are found by name in the headline titles, and a model is never mistaken for a similar one it does list (the Galaxy S27 Ultra is not the POCO F7 Ultra). With AI answers on, the model summarises the same headlines.

**Flagship records**
- The 63 phones in a flagship line were filled in from the makers' own material: Samsung's launch press releases (specification tables and footnotes), Apple's specification pages, Xiaomi's, POCO's, iQOO's, OnePlus's and Google's specification pages, using Internet Archive copies where a maker has removed its page or refuses automated reading. Missing values fell from 446 to 158 and complete records rose from 2 to 13; wired charging, launch OS, full camera lists, IP ratings, glass and update promises are now recorded for nearly all of them.
- Where a maker states no figure, a named secondary source is used and labelled: iPhone battery capacities and RAM from regulatory filings, Apple's EU energy labels and Xcode files as reported by MacRumors (News), main-camera sensor sizes from DXOMARK's camera tests (Reviewer), and a few update promises and specifications from Android Authority's list of update policies and SoyaCincau's Malaysian launch reports (News). A zoom factor that a maker gives only as focal lengths (Xiaomi: "75 mm" beside a "23 mm" main camera) is calculated and marked as the platform's calculation. A promise stated only for another market (iQOO's for India) is not used for Malaysia.
- Corrections found along the way: the Galaxy S24 Ultra's optical zoom was recorded as 3x (its periscope is 5x); the iPhone 17 Pro Max battery as 4,832 mAh (Apple's EU label gives 4,823 mAh for the nano-SIM model sold in Malaysia); the iPhone Air's wired charging as 60 W (Apple names a 20 W adapter); and the iPhone Air and iPhone Duo listed a "12 MP telephoto" that is a crop of the main camera, now removed as for other iPhones. For the Galaxy Z Fold8, Samsung's model page says 2,600 nits while the launch release gives "up to 3,000 nits" for the new Z series as a whole, so the model's own figure stays.
- Not found from any source that could be used: sensor sizes for iPhones and several Galaxy models, update promises for iQOO, some 2026 Galaxy models and several Xiaomi and POCO models, and the POCO F9 Pro and F9 Ultra pages (too new for an archive copy; Xiaomi's site refuses automated reading). GSMArena was not used: its robots.txt disallows Claude's crawlers.

## 23 September 2026 (first update)

Rankings that a gap in the record can no longer flatter, and device names that are no longer cut short.

**A missing value no longer counts in a device's favour**
- Until now a score simply left out what wasn't recorded, so the less a device had on record, the better it could look. The 2023 Xiaomi 13 Ultra scored **100 for camera hardware** because only its 1-inch main sensor was recorded, ahead of the 2026 Xiaomi 17 Ultra (87), whose 4.3× zoom is recorded as well; mid-range phones whose chipsets have no benchmark data (Redmi Note 17 Pro Max, OPPO A7 Pro Max, iQOO Z11) led the **overall ranking**, because performance was skipped for them and counted for everyone else.
- In rankings and use-case fits, evidence that isn't recorded now counts as **typical for a similar device**: the median of the same brand's devices of the same kind from the same or the previous year at a similar launch price; for charging and update promises, which follow the maker rather than the price, the brand's own recent devices; then any brand's similar devices; and where too few of those have it, the lower quartile of devices no newer than it. So a gap neither lifts a device nor punishes it for being new, and a 2023 phone is never given a share of 2026 chips' scores.
- **Comparisons are untouched.** They already score every device on the evidence all of them share, and the device page's like-for-like ranks (#n of m) are unchanged. Coverage still reports how much of a score is real evidence, and each device page now names the values counted as typical ("not recorded, counted as typical for similar devices: Zoom").
- **Devices not on sale yet** (announced or pre-order) are left out of the site's rankings and listed after the rest when you rank the database yourself: the announced iPhone Duo had topped the raw-performance ranking on its chip's pre-release listings.
- What changed as a result: the overall top ten is now all 2025–26 flagships (HONOR Magic8 Pro, vivo X300 Ultra, OnePlus 15, OPPO Find X9 Ultra …); within a product line the newer generation now leads its predecessor in 180 of 186 ranked pairs, against 170 before (iPhone 18 Pro Max above the 17 Pro Max, Pixel 11 Pro XL above the 10, Galaxy S26 Ultra above the S25 Ultra); and for photography the Xiaomi 17 Ultra now leads the 15 Ultra and 13 Ultra. The six remaining exceptions are gaps in older records, not the scoring.

**Display**
- In a narrow card, a device name is no longer cut down to "Galaxy S…": the note beside it ("70% evidence") drops to its own line instead, and every row in the card lines up the same way. This affected the comparison verdict with three or four devices, where the names were unreadable.
- The methodology page's two scoring tables no longer have to be scrolled sideways: their headings wrap, and the metric lists (written without spaces between the items, so a line could not break) now wrap between items.
- On a phone the home page no longer scrolled sideways: the Quick compare boxes were as wide as their longest device name. Long names in the measured leaderboards are now shown in full over two lines instead of being cut off.
- Checked afterwards with a sweep of every page at 1440, 768 and 375 px in both themes, looking for clipped text, content past the edge of the screen, unreadable dropdowns and sideways scrolling: none left, and the menus, the currency dropdown, the custom-weights panel and the Ask panel were opened and checked at phone width.

**Pictures and flagship records**
- The Galaxy S26 Ultra, Galaxy S26 and Galaxy Z Fold8 now use Samsung Malaysia's own product images instead of photographs taken in a shop or in someone's hand; the iPhone 17 Pro Max and Galaxy S25 Ultra use clean freely licensed photographs of the device alone. Where neither exists yet (Xiaomi, vivo, iQOO, OnePlus, HONOR, Huawei and a few others), the previous photograph stays, because the makers' sites refuse automated access or publish only marketing crops.
- Flagship records filled in from the makers' own specification pages: iPhone 15 Pro, 15 Pro Max, 16 Pro and 16 Pro Max (cameras with focal lengths and apertures, video, Ceramic Shield, Wi-Fi, Bluetooth, iOS at launch); Galaxy S25, S26, S26 Ultra, Z Fold8 and Z Flip8 (full camera lists with apertures, video, weight, dimensions, Wi-Fi, Bluetooth); Pixel 11 Pro and 11 Pro XL (cover glass, cameras, video, storage, weight, Wi-Fi, Bluetooth); OPPO Find X9 Pro (cover glass, video, the fourth camera). Apple's "2x Telephoto" crop entries are still left out, as before.

## 22 September 2026

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

## 20 September 2026 (second update)

The AI in Ask the hub stops being a summariser and becomes the part that understands the question.

**The model now works out what you mean, in your own words and language**
- Until now the model only reworded an answer the rules had already found, so a question the rules couldn't parse got no further. Now the model gets a job it is good at: **reading the question**. It fills in a plan (a JSON shape it must match: what is being asked, which devices, budget, use case, which specs, which language), the site's own code looks that up, and the model then **explains the result** in the visitor's language.
- So "phone for my mum, long battery, not too expensive, below 1.5k" becomes the site's ranking of phones by battery under RM1,500; "s25 ultra vs iphne 16 pro which one better for photo" becomes the camera comparison of the Galaxy S25 Ultra and the iPhone 16 Pro, typo and all; "telefon murah yang bagus untuk pelajar bawah RM1000" and "我想买一个拍照好的手机，预算2000令吉" become the right rankings and are answered in Malay and Chinese.
- **The rules check the model's reading.** Anything the site's own parser recognises wins: a device name the visitor didn't write is dropped, a budget must appear in the question, "X vs Y … which is better for photos" is a comparison, "the lightest Samsung phone" is a ranking, and a brand, use case or kind of device the model invented is removed. This fixed every wrong reading found in testing (a phone "for my mum" was given three invented model names; a comparison became a check for NFC and eSIM; "best smartwatch for swimming" became a gaming ranking; a brand from an earlier question carried over).
- **"How to choose" questions are answered at last.** "Is 5,000 mAh enough for a day?" or "how much RAM do I need for gaming?" have no single device to look up, so the site answers them with the spread of that spec across the database (median, best 10%, highest and lowest), its own explanation of the term, and what a use-case ranking weighs.
- **Bigger model, and the browser's own.** The choice is now **Qwen3.5 2B** (1.1 GB, the default) or **Qwen3.5 4B** (2.4 GB, clearly better answers, best with a separate graphics card), and the browser's **built-in AI** where it exists (Chrome's Prompt API; English only). The built-in model is tried once before it is used, because some Chromium builds offer the interface with no model behind it.
- **What the AI looked up is shown with every answer** ("What I looked up: 'best phone for battery life under RM1500'"), above the verified answer and its sources, with up to three follow-up questions to tap.

**Checks: sentence by sentence instead of all or nothing**
- A whole summary used to be thrown away when any check failed. Now the checks remove **only the sentences** that can't be confirmed and shows the rest, with a note ("2 sentences the checks couldn't confirm were left out"). An answer is still withheld when more than half of it would go, or when a whole-answer check fails.
- New checks: a figure given to the **wrong device** (each sentence is checked against the facts of the device it names, following "it" to the sentence before); a **tie** the site calls "too close to call" turned into a winner; **claiming a feature** the site records as not recorded ("supports eSIM, but this feature is not recorded"); saying the site has **no data on a device it does have**; repeated or cut-off sentences; a sentence left dangling by a removed one ("Both devices…"); "200 万像素" for 200 MP in Chinese.
- Loosened where testing showed the checks were too strict: a comparison with both figures in the sentence ("heavier at 224 g than the HONOR X9d at 193 g"), "best" for the device the site ranks first, "lighter" when the question asked for the lightest, and a ranking's later devices in any order (only the first must be the site's first).

**Fixes found in use**
- **Short model names people actually type.** "s24u", "24u", "s26u" and "16pm" now mean the Galaxy S24 Ultra, S26 Ultra and iPhone 16 Pro Max; before, "s24u" was read as the plain Galaxy S24 and "24u" as nothing. "s24u vs s24" correctly means two different phones, and a short name that a base model shares with its own variants ("y27", "note 13") now means the base model instead of matching nothing. Every one of the 457 full names still resolves to itself.
- **The conversation no longer scrolls sideways.** A wide comparison table (or a long follow-up suggestion) used to stretch the whole chat panel, so the left edge of every line was cut off. The table now scrolls inside its own box, long suggestions wrap, and the conversation itself never scrolls horizontally.

**Downloads that behave**
- The model download can be **cancelled**, says when it has stalled ("This is taking longer than expected"), and offers the smaller model instead. If the browser refuses to store a large file, the download moves to the browser's database (IndexedDB) instead of failing.
- Greetings and thanks are answered by the rules, without waking the model.

## 20 September 2026 (first update)

Optional on-device AI answers, and pictures on news and video cards.

**AI answers in Ask the hub (optional, no AI service)**
- An **AI answers** switch in the Ask panel. The first time, it explains what happens and asks before downloading **Qwen3 1.7B** (Apache 2.0; `Qwen3-1.7B-q4f16_1-MLC`, 984 MB in 30 files, or the q4f32 build on graphics chips without 16-bit shaders) from Hugging Face. **WebLLM 0.2.85** (from jsDelivr) runs it in a Web Worker on the device's graphics chip through WebGPU. Afterwards it loads from the browser's cache in about 3 seconds. Browsers without WebGPU get a plain explanation and the rule-based answers.
- **The rules still find the facts.** Each question is answered by the rule-based engine first. The model receives only that answer (converted to plain text) and is asked for a one-to-three-sentence summary in the question's language. The panel shows its progress but reveals the text only after the checks below, so a withheld summary is never on screen. Qwen3's "thinking" mode is switched off and the model runs at temperature 0 with a repetition penalty.
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

## 19 September 2026

Full specification sheets, pictures for nearly every phone, a Back button with a folder path, a fresh start for each visitor, and an assistant that answers everyday questions.

**Full specification sheets**
- Phone pages follow a familiar order: Network, Launch, Body, Display, Platform, Memory, Main camera, Selfie camera, Sound, Comms, Features, Battery, Misc (74 fields; was 8 sections). Watches and bands gain Launch, Wi-Fi, Bluetooth, positioning, NFC, all sensors and durability rows.
- New fields read from each maker's own sheet (Samsung: its specification data for the Malaysian model code): technology and 2G/3G/4G/5G bands, CPU, GPU and process, RAM and storage types, card slot, each rear and front camera module (resolution, aperture, OIS), camera features, video modes, speakers, 3.5 mm jack, Wi-Fi, Bluetooth, positioning, radio, USB, sensors, fingerprint and face unlock, battery type, the maker's charging wording, colours and model codes. Only empty fields were filled.
- Derived from the same pages where they state them: 9 wired and 9 reverse charging figures, 38 optical zoom values (sensor-crop "optical-quality" zoom excluded), 10 IP ratings, main-camera sensor size, aperture and OIS for 264 phones, and security-update end dates from Samsung's data for 19 models. Pixel density calculated for 321 more phones, badged CALC.
- Rows a source doesn't state are listed once under each section ("Not stated by the sources: …"); sections with nothing recorded are named in one line below the sheet. Module lists and long band lists wrap inside their cell.
- **Removed maker pages**: 17 official pages that are no longer online were read from their Internet Archive copies (badged OFF, linked to the archived copy with its capture date). 130 values previously taken from launch reports were confirmed against them and now cite the maker's page.
- **Correction**: Samsung's own data gives the Galaxy S25 a 4,000 mAh battery; the 18 September data recorded 4,900 mAh (the S25+ figure). Battery and weight values for every other phone with a cached official page were checked against that page and matched.

**Pictures**
- 445 of 457 devices now show a picture (previously 257), including **366 of 373 phones**. 185 new official product images come from Samsung Malaysia's support pages, the product-colour images on vivo and iQOO's specification pages, Xiaomi's product data, Huawei's specification pages (live, other regions, or archived), HONOR, OPPO, Apple's tech-specs images, ASUS ROG, REDMAGIC and realme; 3 more are freely licensed Wikimedia Commons photos.
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

## 18 September 2026

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
- For devices added on 18 September, "Announced" is the first Malaysian launch report's date; its source is shown on hover.

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

## 17 September 2026

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

## 16 September 2026

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
- Browse tables were wider than their box at 1280 px when the browser shows a scrollbar, hiding part of the Compare column (by 120 px in the ranking view, already the case before). Table prices are now compact: the header names the currency, and conversions and reasons go on a second line. The ranking view shows the chipset under the device name instead of in its own column. All table views now fit at 1280 px.

## 15 September 2026 (third release)

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

## 15 September 2026 (second release)

Quality checks 3–10 on top of the first release.

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

## 15 September 2026 (first release)

First release. Zero-build web app with a Python data build: 44 devices, 22 chipsets, 61 documents, 244 attributed evidence records; home, browse, device, compare, chipset, search, feeds, methodology, source and brand pages; quality checks 1–2.
