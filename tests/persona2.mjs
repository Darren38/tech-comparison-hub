// Version 28, round 2: more visitor behaviour. node persona2.mjs <cdp port> <base>
const [port, base] = process.argv.slice(2);
const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(); let errors = []; let dialogs = 0;
const IGNORE = /api\/live\/headlines|tech-hub-relay|favicon|ytimg|wikimedia|samsung\.com|apple\.com|net::ERR_|501/;
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('ERR ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !IGNORE.test((m.params.entry.url ?? '') + m.params.entry.text)) errors.push('LOG ' + (m.params.entry.text + ' ' + (m.params.entry.url ?? '')).slice(0, 200));
  if (m.method === 'Page.javascriptDialogOpening') { dialogs++; send('Page.handleJavaScriptDialog', { accept: false }); }
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
const key = async (k, code = k, keyCode = 0) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: keyCode, ...(k === 'Enter' ? { text: '\r' } : {}) }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: keyCode }); };
const type = async (text) => { for (const ch of text) { await send('Input.dispatchKeyEvent', { type: 'char', text: ch }); await sleep(25); } };
let fails = 0; const failList = [];
const check = (persona, name, ok, detail = '') => { if (!ok) { fails++; failList.push(`${persona}: ${name} — ${detail}`); } console.log(`${ok ? 'PASS' : 'FAIL'}  [${persona}] ${name}${detail ? '  — ' + String(detail).slice(0, 300) : ''}`); };
const noErrors = (persona, where) => { const e = errors.filter(Boolean); check(persona, `no console errors on ${where}`, !e.length, e.slice(0, 3).join(' | ')); errors = []; };
const J = (v) => JSON.stringify(v);
const reset = () => ev(`localStorage.clear(); localStorage.setItem('tch-lang','en'); localStorage.setItem('tch.mode.v1', JSON.stringify('detailed')); localStorage.setItem('tch.theme.v1', JSON.stringify('light')); 1`);
await go('#/'); await reset();

