// Methodology: evidence classes, confidence rules, consensus, scoring weights, source registry,
// data ethics and the data pipeline. Numbers here are read from the live configuration.

import { html } from '../lib/html.js';
import { fmtDate, fmtNumber, plural, fmtDateTime } from '../lib/format.js';
import { store, metricDef, deviceTitle, brandName } from '../core/store.js';
import { href } from '../core/router.js';
import { provBadge, confMeter, tierBadge, sectionHead, tag, extLink, pageOutline, bindOutline, pageTrail } from '../ui/components.js';
import { ratesLabel } from '../engine/money.js';
import { t, isZh } from '../core/i18n.js';
import { GLOSSARY } from '../ui/plain.js';

/** Rates to 4 decimal places, the precision Bank Negara Malaysia publishes ("4.0975"). */
const fmtRate = (value) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);

/** "gsmarena.com" from "https://www.gsmarena.com/..." (the visible part of a website link). */
const hostOf = (url) => {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '');
    return u.hostname.replace(/^www\./, '') + (path && path.startsWith('/@') ? path : '');
  } catch {
    return url;
  }
};

const TOC = [
  ['glossary', 'Tech words explained'],
  ['classes', 'Evidence classes'],
  ['confidence', 'Confidence'],
  ['consensus', 'Consensus'],
  ['scoring', 'Scoring'],
  ['prices', 'Prices & currencies'],
  ['freshness', 'Data freshness'],
  ['sources', 'Source registry'],
  ['photos', 'Picture credits'],
  ['ethics', 'Data ethics'],
  ['assistant', 'Ask the hub'],
  ['pipeline', 'Data pipeline'],
];

