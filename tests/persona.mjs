// Version 28: test the site as different kinds of visitors, plus link-integrity checks.
// node persona.mjs <cdp port> <base>      e.g. node persona.mjs 9333 http://127.0.0.1:8228/
const [port, base] = process.argv.slice(2);
const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(); let errors = [];
const IGNORE = /api\/live\/headlines|tech-hub-relay|favicon|ytimg|wikimedia|samsung\.com|apple\.com|net::ERR_/;
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('ERR ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !IGNORE.test((m.params.entry.url ?? '') + m.params.entry.text)) errors.push('LOG ' + (m.params.entry.text + ' ' + (m.params.entry.url ?? '')).slice(0, 200));
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? ('EVAL-ERROR ' + (r.result?.exceptionDetails?.exception?.description ?? '')); };

// tests/ (Version 38): wait until the page is ready rather than a fixed time; `max` (the old fixed wait) is the cap
const settle = async (max = 3000) => {
  const t0 = Date.now(); let last = null, same = 0;
  await sleep(400);
  while (Date.now() - t0 < max) {
    const size = await ev(`(() => { const m = document.querySelector('main'); if (document.readyState !== 'complete' || !m || !m.textContent.trim()) return -1;
      if (m.querySelector('.skeleton, .state--loading, .live__item--loading, [aria-busy="true"]')) return -2;
      if (!m.querySelector('h1')) return -3; // every page has its main heading once drawn (also in Chinese)
      if ([...m.querySelectorAll('img')].some((i) => !i.complete && (i.loading !== 'lazy' || i.getBoundingClientRect().top < innerHeight))) return -4; // pictures on screen still loading (lazy ones below the fold load only when scrolled to)
      return m.innerHTML.length; })()`);
    if (size > 0 && size === last) { if (++same >= 2) return; } else same = 0;
    last = size; await sleep(150);
  }
};

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
const size = (w, h, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
await size(1366, 900);
const go = async (route, wait = 3200) => { await send('Page.navigate', { url: 'about:blank' }); await sleep(120); await send('Page.navigate', { url: base + route }); await settle(wait); };
const hashGo = async (route, wait = 2500) => { await ev(`location.hash = ${JSON.stringify(route)}; 1`); await settle(wait); };
let fails = 0; const failList = [];
const check = (persona, name, ok, detail = '') => { if (!ok) { fails++; failList.push(`${persona}: ${name} — ${detail}`); } console.log(`${ok ? 'PASS' : 'FAIL'}  [${persona}] ${name}${detail ? '  — ' + String(detail).slice(0, 300) : ''}`); };
const noErrors = (persona, where) => { const e = errors.filter(Boolean); check(persona, `no console errors on ${where}`, !e.length, e.slice(0, 3).join(' | ')); errors = []; };
const J = (v) => JSON.stringify(v);

await go('#/');
await ev(`localStorage.setItem('tch-lang','en'); localStorage.setItem('tch.mode.v1', JSON.stringify('detailed')); localStorage.setItem('tch.theme.v1', JSON.stringify('light')); 1`);
const data = await ev(`(async () => {
  const g = (p) => fetch('generated/' + p).then((r) => r.json());
  const [core, devices, chipsets, documents] = await Promise.all([g('core.json'), g('index/devices.json'), g('index/chipsets.json'), g('index/documents.json')]);
  let headlines = { items: [] }; try { headlines = await fetch('live/headlines.json').then((r) => r.json()); } catch {}
  return { core: { featured: core.featured, sources: core.sources.map((s) => s.id), brands: core.brands.map((b) => b.id) },
    devices: devices.map((d) => ({ id: d.id, name: d.name, chipset: d.chipset, chipsetName: d.chipsetName, brand: d.brand, docCount: d.docCount, category: d.category })),
    chipsets: chipsets.map((c) => ({ id: c.id, name: c.name })), documents: documents.map((d) => ({ id: d.id, devices: d.devices, source: d.source, testedBy: d.testedBy, title: d.title, kind: d.kind })),
    headlines: headlines.items.map((i) => ({ title: i.title, devices: i.devices ?? [], chipsets: i.chipsets ?? [] })) };
})()`);
const devIds = new Set(data.devices.map((d) => d.id)); const chipIds = new Set(data.chipsets.map((c) => c.id));
const srcIds = new Set(data.core.sources); const brandIds = new Set(data.core.brands);

// ---------------------------------------------------------------- 0. data links (every reference points at something real)
{
  const P = 'Data links';
  const badDocDev = data.documents.flatMap((d) => (d.devices ?? []).filter((x) => !devIds.has(x)).map((x) => `${d.id}→${x}`));
  check(P, 'every checked document names devices that exist', !badDocDev.length, badDocDev.slice(0, 5).join(', '));
  const badDocSrc = data.documents.filter((d) => !srcIds.has(d.testedBy ?? d.source)).map((d) => `${d.id}→${d.testedBy ?? d.source}`);
  check(P, 'every checked document has a source page', !badDocSrc.length, badDocSrc.slice(0, 5).join(', '));
  const badChip = data.devices.filter((d) => d.chipset && !chipIds.has(d.chipset)).map((d) => `${d.id}→${d.chipset}`);
  check(P, 'every device chipset exists', !badChip.length, badChip.slice(0, 8).join(', '));
  const nameMismatch = data.devices.filter((d) => d.chipset && chipIds.has(d.chipset) && d.chipsetName && data.chipsets.find((c) => c.id === d.chipset).name !== d.chipsetName).map((d) => `${d.name}: ${d.chipsetName} vs ${data.chipsets.find((c) => c.id === d.chipset).name}`);
  check(P, 'device chipset name matches the chipset page', !nameMismatch.length, nameMismatch.slice(0, 5).join('; '));
  const badBrand = data.devices.filter((d) => !brandIds.has(d.brand)).map((d) => `${d.id}→${d.brand}`);
  check(P, 'every device brand has a brand page', !badBrand.length, badBrand.slice(0, 5).join(', '));
  const badFeat = data.core.featured.flatMap((f) => f.devices.filter((x) => !devIds.has(x)));
  check(P, 'trending comparisons name real devices', !badFeat.length, badFeat.join(', '));
  const badHead = data.headlines.flatMap((h) => [...h.devices.filter((x) => !devIds.has(x)), ...h.chipsets.filter((x) => !chipIds.has(x))]);
  check(P, 'headline tags point at real devices and chips', !badHead.length, [...new Set(badHead)].slice(0, 5).join(', '));
  const dupNames = Object.entries(data.devices.reduce((m, d) => ((m[d.name + '|' + d.category] = (m[d.name + '|' + d.category] ?? 0) + 1), m), {})).filter(([, n]) => n > 1).map(([k]) => k);
  check(P, 'no two devices share one name (users could not tell them apart)', !dupNames.length, dupNames.slice(0, 8).join(', '));
}

// ---------------------------------------------------------------- 1. first-time Malaysian buyer, Simple view
{
  const P = 'Buyer';
  await go('#/');
  await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Simple')?.click(); 1`); await sleep(800);
  check(P, 'Simple view keeps the home page usable', await ev(`!!document.querySelector('[data-choose-form]') && !!document.querySelector('[data-qc-go]')`));
  await ev(`(() => { const f = document.querySelector('[data-choose-form]'); f.kind.value = 'smartphone'; f.kind.dispatchEvent(new Event('change')); f.budget.value = '2500'; f.profile.value = 'photography'; f.requestSubmit(); return 1; })()`); await sleep(3000);
  const url = await ev('location.hash');
  check(P, 'Help me choose opens the phone list ranked for photography under RM2,500', /devices\/smartphone/.test(url) && /rank=photography/.test(url) && /priceMax=2500/.test(url), url);
  const prices = await ev(`[...document.querySelectorAll('main .data-table tbody tr, main .dcard')].map((c) => Math.min(...[...c.innerText.matchAll(/RM\\s?([\\d,]+)/g)].map((x) => +x[1].replace(/,/g, '')))).filter((n) => Number.isFinite(n))`);
  check(P, 'list is not empty', prices.length > 0, `${prices.length} prices`);
  check(P, 'every price shown is within the budget', prices.every((p) => p <= 2500), prices.filter((p) => p > 2500).slice(0, 5).join(', '));
  const first = await ev(`document.querySelector('main .data-table a[href^="#/device/"], main .dcard a[href^="#/device/"]')?.getAttribute('href')`);
  check(P, 'first result links to its device page', /^#\/device\//.test(first ?? ''), first);
  if (first) {
    await hashGo(first, 3000);
    const dev = await ev(`({ h1: document.querySelector('h1')?.innerText, chip: document.querySelector('a[href^="#/chipset/"]')?.getAttribute('href') })`);
    check(P, 'device page has a heading', !!dev.h1, J(dev));
    if (dev.chip) {
      const devId = first.split('/').pop();
      await hashGo(dev.chip, 3000);
      check(P, 'chipset page lists the device that linked to it', await ev(`!![...document.querySelectorAll('a[href="#/device/${devId}"]')].length`), `${dev.chip} lacks ${devId}`);
    }
  }
  noErrors(P, 'buyer journey');
  await ev(`localStorage.setItem('tch.mode.v1', JSON.stringify('detailed')); 1`);
}

// ---------------------------------------------------------------- 2. enthusiast: search, compare, charts
{
  const P = 'Enthusiast';
  await go('#/');
  await ev(`(() => { const f = document.querySelector('[data-hero-search]'); f.querySelector('input').value = 'S26 Ultra vs iPhone 18 Pro Max'; f.requestSubmit(); return 1; })()`); await sleep(3500);
  const url = await ev('location.hash');
  check(P, 'typing "S26 Ultra vs iPhone 18 Pro Max" opens that comparison', /compare\/.*samsung-galaxy-s26-ultra/.test(url) && /apple-iphone-18-pro-max/.test(url), url);
  const cmp = await ev(`({ chips: [...document.querySelectorAll('.cmp-head a[href^="#/chipset/"]')].length, heads: document.querySelectorAll('.cmp-head .cmp-head__name').length, export: !![...document.querySelectorAll('button,a')].find((b) => /evidence pack|export/i.test(b.textContent)) })`);
  check(P, 'each phone in the comparison links its chipset', cmp.chips === cmp.heads && cmp.heads >= 2, J(cmp));
  check(P, 'evidence pack export is offered', cmp.export);
  for (const tabName of ['cpu', 'gpu', 'battery', 'charging', 'camera']) {
    await hashGo(`#/charts?tab=${tabName}`, 2500);
    const r = await ev(`({ rows: document.querySelectorAll('.rank__row').length, first: document.querySelector('.rank__name')?.getAttribute('href'), firstName: document.querySelector('.rank__name')?.childNodes[0]?.textContent?.trim(), chipLinks: document.querySelectorAll('.rank__chip').length })`);
    check(P, `Charts ${tabName}: has ranked rows with device links`, r.rows > 0 && /#\/device\//.test(r.first ?? ''), J(r));
    if (r.first) check(P, `Charts ${tabName}: top device exists`, devIds.has(r.first.split('/').pop()), r.first);
  }
  noErrors(P, 'enthusiast journey');
}

// ---------------------------------------------------------------- 3. news reader: tags lead to device pages that show the same story
{
  const P = 'News reader';
  await go('#/news', 5000);
  const n = await ev(`document.querySelectorAll('.live__item').length`);
  check(P, 'latest headlines are listed', n > 0, n);
  await ev(`(() => { const b = [...document.querySelectorAll('label')].find((l) => /Only devices in this hub/.test(l.textContent))?.querySelector('input'); b.click(); return 1; })()`); await sleep(800);
  const untagged = await ev(`[...document.querySelectorAll('.live__item')].filter((li) => !li.querySelector('.live__devices a[href^="#/device/"]')).length`);
  check(P, '"Only devices in this hub" leaves only tagged headlines', untagged === 0, `${untagged} untagged`);
  const pick = await ev(`(() => { const li = document.querySelector('.live__item .live__devices a[href^="#/device/"]')?.closest('.live__item'); return li ? { title: li.querySelector('.live__link')?.childNodes[0]?.textContent?.trim(), dev: li.querySelector('.live__devices a').getAttribute('href') } : null; })()`);
  if (pick) {
    await hashGo(pick.dev, 5000);
    // Version 38: open "Show more" first, as a reader would; older headlines sit behind it
    await ev(`(async () => { for (let k = 0; k < 10; k++) { const b = [...document.querySelectorAll('main button')].find((b) => /^Show \\d+ more|^Show more|^Show all/i.test(b.innerText.trim()) && b.offsetParent); if (!b) break; b.click(); await new Promise((r) => setTimeout(r, 300)); } return 1; })()`);
    const shown = await ev(`document.body.innerText.includes(${J(pick.title.slice(0, 40))})`);
    check(P, 'the tagged device page shows that headline too', shown, `${pick.dev} / ${pick.title}`);
  }
  for (const t of ['software', 'offers', 'chips']) {
    await hashGo(`#/news?tab=${t}`, 3500);
    const items = await ev(`document.querySelectorAll('.fresh__item, .desk__empty, [data-sw-cards] > *').length`);
    check(P, `News tab "${t}" shows content`, items > 0, items);
  }
  await hashGo('#/reviews', 4000);
  const rv = await ev(`({ docs: document.querySelectorAll('.doc').length, live: document.querySelectorAll('.live__item').length })`);
  check(P, 'Reviews & videos page lists items', rv.docs + rv.live > 0, J(rv));
  noErrors(P, 'news journey');
}

// ---------------------------------------------------------------- 4. researcher checking sources
{
  const P = 'Researcher';
  await go('#/methodology?section=sources', 3500);
  const srcLinks = await ev(`[...new Set([...document.querySelectorAll('a[href^="#/source/"]')].map((a) => a.getAttribute('href')))]`);
  check(P, 'source registry links every source page', srcLinks.length >= Math.min(30, srcIds.size), `${srcLinks.length} of ${srcIds.size}`);
  const sample = ['9to5mac', 'nanoreview', 'tomsguide', 'dxomark', 'samsung'].filter((s) => srcIds.has(s));
  for (const s of sample) {
    await hashGo(`#/source/${s}`, 2500);
    const r = await ev(`({ h1: document.querySelector('h1')?.innerText, ext: [...document.querySelectorAll('a[target=_blank]')].every((a) => /noopener/.test(a.rel)) })`);
    check(P, `source page ${s} opens, outside links are safe`, !!r.h1 && r.ext, J(r));
  }
  // documents per device: device page count matches the index
  for (const d of data.devices.filter((x) => x.docCount > 2).slice(0, 4)) {
    await hashGo(`#/device/${d.id}`, 3000);
    const linked = data.documents.filter((x) => (x.devices ?? []).includes(d.id) && x.kind !== 'benchmark').length;
    const page = await ev(`document.querySelectorAll('.doc, .timeline__item').length`);
    check(P, `${d.name}: its checked documents appear on its page`, page >= Math.min(linked, 1), `${page} on page, ${linked} in index`);
  }
  noErrors(P, 'research journey');
}

// ---------------------------------------------------------------- 5. link integrity on main pages
{
  const P = 'Links';
  const routes = ['#/', '#/news', '#/reviews', '#/charts', '#/coverage', '#/chipsets', '#/devices/smartphone', '#/device/samsung-galaxy-s26-ultra',
    '#/compare/samsung-galaxy-s26-ultra,apple-iphone-18-pro-max', '#/chipset/snapdragon-8-elite-gen-5', '#/brand/samsung', '#/methodology'];
  const bad = [];
  for (const r of routes) {
    await hashGo(r, 3500);
    const hrefs = await ev(`[...document.querySelectorAll('a[href^="#/"]')].map((a) => a.getAttribute('href'))`);
    for (const h of new Set(hrefs)) {
      const path = h.slice(1).split('?')[0];
      const [, kind, id] = path.split('/');
      if (kind === 'device' && !devIds.has(id)) bad.push(`${r}: ${h}`);
      if (kind === 'chipset' && !chipIds.has(id)) bad.push(`${r}: ${h}`);
      if (kind === 'source' && !srcIds.has(id)) bad.push(`${r}: ${h}`);
      if (kind === 'brand' && !brandIds.has(id)) bad.push(`${r}: ${h}`);
      if (kind === 'compare' && id) for (const x of id.split(',')) if (!devIds.has(x)) bad.push(`${r}: ${h}`);
    }
    const unsafe = await ev(`[...document.querySelectorAll('a[target=_blank]')].filter((a) => !/noopener/.test(a.rel)).map((a) => a.href).slice(0, 3)`);
    if (unsafe.length) bad.push(`${r}: target=_blank without noopener ${unsafe.join(' ')}`);
    const empty = await ev(`[...document.querySelectorAll('a')].filter((a) => !a.getAttribute('href') && !a.getAttribute('role')).length`);
    if (empty) bad.push(`${r}: ${empty} links without an address`);
  }
  check(P, 'every internal link on the main pages opens something that exists', !bad.length, bad.slice(0, 8).join(' | '));
  noErrors(P, 'link sweep');
}

// ---------------------------------------------------------------- 6. visitors who type odd things or follow old links
{
  const P = 'Edge cases';
  const cases = [['#/device/not-a-real-phone', /not found|couldn.t find|no device|isn.t in/i], ['#/chipset/not-a-chip', /not found|couldn.t find|no chipset|isn.t in/i],
    ['#/source/not-a-source', /not found|couldn.t find|unknown|isn.t in/i], ['#/brand/not-a-brand', /not found|couldn.t find|unknown|isn.t in/i],
    ['#/no-such-page', /not found|couldn.t find|doesn.t exist|page/i], ['#/search?q=zzqqxx', /no (results|matches)|nothing|couldn.t find/i]];
  for (const [route, re] of cases) {
    await go(route, 2500);
    const txt = await ev(`document.querySelector('main')?.innerText ?? document.body.innerText`);
    check(P, `${route} explains itself`, re.test(txt), txt.slice(0, 120).replace(/\n/g, ' '));
    const home = await ev(`!!document.querySelector('main a[href="#/"], main a[href^="#/devices"], main a[href^="#/search"], header a[href="#/"]')`);
    check(P, `${route} offers a way back`, home);
  }
  await go('#/compare/samsung-galaxy-s26-ultra', 3000);
  check(P, 'compare with one phone asks for another instead of breaking', await ev(`/add|choose|another|at least/i.test(document.querySelector('main').innerText)`));
  await go('#/compare/samsung-galaxy-s26-ultra,not-real,apple-iphone-18-pro-max', 3500);
  check(P, 'compare with a wrong id still shows the real phones', await ev(`document.querySelectorAll('.cmp-head').length`) >= 2);
  await go('#/'); await hashGo('#/charts', 2000); await hashGo('#/news', 2000);
  await ev('history.back(); 1'); await sleep(2000);
  check(P, 'browser Back returns to the previous page', /charts/.test(await ev('location.hash')), await ev('location.hash'));
  await go('#/');
  await ev(`(() => { const f = document.querySelector('[data-hero-search]'); f.querySelector('input').value = '   '; f.requestSubmit(); return 1; })()`); await sleep(1500);
  check(P, 'searching only spaces does not break the page', await ev(`!!document.querySelector('main')`));
  await ev(`[1, 2, 3].forEach((i) => (document.querySelector('[data-qc="' + i + '"]').value = '')); document.querySelector('[data-qc-go]').click(); 1`); await sleep(800);
  check(P, 'Quick compare with one phone keeps you on the page', /^#?\/?$|^$/.test((await ev('location.hash')).replace('#/', '')), await ev('location.hash'));
  noErrors(P, 'edge cases');
}

// ---------------------------------------------------------------- 7. Chinese reader
{
  const P = 'Chinese reader';
  await go('#/');
  await ev(`localStorage.setItem('tch-lang','zh'); 1`);
  await go('#/', 4000);
  const zh = await ev(`(() => { const t = document.body.innerText; return { checked: t.includes('已核对新闻'), dates: !/\\d{1,2} (Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d{4}/.test(t), fresh: t.includes('最新动态'), english: ['Checked news', 'Checked by hand', 'Fresh from the feeds', 'Trending comparisons', 'Quick compare'].filter((s) => t.includes(s)) }; })()`);
  check(P, 'home page labels are in Chinese', zh.checked && zh.fresh && !zh.english.length, J(zh));
  check(P, 'home page dates are written the Chinese way', zh.dates, J(zh));
  await go('#/news', 4500);
  const zn = await ev(`(() => { const t = document.body.innerText; return ['Latest headlines', 'Only devices in this hub', 'Refresh', 'Software updates'].filter((s) => t.includes(s)); })()`);
  check(P, 'news page labels are in Chinese', !zn.length, J(zn));
  await ev(`localStorage.setItem('tch-lang','en'); 1`);
  noErrors(P, 'Chinese pages');
}

// ---------------------------------------------------------------- 8. phone visitor
{
  const P = 'Phone';
  await size(390, 844, true);
  const wide = [];
  for (const r of ['#/', '#/news', '#/reviews', '#/charts', '#/device/samsung-galaxy-s26-ultra', '#/compare/samsung-galaxy-s26-ultra,apple-iphone-18-pro-max', '#/chipset/snapdragon-8-elite-gen-5', '#/devices/smartphone', '#/coverage', '#/methodology']) {
    await go(r, 3500);
    const w = await ev(`({ sw: document.documentElement.scrollWidth, iw: innerWidth, offenders: [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.scroll-x, [class*=scroll], table, .seg, .tabs, .chart-panel, .rank')).slice(0, 3).map((e) => e.tagName + '.' + String(e.className).slice(0, 30)) })`);
    if (w.sw > w.iw + 1) wide.push(`${r} ${w.sw}px ${w.offenders.join(',')}`);
  }
  check(P, 'no page scrolls sideways on a phone', !wide.length, wide.join(' | '));
  await go('#/', 3000);
  const menu = await ev(`(() => { const b = document.querySelector('[data-action="menu"]'); if (!b || !b.offsetParent) return 'no visible menu button'; b.click(); return [...document.querySelectorAll('#mobile-nav a')].filter((a) => a.getBoundingClientRect().height > 0).length; })()`);
  check(P, 'menu opens with links', typeof menu === 'number' && menu > 3, menu);
  const tap = await ev(`[...document.querySelectorAll('main a, main button')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 20 && r.width < 20; }).length`);
  check(P, 'no very small tap targets on the home page', tap === 0, `${tap} under 20px`);
  noErrors(P, 'phone pages');
  await size(1366, 900);
}

console.log(`\n${fails} failed check(s)`);
if (failList.length) console.log(failList.join('\n'));
await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);
process.exit(0);