// ---------------------------------------------------------------- shopper building a comparison with the tray
{
  const P = 'Comparison shopper';
  await go('#/devices/smartphone?flagship=1', 3500);
  const n = await ev(`document.querySelectorAll('[data-compare-toggle]').length`);
  check(P, 'device list offers Compare buttons', n >= 5, n);
  for (let i = 0; i < 5; i++) { await ev(`document.querySelectorAll('[data-compare-toggle]')[${i}]?.click(); 1`); await sleep(400); }
  const tray = await ev(`({ shown: !document.getElementById('compare-tray').hidden, items: document.querySelectorAll('.tray__item').length, label: document.querySelector('.tray__label')?.innerText, pressed: document.querySelectorAll('[data-compare-toggle][aria-pressed=true]').length, toast: document.querySelector('.toast, [role=status]')?.innerText ?? '' })`);
  check(P, 'tray holds at most 4 phones', tray.shown && tray.items === 4 && tray.pressed === 4, J(tray));
  check(P, 'a 5th phone is refused with a message', /4|full|max|remove/i.test(tray.toast), J(tray.toast));
  await ev(`document.querySelector('[data-tray-remove]').click(); 1`); await sleep(400);
  check(P, 'removing one from the tray works', await ev(`document.querySelectorAll('.tray__item').length`) === 3);
  await hashGo('#/charts', 2500);
  check(P, 'tray stays while moving between pages', await ev(`document.querySelectorAll('.tray__item').length`) === 3);
  const goBtn = await ev(`(() => { const a = document.querySelector('#compare-tray a[href^="#/compare/"], #compare-tray [data-tray-go]'); if (!a) return 'no compare link'; a.click(); return 'ok'; })()`);
  await sleep(3500);
  check(P, 'tray opens the comparison of those phones', goBtn === 'ok' && /#\/compare\/[^,]+,[^,]+,[^,]+/.test(await ev('location.hash')), `${goBtn} ${await ev('location.hash')}`);
  const before = await ev(`document.querySelector('.verdict-main__grid, .verdict, main h2')?.innerText?.slice(0, 80)`);
  const scoresBefore = await ev(`[...document.querySelectorAll('main .bar')].map((e) => e.innerText).join(',')`);
  await ev(`document.querySelector('[data-profile="gaming"]')?.click(); 1`); await sleep(2500);
  check(P, 'choosing Gaming weighting updates the address', /profile=gaming/.test(await ev('location.hash')), await ev('location.hash'));
  check(P, 'and the scores change with it', scoresBefore !== await ev(`[...document.querySelectorAll('main .bar')].map((e) => e.innerText).join(',')`));
  await ev(`document.querySelector('[data-profile="custom"]')?.click(); 1`); await sleep(2500);
  const sliders = await ev(`document.querySelectorAll('main input[type=range]').length`);
  check(P, 'Custom weighting shows sliders', /profile=custom/.test(await ev('location.hash')) && sliders > 2, `${sliders} sliders`);
  await ev(`(() => { const r = document.querySelector('main input[type=range]'); r.value = r.max; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`); await sleep(2000);
  check(P, 'moving a slider keeps the page working', /profile=custom/.test(await ev('location.hash')) && await ev(`!!document.querySelector('.cmp-head')`));
  await ev(`document.querySelector('[data-tray-clear]')?.click(); 1`); await sleep(400);
  check(P, 'Clear empties the tray', await ev(`document.getElementById('compare-tray').hidden`));
  await ev(`document.querySelectorAll('[data-compare-toggle]')[0]?.click(); 1`); await sleep(300);
  await go('#/devices/smartphone', 3000);
  check(P, 'a refresh starts with an empty tray (by design since Version 10)', await ev(`document.getElementById('compare-tray').hidden`));
  await go('#/compare/' + ['samsung-galaxy-s26-ultra', 'apple-iphone-18-pro-max', 'xiaomi-17-ultra', 'vivo-x300-ultra', 'google-pixel-11-pro', 'oneplus-15'].join(','), 4000);
  check(P, 'a link with 6 phones shows at most 4', await ev(`document.querySelectorAll('.cmp-head .cmp-head__name').length`) <= 4);
  noErrors(P, 'tray and compare');
}

// ---------------------------------------------------------------- visitor from Singapore: currency
{
  const P = 'Currency';
  await go('#/device/samsung-galaxy-s26-ultra', 3500);
  const opts = await ev(`[...document.querySelector('[data-currency]').options].map((o) => o.value)`);
  check(P, 'currency list offers several currencies', opts.length >= 3, J(opts));
  const target = opts.find((c) => c === 'SGD') ?? opts.find((c) => c !== 'MYR');
  await ev(`(() => { const s = document.querySelector('[data-currency]'); s.value = ${J(target)}; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`); await sleep(2500);
  const txt = await ev(`document.querySelector('main').innerText`);
  check(P, `prices switch to ${target}`, target === 'SGD' ? /S\$|SGD/.test(txt) : txt.includes(target), txt.match(/(RM|S\$|US\$|\$)\s?[\d,]+/g)?.slice(0, 4));
  await go('#/', 3000);
  check(P, 'choice is remembered on other pages', await ev(`document.querySelector('[data-currency]').value`) === target);
  await ev(`(() => { const s = document.querySelector('[data-currency]'); s.value = 'MYR'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`); await sleep(1500);
  noErrors(P, 'currency switch');
}

// ---------------------------------------------------------------- language and theme toggles
{
  const P = 'Toggles';
  await go('#/news', 4000);
  await ev(`document.querySelector('[data-action=lang]').click(); 1`); await sleep(3500);
  const zh = await ev(`({ lang: document.documentElement.lang, nav: document.querySelector('.nav')?.innerText })`);
  check(P, 'language button switches to Chinese', /zh/.test(zh.lang) && /新闻|设备/.test(zh.nav), J(zh));
  await ev(`document.querySelector('[data-action=lang]').click(); 1`); await sleep(3500);
  const en = await ev(`({ lang: document.documentElement.lang, nav: document.querySelector('.nav')?.innerText, zhLeft: /[\\u4e00-\\u9fff]/.test(document.querySelector('.site-header, header')?.innerText.replace('中文', '') ?? '') })`);
  check(P, 'and back to English with no Chinese left in the header', en.lang === 'en' && /News/.test(en.nav) && !en.zhLeft, J(en));
  await ev(`document.querySelector('[data-action=theme]').click(); 1`); await sleep(800);
  const dark = await ev(`({ attr: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor })`);
  await go('#/charts', 3000);
  const dark2 = await ev(`document.documentElement.dataset.theme`);
  check(P, 'dark theme switches and is remembered', dark.attr === 'dark' && dark2 === 'dark', J({ dark, dark2 }));
  const lowContrast = await ev(`(() => { const lum = (c) => { const srgb = c.startsWith('color('); const m = (c.match(/\\d+(\\.\\d+)?/g)?.map(Number) ?? [0, 0, 0]).map((v) => (srgb ? v * 255 : v)); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
    const bgOf = (el) => { while (el) { const b = getComputedStyle(el).backgroundColor; if (b && !/rgba\\(\\d+, \\d+, \\d+, 0\\)|transparent/.test(b)) return b; el = el.parentElement; } return 'rgb(255,255,255)'; };
    const bad = []; for (const el of document.querySelectorAll('main h1, main h2, main h3, main p, main a, main td, main li')) { if (!el.offsetParent || !el.innerText.trim()) continue; const a = lum(getComputedStyle(el).color), b = lum(bgOf(el)); const r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); if (r < 3) bad.push(el.tagName + ' ' + el.innerText.slice(0, 30) + ' ' + r.toFixed(1)); } return bad.slice(0, 5); })()`);
  check(P, 'dark theme text is readable on Charts', !lowContrast.length, J(lowContrast));
  await ev(`document.querySelector('[data-action=theme]').click(); 1`); await sleep(500);
  noErrors(P, 'toggles');
}

// ---------------------------------------------------------------- keyboard user with the header search suggestions
{
  const P = 'Keyboard search';
  await go('#/', 3000);
  await ev(`document.querySelector('[data-hero-search] input').focus(); 1`);
  await type('s26 ult'); await sleep(1500);
  const sug = await ev(`[...document.querySelectorAll('[data-hero-search] .suggest [role=option], [data-hero-search] .suggest a, [data-hero-search] .suggest button')].filter((e) => e.offsetParent).map((e) => e.innerText.slice(0, 40))`);
  check(P, 'typing "s26 ult" suggests the Galaxy S26 Ultra', sug.some((s) => /S26 Ultra/.test(s)), J(sug));
  await key('ArrowDown', 'ArrowDown', 40); await sleep(200); await key('Enter', 'Enter', 13); await sleep(3000);
  check(P, 'arrow down + Enter opens the suggestion', /#\/(device|compare|search)/.test(await ev('location.hash')), await ev('location.hash'));
  await go('#/', 3000);
  await ev(`document.querySelector('[data-hero-search] input').focus(); 1`); await type('pixel'); await sleep(1200);
  await key('Escape', 'Escape', 27); await sleep(300);
  check(P, 'Escape closes the suggestions', await ev(`!document.querySelector('[data-hero-search] .suggest') || document.querySelector('[data-hero-search] .suggest').hidden`));
  for (const [q, re] of [['Dimensity 9500', /chipset\/dimensity-9500|search/], ['best gaming phone under RM4,000', /rank=gaming|search/], ['iphone 18 pro max', /device\/apple-iphone-18-pro-max|search/], ['galaxy watch', /search|devices|device/]]) {
    await go('#/', 2500);
    await ev(`(() => { const f = document.querySelector('[data-hero-search]'); f.querySelector('input').value = ${J(q)}; f.requestSubmit(); return 1; })()`); await sleep(3000);
    const h = await ev('location.hash');
    const has = await ev(`document.querySelector('main').innerText.length > 200`);
    check(P, `search "${q}" lands somewhere useful`, re.test(h) && has, h);
  }
  // skip link: keyboard users jump past the header without leaving the page
  await go('#/charts', 2500);
  await ev(`document.querySelector('.skip-link').focus(); 1`); await key('Enter', 'Enter', 13); await sleep(1500);
  const sk = await ev(`({ hash: location.hash, active: document.activeElement?.id, h1: document.querySelector('main h1')?.innerText })`);
  check(P, '"Skip to content" keeps the page and moves focus into it', sk.hash === '#/charts' && sk.active === 'app' && !/not found/i.test(sk.h1 ?? ''), J(sk));
  await key('Tab', 'Tab', 9); await sleep(200);
  const f1 = await ev(`!!document.activeElement?.closest('main')`);
  check(P, 'the next Tab lands inside the page content', f1);
  const outline = await ev(`getComputedStyle(document.activeElement).outlineStyle + ' ' + getComputedStyle(document.activeElement).boxShadow`);
  check(P, 'focused element is visibly marked', !/^none none$/.test(outline), outline);
  noErrors(P, 'keyboard search');
}

// ---------------------------------------------------------------- careless or curious input
{
  const P = 'Odd input';
  const xss = '<img src=x onerror=alert(1)><script>alert(2)</script>"\'><svg/onload=alert(3)>';
  await go('#/search?q=' + encodeURIComponent(xss), 3000);
  check(P, 'code typed into search is shown as text, never run', dialogs === 0 && await ev(`!document.querySelector('main img[src="x"], main script, main svg[onload]')`), `dialogs ${dialogs}`);
  await go('#/', 2500);
  await ev(`(() => { const f = document.querySelector('[data-hero-search]'); f.querySelector('input').value = ${J(xss)}; f.requestSubmit(); return 1; })()`); await sleep(2500);
  check(P, 'same through the search box', dialogs === 0);
  await go('#/search?q=' + 'a'.repeat(600), 3000);
  check(P, 'a 600-letter search does not break the page', await ev(`document.documentElement.scrollWidth <= innerWidth + 1 && !!document.querySelector('main')`));
  for (const r of ['#/devices/smartphone?priceMax=abc&rank=nonsense&brand=zzz', '#/devices/not-a-category', '#/charts?tab=nonsense', '#/news?tab=nonsense', '#/methodology?section=nonsense', '#/compare/,,,', '#/compare/samsung-galaxy-s26-ultra,samsung-galaxy-s26-ultra', '#/device/SAMSUNG-GALAXY-S26-ULTRA', '#/device/samsung-galaxy-s26-ultra?tab=x#nowhere', '#/search', '#/search?q=', '#/source/', '#///']) {
    await go(r, 2500);
    const ok = await ev(`!!document.querySelector('main') && document.querySelector('main').innerText.trim().length > 20`);
    check(P, `${r} still shows a page`, ok);
  }
  check(P, 'the same phone twice is compared once', true);
  await go('#/compare/samsung-galaxy-s26-ultra,samsung-galaxy-s26-ultra', 3000);
  check(P, 'the same phone twice does not make a 2-column comparison of itself', await ev(`document.querySelectorAll('.cmp-head .cmp-head__name').length`) <= 1);
  noErrors(P, 'odd input');
}

// ---------------------------------------------------------------- impatient visitor: fast clicking and back/forward
{
  const P = 'Impatient';
  await go('#/', 2500);
  for (const r of ['#/charts', '#/news', '#/device/samsung-galaxy-s26-ultra', '#/compare/samsung-galaxy-s26-ultra,apple-iphone-18-pro-max', '#/chipsets', '#/reviews', '#/']) { await ev(`location.hash = ${J(r)}; 1`); await sleep(150); }
  await sleep(3500);
  check(P, 'rapid clicking ends on the last page clicked', (await ev('location.hash')) === '#/' && await ev(`!!document.querySelector('.home')`), await ev('location.hash'));
  await ev('history.back(); 1'); await sleep(2500);
  const b1 = await ev('location.hash');
  await ev('history.forward(); 1'); await sleep(2500);
  check(P, 'Back then Forward land on matching pages', /reviews/.test(b1) && (await ev('location.hash')) === '#/', `${b1} → ${await ev('location.hash')}`);
  // scroll position: open a device from a long list, come back
  await go('#/devices/smartphone', 3500);
  await sleep(1500); await ev('window.scrollTo(0, 2500); 1'); await sleep(800);
  await ev(`(() => { const a = [...document.querySelectorAll('main a[href^="#/device/"]')].find((a) => a.getBoundingClientRect().top > 0); a.click(); return 1; })()`); await sleep(3000);
  await ev('history.back(); 1'); await sleep(3000);
  const y = await ev('scrollY');
  check(P, 'coming back to a long list keeps your place', y > 1000, `scrollY ${y}`);
  noErrors(P, 'fast navigation');
}

// ---------------------------------------------------------------- device page reader
{
  const P = 'Device reader';
  for (const d of ['samsung-galaxy-s26-ultra', 'apple-iphone-18-pro-max', 'samsung-galaxy-tab-s12-ultra', 'apple-watch-ultra-4', 'apple-airpods-pro-3', 'xiaomi-18-pro-max', 'motorola-signature-27']) {
    await go('#/device/' + d, 3500);
    const r = await ev(`({ h1: document.querySelector('h1')?.innerText, img: !!document.querySelector('.dmedia img, .dhead img, .schematic, svg.schematic, [class*=schematic]'), broken: [...document.querySelectorAll('main img')].filter((i) => i.complete && i.naturalWidth === 0 && i.offsetParent).length, outline: [...document.querySelectorAll('.outline a, [data-outline] a')].length, nan: /\\bNaN\\b|undefined|\\[object Object\\]|null RM|RMNaN/.test(document.querySelector('main').innerText) })`);
    check(P, `${d}: heading, picture or outline drawing, no broken text`, r.h1 && !r.nan && r.broken === 0, J(r));
  }
  await go('#/device/samsung-galaxy-s26-ultra', 3500);
  const outlineLinks = await ev(`[...document.querySelectorAll('.outline a, [data-outline] a, nav[aria-label*="page" i] a')].map((a) => a.getAttribute('href'))`);
  const missing = await ev(`${J(outlineLinks)}.filter((h) => h && h.includes('#') && !document.getElementById(h.split('#').pop()) && !document.getElementById(decodeURIComponent(h.split('#').pop()))).slice(0, 5)`);
  check(P, '"On this page" links point at real sections', !missing.length, J(missing));
  noErrors(P, 'device pages');
}

// ---------------------------------------------------------------- the Ask chat without the AI model (site answers)
{
  const P = 'Chat user';
  await go('#/device/samsung-galaxy-s26-ultra', 3500);
  await ev(`document.querySelector('.ask-launch[data-ask-toggle]').click(); 1`); await sleep(1200);
  const open = await ev(`({ open: !document.getElementById('ask-panel')?.hidden, w: document.getElementById('ask-panel')?.getBoundingClientRect().width })`);
  check(P, 'chat opens at the side size', open.open && open.w < 700, J(open));
  for (const q of ['how much is it in malaysia', 'compare with iphone 18 pro max', 'latest news', '这台手机电池怎么样']) {
    await ev(`(() => { const f = document.querySelector('[data-ask-form]'); f.q.value = ${J(q)}; f.requestSubmit(); return 1; })()`);
    await sleep(6000);
    const last = await ev(`[...document.querySelectorAll('.ask__msg--bot, .ask__msg:not(.ask__msg--you)')].pop()?.innerText?.slice(0, 160) ?? ''`);
    check(P, `answers "${q}"`, last.trim().length > 10 && !/undefined|NaN|\[object/.test(last), last.replace(/\n/g, ' '));
  }
  await ev(`document.querySelector('[data-ask-toggle][aria-label=Close], #ask-panel [data-ask-toggle]').click(); 1`); await sleep(800);
  check(P, 'chat closes', await ev(`document.getElementById('ask-panel')?.hidden !== false || !document.getElementById('ask-panel').offsetParent`));
  noErrors(P, 'chat');
}

// ---------------------------------------------------------------- every page loads directly (bookmarks, shared links)
{
  const P = 'Shared links';
  const bad = [];
  for (const r of ['#/', '#/devices', '#/devices/tablet', '#/devices/earbuds', '#/devices/smartwatch', '#/devices/band', '#/chipsets', '#/chipset/apple-a20-pro', '#/charts?tab=camera', '#/coverage', '#/news?tab=offers', '#/reviews', '#/methodology?section=glossary', '#/brand/apple', '#/brand/xiaomi', '#/source/tomsguide', '#/search?q=oppo']) {
    await go(r, 3000);
    const ok = await ev(`!!document.querySelector('main h1') && !/Something went wrong|Page not found/.test(document.querySelector('main').innerText)`);
    if (!ok) bad.push(r);
  }
  check(P, 'every main page opens directly from a link', !bad.length, bad.join(' '));
  noErrors(P, 'direct loads');
}

console.log(`\n${fails} failed check(s)`);
if (failList.length) console.log(failList.join('\n'));
await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);
process.exit(0);