export default async function render() {
  const { taxonomy, scoring, sources, build, currencies } = store.core;
  const v = scoring.verdict;
  const myPriced = store.devices.filter((d) => d.prices?.some((p) => p.region === 'MY')).length;
  const dataWindow = build.data ?? {};
  const auto = build.auto ?? {};
  const months = (a, b) => {
    if (!a || !b) return null;
    const [ay, am = 1] = a.split('-').map(Number);
    const [by, bm = 1] = b.split('-').map(Number);
    return (by - ay) * 12 + (bm - am);
  };
  const span = months(dataWindow.announcedFrom, dataWindow.announcedTo);
  const windowText = span === null ? '' : span >= 18 ? `about ${Math.round(span / 12)} years` : plural(span, 'month');
  const withPhoto = store.devices.filter((d) => d.image);
  const official = withPhoto.filter((d) => d.image.kind === 'official');
  const commons = withPhoto.filter((d) => d.image.kind !== 'official');
  const photos = commons.filter((d) => d.image.kind === 'photo').length;
  const officialByBrand = [...official.reduce((m, d) => m.set(d.brand, (m.get(d.brand) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
  const live = currencies.live;
  const feedSources = [...new Set((store.core.liveFeeds ?? []).map((f) => f.source))];
  const sourceLinkPlain = (id) => {
    const s = store.sourceById.get(id);
    return s ? html`<a href="${href(`/source/${id}`)}">${s.name}</a>` : id;
  };
  return {
    title: 'Methodology',
    html: html`<div class="method">
      ${pageTrail([{ label: 'Home', href: href('/') }, { label: 'Methodology' }])}
      <header class="method__head">
        <div class="eyebrow">How the hub works</div>
        <h1>Methodology</h1>
        <p class="muted" style="margin-top:8px;max-width:70ch">The hub keeps four things apart: what a manufacturer claims, what independent testers measured, what reviewers observed, and what this platform calculated from all of that. This page documents the rules, which are the same ones the code runs.</p>
        ${isZh() ? html`<p class="small" style="margin-top:8px">${t('The detailed methodology below is written in English; the numbers and rules are the same in both languages.')}</p>` : ''}
      </header>
      <div class="with-outline">
      ${pageOutline(TOC)}
      <div class="with-outline__main stack-lg">
        <section id="glossary">
          ${sectionHead('Tech words explained', { eyebrow: 'Start here' })}
          <p class="small muted" style="max-width:70ch">New to phones, watches or earbuds? These are the words you will meet on this site, in plain language. Switch the view to <strong>Simple</strong> (top of every page) to see short explanations next to the specifications too.</p>
          <dl class="glossary">${GLOSSARY.map(([term, text]) => html`<div class="glossary__item"><dt>${term}</dt><dd class="small">${text}</dd></div>`)}</dl>
        </section>

        <section id="classes">
          ${sectionHead('Evidence classes', { eyebrow: '1' })}
          <div class="grid grid-2">${taxonomy.evidenceClasses.map((c) => html`<div class="card class-card">${provBadge(c.id, { long: true })}<p class="small" style="margin-top:8px">${c.description}</p></div>`)}</div>
        </section>

        <section id="confidence">
          ${sectionHead('Confidence', { eyebrow: '2' })}
          <div class="grid grid-3">${taxonomy.confidenceLevels.map((l) => html`<div class="card">${confMeter(l.id)}<p class="small" style="margin-top:8px">${l.description}</p></div>`)}</div>
          <div class="card" style="margin-top:var(--sp-4)">
            <h3>Rules applied to every value</h3>
            <ol class="rules small">
              <li>Official specifications are <strong>high</strong> confidence as statements of what the product is. They never count as proof of performance.</li>
              <li>Records are grouped by <strong>independent origin</strong>. When a publication reports another lab's test (for example Notebookcheck reporting Geekerwan), the origin is the lab, so one test is never counted twice.</li>
              <li><strong>High</strong>: three or more independent sources within 10% of each other, or two within 12% where at least one is a tier-A lab or database.</li>
              <li><strong>Medium</strong>: two sources within 25%, or a single tier-A measurement.</li>
              <li><strong>Low</strong>: sources that disagree by more than 25%, a single secondary source, values taken from a search excerpt, or pre-release/prototype listings only.</li>
              <li>A device without its own test can borrow its chipset's consensus for chip-level benchmarks. That value is labelled “chipset” and capped at <strong>medium</strong>, because cooling and tuning change results. Sustained-performance metrics are never borrowed.</li>
              <li>Results on early software are capped at <strong>medium</strong>.</li>
            </ol>
          </div>
        </section>

        <section id="consensus">
          ${sectionHead('Consensus values', { eyebrow: '3' })}
          <div class="grid grid-2">
            <div class="card small stack">
              <p>For each device and metric, the build step takes the median of each independent origin's values, then the <strong>median across origins</strong>. The range shows the lowest and highest origin, and dot plots on device and chipset pages show every source on one axis.</p>
              <p>Different test versions are different metrics. <strong>AnTuTu v10 and v11 are never compared with each other</strong>; the comparison engine picks the newest version that every compared device has.</p>
            </div>
            <div class="card small stack">
              <p>Some tests are only meaningful <strong>within a single run</strong>: one reviewer's battery rundown, one lab's power measurement. Those are shown as head-to-head tables for the devices in that test and never mixed across tests.</p>
              <p>Regional variants matter. Where a lab tested a variant (for example the EU vivo X300 Pro with 5,440 mAh instead of 6,510 mAh), the record carries a variant tag.</p>
            </div>
          </div>
        </section>

        <section id="scoring">
          ${sectionHead('Scoring & verdicts', { eyebrow: '4', right: provBadge('platform', { long: true }) })}
          <div class="card small stack">
            <p>A metric score is relative to the best consensus value in the same device category: <code>value ÷ best</code> (or <code>best ÷ value</code> when lower is better, and a log scale for charging power and zoom, where returns diminish). Category scores are weighted means of the metrics that have evidence.</p>
            <p><strong>Flagship records and where their figures come from.</strong> The flagship lines of each year were filled in from the makers' own material: specification pages (Internet Archive copies where the maker has since removed a page) and launch press releases. Where a maker states no figure, it comes from a named secondary source and is labelled as such: battery capacity and RAM of iPhones from regulatory filings, Apple's EU energy labels and Xcode files as reported by MacRumors (News), and main-camera sensor sizes from DXOMARK's camera tests (Reviewer). Apple states no sensor sizes and no measured source does, so none is recorded for iPhones. A "2x Telephoto" that is a crop of the main camera is not counted as a telephoto camera.</p>
            <p><strong>What isn't recorded counts as typical.</strong> In rankings and use-case fits, a metric &mdash; or a whole category &mdash; with no evidence is given the median of similar devices: the same brand's devices of the same kind from the same or the previous year at a similar launch price, then (for charging and update promises, which follow the maker) the brand's other recent devices, then any brand's similar devices; where too few of those have it, the lower quartile of devices no newer than it. A gap therefore never lifts a device above better-documented ones, as it used to: a 2023 phone with only its 1-inch main sensor recorded scored 100 for camera hardware, above a 2026 phone whose zoom was recorded as well. Each score still shows how much of its evidence is real, and the device page names the values counted as typical. Comparisons are unaffected, because they already score every device on the evidence all of them share.</p>
            <p><strong>Devices not on sale yet</strong> (announced or on pre-order) are left out of the site's own rankings and listed after the rest when you rank the database yourself, because their figures come from pre-release listings at best.</p>
            <p>In comparisons, only metrics that <strong>every compared device shares</strong> are used, so a device is never rewarded just for being tested more often. A lead under <strong>${v.tieMargin} points</strong> is reported as too close to call. A category with less than ${Math.round(v.minCoverage * 100)}% shared evidence gets no verdict.</p>
            <p><strong>Camera.</strong> The camera score combines DXOMARK's lab camera score, where DXOMARK tested the phone, with main sensor size and optical reach. DXOMARK's version 5 and version 6 protocols give different scales, so each is scored only against results from the same protocol. A phone DXOMARK has not tested is scored on its hardware, with a typical lab score for similar phones standing in, and says so.</p>
            <p><strong>Exynos and Snapdragon versions.</strong> Some Galaxy phones use Samsung's Exynos chip in Malaysia and a Snapdragon elsewhere. Every result says which chip the tested unit had. A phone's page, score and rankings use results for the model sold in Malaysia; results for the other version are shown beside them, labelled with that chip, and count towards that chip's results instead. On the Charts page they are separate, striped bars.</p>
            <p><strong>Flagships first.</strong> Each brand's top lines count as flagships (Galaxy S and Z, iPhone, Pixel, Xiaomi numbered and T Pro, OPPO Find, vivo X, HONOR Magic, Huawei Mate and Pura, OnePlus numbered, iQOO numbered, POCO F Pro and Ultra, and the Sony, Motorola, Nothing, ASUS, REDMAGIC and realme flagships). Leaderboards, charts and the home page lead with them; the Devices filter "Flagship models" uses the same rule.</p>
            <p><strong>Several labs' tests together.</strong> Where several labs test the same thing in different ways (battery life from GSMArena, Tom's Guide and DXOMARK; charging as time to full and charge after 30 minutes), a ranking scores each result against that lab's own results and averages them, so a phone tested by more labs is judged on more evidence rather than on one test or a stand-in. A comparison of two phones still uses only a test both of them had.</p>
            <p>Value is the balanced score per unit of launch price, computed only in a currency every compared device has a price in.</p>
          </div>
          <div class="grid grid-2" style="margin-top:var(--sp-4)">
            <div class="table-wrap"><table class="data-table">
              <thead><tr><th scope="col">Category</th><th scope="col">Metrics and weights (smartphones)</th></tr></thead>
              <tbody>${scoring.categories.map((c) => html`<tr><th scope="row">${c.label}${c.specOnly ? html` ${tag('spec-based', 'warn')}` : ''}</th><td class="small dotlist">${(c.metrics.default ?? []).map((m) => html`<span class="nowrap">${m.combine === 'mean' ? 'average of ' : ''}${(m.alt ?? [m.id]).map((id) => metricDef(id)?.short).join(m.combine === 'mean' ? ', ' : ' or ')} <span class="muted">${Math.round(m.w * 100)}%</span></span>`)}</td></tr>`)}</tbody>
            </table></div>
            <div class="table-wrap"><table class="data-table">
              <thead><tr><th scope="col">Use-case profile</th><th scope="col">Category weights</th></tr></thead>
              <tbody>${scoring.profiles.map((p) => html`<tr><th scope="row">${p.label}</th><td class="small dotlist">${Object.entries(p.weights).map(([k, w]) => html`<span class="nowrap">${k === 'value' ? 'Value' : store.scoreCategoryById.get(k)?.label ?? k} <span class="muted">${Math.round(w * 100)}%</span></span>`)}</td></tr>`)}</tbody>
            </table></div>
          </div>
        </section>

        <section id="prices">
          ${sectionHead('Prices & currencies', { eyebrow: '5' })}
          <div class="grid grid-2">
            <div class="card small stack">
              <p>Prices are stored as <strong>launch prices in the currency they were announced in</strong> (for example, the Galaxy S26 Ultra 12 GB / 256 GB at RM5,999 in Malaysia and $1,299.99 in the US), each with its source.</p>
              <p>When you pick a display currency (${currencies.default} by default), a device shows its <strong>own launch price in that currency</strong> if one is recorded. Otherwise it shows a <strong>conversion, marked ≈</strong>, whose tooltip names the original price and the exchange rate.</p>
              <p>${currencies.conversionNote}</p>
              <p><strong>Malaysia:</strong> ${fmtNumber(myPriced)} of ${plural(store.devices.length, 'device')} have a verified Malaysian launch price (checked against the article or store page, with the link). The others state why not: not sold in Malaysia, no Malaysian launch found, or sold without a verified price. Use the “Sold in Malaysia” filter to hide the rest.</p>
            </div>
            <div class="table-wrap"><table class="data-table">
              <caption class="sr-only">Exchange rates used for conversions</caption>
              <thead><tr><th scope="col">Currency</th><th scope="col" class="num">1 unit in MYR</th></tr></thead>
              <tbody>${currencies.currencies.map((c) => html`<tr><th scope="row">${c.name} <span class="muted">${c.code}</span></th><td class="num">${fmtRate(c.toMYR)}</td></tr>`)}</tbody>
            </table>
            <p class="tiny muted" style="padding:10px 14px">Source: ${extLink(currencies.source.url, currencies.source.name)}${live ? '' : ' middle rates'}, ${fmtDate(currencies.asOf)}${currencies.session ? ` (${currencies.session} session)` : ''}. ${currencies.source.note ?? ''}</p></div>
          </div>
          <div class="card small stack" style="margin-top:var(--sp-4)">
            <h3>How the exchange rates stay current</h3>
            <p><strong>When the site is built</strong> (every few hours on the live site, or each time the local server starts), it downloads the latest ${extLink('https://www.bnm.gov.my/latest-rates', 'Bank Negara Malaysia')} middle rates, from its most recent session of the day. Bank Negara publishes new rates on Malaysian business days.</p>
            <p><strong>When you open the site</strong>, your browser checks whether those rates are from today (Malaysia time). If not, it asks ${extLink('https://www.exchangerate-api.com', 'ExchangeRate-API')} for newer daily rates and uses them. If that check fails (offline or blocked), the saved rates stay in use and are labelled with their date.</p>
            <p>${live ? html`<strong>Now in use:</strong> ${ratesLabel()}, checked when you opened this page (replacing ${live.replacedSource} rates of ${fmtDate(live.replacedAsOf)}).` : html`<strong>Now in use:</strong> ${ratesLabel()}.`} Launch prices themselves never change; only the ≈ conversions move with the rates.</p>
          </div>
        </section>

        <section id="freshness">
          ${sectionHead('How current the data is', { eyebrow: '6' })}
          <div class="card small stack">
            <p><strong>The research data is a dated snapshot, not a live feed.</strong> Every specification, test result, price and review finding was read from its named source and recorded with the date it was checked. Test results and review findings were read by hand; the specifications and Malaysian prices added for the full 2023–2026 catalogue were read automatically from the makers' pages and launch reports, then reviewed. The newest check in this build is <strong>${fmtDate(dataWindow.asOf)}</strong>. New devices, tests and prices appear only when the data files are edited and the site is rebuilt.</p>
            <p><strong>Some things do update automatically</strong>, and are labelled as such:</p>
            <ul class="rules">
              <li><strong>Exchange rates</strong>, as explained in section 5 above. In use now: ${ratesLabel()}.</li>
              <li><strong>Latest headlines</strong> on the <a href="${href('/news')}">News</a> and <a href="${href('/reviews')}">Reviews</a> pages: headlines and links collected from the public news and video feeds of ${plural(feedSources.length, 'publication')} (${feedSources.map((id, i) => html`${i ? ', ' : ''}${sourceLinkPlain(id)}`)}). The live site saves a collection every few hours, and its Refresh button collects them on the spot from the publishers' feeds (through a small relay that fetches only the listed feeds); with the local server, Refresh collects them on the spot too. The Ask panel answers news questions ("any news about the Galaxy S26?", "when will the Galaxy S27 launch?") from the same headlines, and says when they were collected. They are shown as links with the publisher's own title, are not read or checked by hand, and never change the scores. Videos and their view counts come from YouTube's official Data API (YouTube's robots.txt asks automated readers not to fetch its channel feeds), and the Reviews page can sort by view count; articles don't publish view counts.</li>
              <li><strong>Software updates, service offers and flagship chips.</strong> Each headline is also tagged by what it is about: iOS or One UI updates, problems people report after an update, Apple or Samsung service offers that name Malaysia (or come from a Malaysian source), and flagship chips. The News page shows each as its own section. Next to them are facts read automatically, about every 6 hours, from Apple's and Samsung's own pages: Apple's list of iOS and watchOS releases with dates, its developer release list for betas, Samsung's monthly security bulletin, and Apple Malaysia's list of current service programmes. Official pages behind a service offer are read for the part of Malaysia they name (East or West Malaysia, or a state). The One UI rollout order is worked out from the dates publications first reported each phone getting the update, and is labelled as such.</li>
              <li><strong>Benchmark databases and device pictures, every morning.</strong> Once a day at about 08:00 Malaysia time the site re-reads UL's 3DMark device page for each phone already matched, DXOMARK's public score list and AnTuTu's ranking (when its page can be read), and checks that every device picture still loads. Only phones already matched by hand are refreshed, through the link or listed name recorded for them, so no new match is ever guessed. A value that moves by more than 30% is held back for a person to check instead of being applied, a source that can't be read keeps its saved values, and a picture that no longer loads is replaced by the outline drawing until it is fixed.${auto.benchmarks ? html` Last check: <strong>${fmtDateTime(auto.benchmarks.at)}</strong> (${plural(auto.benchmarks.updated, 'value')} updated, ${auto.benchmarks.held} held for checking).` : ''} Reviewers' test tables, specifications, prices and new devices are still read and added by hand.</li>
            </ul>
            <p><strong>Coverage:</strong> devices announced from ${fmtDate(dataWindow.announcedFrom, 'month')} to ${fmtDate(dataWindow.announcedTo, 'month')}${windowText ? ` (${windowText} of launches)` : ''}. For <strong>Samsung, Apple, OPPO, vivo and iQOO, HONOR, Huawei, and Xiaomi with Redmi and POCO</strong>, the aim is every phone, smartwatch and fitness band with evidence of a Malaysian launch since January 2023: listed on the maker's Malaysian website, or reported launched in Malaysia by SoyaCincau, Lowyat.NET or Nasi Lemak Tech. Models found only abroad were left out. Other brands are covered by their flagships only. Older devices are not in the database yet.</p>
            <p><strong>Where the specifications come from</strong>, in order of preference: the maker's Malaysian specification page; for Samsung pages that only render in a browser, Samsung's own specification data for the Malaysian model code (what those pages display); another official regional page of the same maker when the Malaysian page is gone; the <strong>Internet Archive copy of the maker's page</strong> when the page itself has been taken down (still labelled OFF, with the archived copy linked and its capture date named); and otherwise the Malaysian launch report, labelled NEWS. Values were read from these pages automatically and reviewed; anything a page does not state is listed under “Not stated by the sources” rather than filled in from elsewhere. Chip names that a maker's Malaysian data leaves out were taken from launch reports and carry a NEWS badge.</p>
            <p><strong>Full specification sheets.</strong> Each phone's page follows a familiar layout (Network, Launch, Body, Display, Platform, Memory, Main camera, Selfie camera, Sound, Comms, Features, Battery, Misc) and includes everything the maker's own sheet lists: network bands, CPU and GPU, RAM and storage types, each camera module with its aperture, video modes, speakers and headphone jack, Wi-Fi, Bluetooth, positioning, USB, sensors, colours and the maker's own charging wording. Charging watts, optical zoom and IP ratings were only derived where the maker's page states them. Core values were cross-checked against the maker's data (for example, Samsung's own figures corrected one battery capacity recorded earlier).</p>
            <p><strong>Launch dates.</strong> For devices added in this version, the “Announced” date is the date of the first Malaysian launch report found (the global announcement can be a few days or weeks earlier); where only a global announcement was reported, that is said on the date's source. Devices with no dated launch report show no date.</p>
            <p><strong>Prices are launch prices</strong>, as announced. Shop prices usually fall after launch and are not tracked.</p>
            <p><strong>Ageing is flagged.</strong> Specifications last checked more than a year ago raise a build warning, and the <a href="${href('/coverage')}">coverage page</a> lists the devices still waiting for independent tests or a spec re-check.</p>
            <p><strong>Every visit gets the newest version and starts clean.</strong> Each time you open or refresh the site, your browser checks for newer versions of this site's files and data, so you never see an out-of-date page after an update. Nothing from an earlier visit carries over: the compare tray, the chat and the search box start empty. Your theme and currency choice are kept, and so is an AI model you downloaded (it is 1&ndash;5&nbsp;GB, so fetching it again on every visit wouldn't be practical); remove it from the Ask panel or your browser's site settings.</p>
            <p><strong>Reviews of the latest flagships.</strong> For each brand's newest top-tier phones, the site links published reviews and verified YouTube reviews, with the reviewers' points summarised in our own words and credited. Only sites that allow automated reading by Anthropic's crawlers were read (GSMArena, Android Police, CNN and The Verge were not), sponsored articles were left out, and video channels were confirmed with YouTube before linking. Test figures from a review (Engadget's video rundowns, Tom's Guide's battery test, DXOMARK camera scores) are recorded only when the exact sentence was read on the page, and are compared only with results of the same test.</p>
          </div>
        </section>

        <section id="sources">
          ${sectionHead('Source registry', { eyebrow: '7' })}
          <div class="grid grid-4" style="margin-bottom:var(--sp-4)">${taxonomy.sourceTiers.map((t) => html`<div class="card small">${tierBadge(t.id)} <strong>${t.label}</strong><p class="muted" style="margin-top:6px">${t.description}</p></div>`)}</div>
          <div class="table-wrap"><table class="data-table">
            <caption class="sr-only">Independent sources, with links to their websites</caption>
            <thead><tr><th scope="col">Source</th><th scope="col">Website</th><th scope="col">Type</th><th scope="col">Tier</th><th scope="col">Method</th></tr></thead>
            <tbody>${sources.filter((s) => s.type !== 'manufacturer').map((s) => html`<tr>
              <th scope="row"><a href="${href(`/source/${s.id}`)}">${s.name}</a>${s.status === 'planned' ? html` ${tag('planned', 'muted')}` : ''}</th>
              <td class="small">${s.url ? extLink(s.url, hostOf(s.url)) : html`<span class="muted">not recorded</span>`}</td>
              <td class="small">${s.type}</td><td>${tierBadge(s.tier)}</td>
              <td class="small muted">${s.methodology ?? '—'}${s.notes ? html`<div class="tiny faint">${s.notes}</div>` : ''}</td>
            </tr>`)}</tbody>
          </table></div>
          <p class="small" style="margin-top:12px">Manufacturers (tier O) are also sources: ${sources.filter((s) => s.type === 'manufacturer').map((s, i) => html`${i ? ', ' : ''}${s.url ? extLink(s.url, s.name) : s.name}`)}.</p>
          <p class="tiny muted" style="margin-top:6px">Links open the publisher's own site in a new tab. Each source's page on this hub lists the exact articles, videos and test pages cited.</p>
        </section>

        <section id="photos">
          ${sectionHead('Picture credits', { eyebrow: '8' })}
          <div class="card small stack" style="margin-bottom:var(--sp-4)">
            <p>${plural(withPhoto.length, 'device')} of ${store.devices.length} show a picture: ${plural(official.length, 'official product image')}, ${plural(photos, 'photo')} and ${plural(commons.length - photos, 'drawing')}.</p>
            <p><strong>Official product images</strong> are the manufacturers' own pictures, found on their Malaysian product, specification or support pages (or, where that page is gone, another official regional page, or the Internet Archive copy of the maker's page). They are shown directly from the manufacturer's website to identify the model, credited to the page they came from, and remain © the manufacturer. They are not copied to this site. Every image was checked by eye; marketing banners, pictures of other models and images that no longer load were rejected. GSMArena's pictures are not used: its robots.txt asks automated agents like the one that compiled this data not to fetch its pages. Makers' pictures often have wide white margins, so each picture is read once to find the rectangle the product fills, and pages show the picture cropped to it (the file itself is not changed or copied).</p>
            <p><strong>Photos and drawings</strong> are freely licensed files on Wikimedia Commons (Creative Commons or public domain), shown directly from Wikimedia with their author and licence.</p>
            <p><strong>Headline and video pictures</strong> are the thumbnails publishers put in their own RSS feeds, and YouTube's thumbnails for videos. They are shown from the publisher's or YouTube's server next to the headline they belong to, link to the article or video, and are not copied. GSMArena's are not shown (its robots.txt asks Claude's crawlers not to fetch its pages). A headline or checked news item without its own picture shows the picture of the device it is about, linking to that device here; if a picture fails to load, the publication's name is shown instead.</p>
            <p>Devices without either show a <strong>to-scale outline</strong> drawn from their recorded dimensions. A picture shows the model, but not necessarily the colour or storage version whose price is listed.</p>
            <p>Official images by maker: ${officialByBrand.map(([b, n], i) => html`${i ? ', ' : ''}${brandName(b)} ${fmtNumber(n)}`)}. Each device page names the page its image came from.</p>
          </div>
          <div class="table-wrap"><table class="data-table">
            <caption class="sr-only">Wikimedia Commons picture credits</caption>
            <thead><tr><th scope="col">Device</th><th scope="col">Wikimedia Commons file</th><th scope="col">Author</th><th scope="col">Licence</th></tr></thead>
            <tbody>${commons.map((d) => html`<tr>
              <th scope="row"><a href="${href(`/device/${d.id}`)}">${deviceTitle(d)}</a> ${d.image.kind === 'drawing' ? tag('drawing', 'muted') : ''}</th>
              <td class="small">${extLink(d.image.page, d.image.title ?? 'Wikimedia Commons file')}</td>
              <td class="small">${d.image.author ?? html`<span class="muted">not named</span>`}</td>
              <td class="small nowrap">${d.image.licenseUrl ? extLink(d.image.licenseUrl, d.image.license) : d.image.license}</td>
            </tr>`)}</tbody>
          </table></div>
        </section>

        <section id="ethics">
          ${sectionHead('Data ethics', { eyebrow: '9' })}
          <div class="grid grid-2">
            <div class="card small stack">
              <p><strong>No republishing.</strong> The hub stores structured facts (numbers, dates, test conditions), links and short summaries written in our own words. It does not copy review text or scrape databases in bulk.</p>
              <p><strong>Attribution on every value.</strong> Each record points to the document it came from, and the document names its publisher and, where different, the original tester.</p>
              <p><strong>No invented measurements.</strong> When a device hasn't been tested, the hub says so or shows a clearly labelled chipset stand-in. It never fills the gap with a guess dressed up as a measurement.</p>
            </div>
            <div class="card small stack">
              <p><strong>Verification status is visible.</strong> Values read from a search excerpt rather than the page itself are tagged “excerpt” and weigh less. Approximate publication dates are shown as “c.”.</p>
              <p><strong>Video sources are verified.</strong> Channel and title are confirmed against YouTube's own oEmbed record. Findings are only recorded when they come from the creator or a named write-up.</p>
              <p><strong>Registered but not yet used:</strong> NanoReview, SoCPK and DXOMARK are in the registry. Their data will be entered by hand with attribution, within each site's terms.</p>
            </div>
          </div>
        </section>

        <section id="assistant">
          ${sectionHead('Ask the hub', { eyebrow: '10' })}
          <div class="card small stack">
            <p>The <strong>Ask</strong> button opens a built-in assistant that answers questions from this site's data only. Its answers come from rules, not an AI model, and no online AI service is used: it recognises device names, the detail asked about (battery, price, chip, weight, bands, eSIM…) and a set of question shapes, then reads the recorded values and links their sources.</p>
            <ul class="rules">
              <li><strong>Everyday questions:</strong> “Is it good?”, “Is it worth buying?”, “Good for gaming?” or “Pros and cons” are answered from the site's scores: its overall (or use-case) rank, how it ranks against devices launched at a similar Malaysian price, its strongest and weakest areas, and its update promise. These are labelled as platform analysis, not a hands-on review.</li>
              <li><strong>Yes/no checks:</strong> “Does it have NFC / eSIM / a headphone jack / wireless charging?” answer Yes, No, “Not listed” (the maker's sheet doesn't mention it) or “Not recorded”, with the source.</li>
              <li><strong>Which is better:</strong> comparisons add each device's overall score and name the leader, or say it's too close to call when the gap is under the site's tie margin.</li>
              <li><strong>Spec terms:</strong> “What is IP68 / LTPO / UFS / eSIM?” get a short general explanation, clearly marked as general rather than a recorded value.</li>
            </ul>
            <p>It never guesses. A value that isn't recorded is answered as “not recorded”, “does it?” with no device named asks which device you mean, and questions it can't match get suggestions instead of an invented answer. On a device or comparison page it knows which devices “it” and “these” mean. Each time the panel opens, the previous conversation is cleared, and nothing you type leaves your browser.</p>
            <p><strong>Optional AI answers.</strong> The <strong>AI answers</strong> switch in the panel runs a small open model &mdash; ${extLink('https://huggingface.co/Qwen/Qwen3.5-4B', 'Qwen3.5 4B')} (about 2.4&nbsp;GB, recommended on computers that can run it) or ${extLink('https://huggingface.co/Qwen/Qwen3.5-2B', 'Qwen3.5 2B')} (about 1.1&nbsp;GB, for smaller devices), both Apache 2.0 &mdash; inside your own browser with ${extLink('https://github.com/mlc-ai/web-llm', 'WebLLM')} and WebGPU, or your browser's own built-in model where it has one. Nothing is sent to an AI service: after you agree, the browser downloads the model once (from Hugging Face), keeps it and runs it on your device's graphics chip. It needs a recent Chrome or Edge with WebGPU; elsewhere the switch says so and the rule-based answers carry on. The panel can remove the model from the browser again.</p>
            <ul class="rules">
              <li><strong>The model reads your question; the site answers it.</strong> Ask in your own words or language &mdash; &ldquo;phone for my mum, long battery, below 1.5k&rdquo;, &ldquo;telefon murah untuk pelajar bawah RM1000&rdquo;, with typos. The model turns that into a plan (what you are asking, which devices, budget, use case), the site's own code looks it up in its data exactly as the rules above do, and the model explains the result in your language. It never supplies a figure itself, and the rules overrule its reading wherever they recognise a device, budget, brand or ranking.</li>
              <li><strong>It reads everything the site records.</strong> For a question about one or two devices the model is given their whole record &mdash; the full specification sheet, every difference between them, the site's scores with strong and weak areas, all Malaysian launch prices, review findings and test results with their publishers, and the latest headlines &mdash; so it can answer &ldquo;what is the difference between the iPhone 18 Pro and Pro Max?&rdquo; or &ldquo;what do reviewers say about the Galaxy Z Fold8?&rdquo;. Under each answer, &ldquo;Show all the data the AI was given&rdquo; opens the exact text it read.</li>
              <li><strong>Questions with nothing to look up</strong> &mdash; &ldquo;is 5,000&nbsp;mAh enough for a day?&rdquo;, &ldquo;how much RAM do I need for gaming?&rdquo; &mdash; are answered from how that spec is spread across this database, the explanations above, and what each ranking weighs. The panel says that is what it used.</li>
              <li><strong>Every sentence is checked before it is shown.</strong> A sentence is removed when it states a figure the facts don't contain or gives one device another's figure; claims a device has something recorded as &ldquo;not recorded&rdquo; (or turns &ldquo;not recorded&rdquo; into &ldquo;it doesn't have it&rdquo;); says this site has no data on a device it does have; praises something the scores list as a weak point (or the reverse); picks a winner where the site calls it too close to call; attaches a figure to the wrong spec; compares two figures the wrong way round (&ldquo;lighter at 249&nbsp;g than the one at 211&nbsp;g&rdquo;); presents a publisher's test as this site's own (&ldquo;our tests&rdquo;; the site tests nothing itself); or adds a judgement such as &ldquo;more powerful&rdquo; or &ldquo;recommended&rdquo; that the data doesn't state. The answer says how many sentences were left out, and is withheld altogether when more than half would go.</li>
              <li><strong>Why these models.</strong> Qwen3.5 2B, 4B and 9B answered the same 24 questions through the same checks. None of the 4B answers had to be withheld and 9% of its sentences were removed; 2B had one answer withheld and 9B three, and both had 21% of their sentences removed. The 9B wrote fluently but added more descriptions of its own (&ldquo;top-tier&rdquo;, &ldquo;excellent&rdquo;) and twice put devices in a different order from the site's ranking, and it is a 5&nbsp;GB download. So 4B is recommended and 9B is not offered.</li>
              <li><strong>What it looked up is always shown.</strong> Every AI answer is labelled with the model that wrote it, the query it ran, and the site's own answer with its sources open underneath. Small models can still word things loosely; the verified answer is what counts.</li>
            </ul>
          </div>
        </section>

        <section id="pipeline">
          ${sectionHead('Data pipeline', { eyebrow: '11' })}
          <div class="card">
            <ol class="flow">
              <li><strong>data/</strong><span class="tiny muted">Human-edited JSON: devices, chipsets, sources, metrics, documents with records and findings</span></li>
              <li><strong>tools/build.py</strong><span class="tiny muted">Validates references, units and plausible ranges, derives spec metrics, groups origins, computes consensus and confidence</span></li>
              <li><strong>generated/</strong><span class="tiny muted">Compact indexes plus one file per device, chipset and source</span></li>
              <li><strong>Web app</strong><span class="tiny muted">Scores, verdicts, search, filters; loads each device file on demand</span></li>
              <li><strong>Ask the hub</strong><span class="tiny muted">Rule-based answers read from the same data, with sources</span></li>
              <li><strong>Evidence pack</strong><span class="tiny muted">Cited JSON a future AI assistant could use</span></li>
            </ol>
            <p class="tiny muted" style="margin-top:12px">Current build: ${fmtDate(build.time.slice(0, 10))} · ${fmtNumber(build.counts.devices)} devices · ${fmtNumber(build.counts.chipsets)} chipsets · ${fmtNumber(build.counts.documents)} documents · ${fmtNumber(build.counts.records)} evidence records · ${fmtNumber(build.counts.specRecords)} spec-derived values · ${plural(build.warnings, 'validation warning')}.</p>
          </div>
        </section>
      </div>
      </div>
    </div>`,
    mount(root) {
      return bindOutline(root);
    },
  };
}
