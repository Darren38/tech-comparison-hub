// Version 28, round 3: bad connections, very small phones, Simple view and Chinese across the key pages.
// node persona3.mjs <cdp port> <base>
const [port, base] = process.argv.slice(2);
const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(); let errors = [];
const IGNORE = /api\/live\/headlines|tech-hub-relay|favicon|ytimg|wikimedia|samsung\.com|apple\.com|net::ERR_|501|ERR_BLOCKED/;
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
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

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
const size = (w, h, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
await size(1366, 900);
const go = async (route, wait = 3200) => { await send('Page.navigate', { url: 'about:blank' }); await sleep(120); await send('Page.navigate', { url: base + route }); await settle(wait); };
let fails = 0; const failList = [];
const check = (persona, name, ok, detail = '') => { if (!ok) { fails++; failList.push(`${persona}: ${name} — ${detail}`); } console.log(`${ok ? 'PASS' : 'FAIL'}  [${persona}] ${name}${detail ? '  — ' + String(detail).slice(0, 300) : ''}`); };
const noErrors = (persona, where) => { const e = errors.filter(Boolean); check(persona, `no script errors on ${where}`, !e.length, e.slice(0, 3).join(' | ')); errors = []; };
const J = (v) => JSON.stringify(v);
await go('#/');
await ev(`localStorage.clear(); localStorage.setItem('tch-lang','en'); localStorage.setItem('tch.mode.v1', JSON.stringify('detailed')); 1`);
// the service worker would answer from its cache; keep it out of the network tests
await ev(`navigator.serviceWorker?.getRegistrations?.().then((rs) => Promise.all(rs.map((r) => r.unregister()))).then(() => 1)`);

// ---------------------------------------------------------------- bad connection: parts of the data don't arrive
{
  const P = 'Bad connection';
  const block = async (patterns) => send('Network.setBlockedURLs', { urls: patterns });
  await block(['*live/headlines.json*', '*api/live/*', '*tech-hub-relay*']);
  await go('#/', 4000);
  check(P, 'headlines unavailable: home page still works, the fresh list is hidden', await ev(`!!document.querySelector('.home .hero') && document.querySelector('[data-fresh]')?.hidden === true`));
  await go('#/news', 5000);
  const news = await ev(`document.querySelector('[data-live-list]')?.innerText ?? ''`);
  check(P, 'headlines unavailable: News explains it instead of spinning forever', /not available|unavailable|couldn.t|try again/i.test(news) || /not available|unavailable|couldn.t/i.test(await ev(`document.querySelector('[data-live-status]')?.innerText ?? ''`)), news.slice(0, 120));
  await go('#/device/samsung-galaxy-s26-ultra', 4000);
  check(P, 'headlines unavailable: device page still shows its specs', await ev(`document.querySelector('main').innerText.length > 2000`));
  noErrors(P, 'pages without headlines');
  await block(['*generated/core.json*']);
  await go('#/', 4000);
  const core = await ev(`({ txt: document.querySelector('main')?.innerText.slice(0, 200) ?? '', retry: !!document.querySelector('[data-action=reload]') })`);
  check(P, 'site data unavailable: a clear message with "Try again"', core.retry && core.txt.length > 10, J(core));
  errors = [];
  await block(['*index/search.json*']);
  await go('#/search?q=galaxy', 4000);
  const srch = await ev(`document.querySelector('main')?.innerText.slice(0, 200) ?? ''`);
  check(P, 'search index unavailable: the search page says so', srch.length > 20, srch.replace(/\n/g, ' '));
  errors = [];
  await block([]);
  await go('#/', 3500);
  check(P, 'back online: everything loads again', await ev(`!!document.querySelector('.home .hero')`));
  noErrors(P, 'recovery');
}

// ---------------------------------------------------------------- smallest phones and Simple view, Chinese
const KEY = ['#/', '#/news', '#/reviews', '#/charts', '#/device/samsung-galaxy-s26-ultra', '#/compare/samsung-galaxy-s26-ultra,apple-iphone-18-pro-max', '#/chipset/snapdragon-8-elite-gen-5', '#/devices/smartphone', '#/coverage', '#/methodology', '#/search?q=oppo', '#/brand/samsung', '#/source/tomsguide'];
for (const [P, w, lang, mode] of [['Small phone 320px', 320, 'en', 'detailed'], ['Simple view phone', 390, 'en', 'simple'], ['Chinese phone', 390, 'zh', 'detailed'], ['Chinese desktop', 1366, 'zh', 'detailed'], ['Tablet 768px', 768, 'en', 'detailed']]) {
  await size(w, w < 600 ? 780 : 1000, w < 600);
  await go('#/', 1500);
  await ev(`localStorage.setItem('tch-lang', '${lang}'); localStorage.setItem('tch.mode.v1', JSON.stringify('${mode}')); 1`);
  const wide = [];
  for (const r of KEY) {
    await go(r, 3000);
    const v = await ev(`({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h1: !!document.querySelector('main h1'), out: [...document.querySelectorAll('main *')].filter((e) => { const b = e.getBoundingClientRect(); if (!b.width || b.right <= document.documentElement.clientWidth + 1) return false; let p = e.parentElement; while (p && p !== document.body) { if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowX)) return false; p = p.parentElement; } return true; }).slice(0, 3).map((e) => e.tagName + '.' + String(e.className).slice(0, 30)) })`);
    if (v.sw > v.cw + 1 || v.out.length || !v.h1) wide.push(`${r} sw=${v.sw} ${v.out.join(',')}${v.h1 ? '' : ' no heading'}`);
  }
  check(P, 'key pages fit the screen and show their heading', !wide.length, wide.join(' | '));
  noErrors(P, 'key pages');
}

console.log(`\n${fails} failed check(s)`);
if (failList.length) console.log(failList.join('\n'));
await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);
process.exit(0);
