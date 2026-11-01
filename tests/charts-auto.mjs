const [port, base] = process.argv.slice(2);
const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;

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

let fails = 0; const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const go = async (r) => { await send('Page.navigate', { url: 'about:blank' }); await sleep(150); await send('Page.navigate', { url: base + r }); await settle(3500); };
await go('#/news?tab=offers');
check('Offers: Samsung service pages listed', await ev(`document.querySelectorAll('[data-offers-samsung] li').length`) === 2);
check('Offers: auto labels shown', await ev(`document.querySelectorAll('.autobadge').length`) >= 3);
await go('#/brand/apple');
check('Apple brand page: no Samsung pages section', await ev(`!document.querySelector('[data-offers-samsung] li')`));
await go('#/brand/samsung');
check('Samsung brand page: Samsung pages, no Apple programmes', await ev(`document.querySelectorAll('[data-offers-samsung] li').length === 2 && !document.querySelector('.desk__programs li a[href*="apple"]')`));
await go('#/charts?tab=cpu');
check('Charts CPU: daily label (Trusted Reviews daily, NanoReview weekly)', /daily/.test(await ev(`document.querySelector('.chart-panel__auto')?.innerText ?? ''`)));
check('Charts CPU: NanoReview results present', /NanoReview/.test(await ev(`document.querySelector('.chart-panel')?.innerText ?? ''`)));
await go('#/charts?tab=battery');
check('Charts Battery: Tom’s Guide test now has its Auto label (Version 33)', /Tom’s Guide/.test(await ev(`document.querySelector('.chart-panel__auto')?.innerText + ' ' + (document.querySelector('.chart-panel__auto .autobadge')?.title ?? '')`)));
await go('#/reviews');
check('Reviews: automatic documents not listed as checked by hand', !(await ev(`[...document.querySelectorAll('.doc-card, article')].some(a => /matched automatically/.test(a.innerText))`)));
await go('#/device/google-pixel-9');
check('Device (Pixel 9): automatic DXOMARK result shown', /DXOMARK/.test(await ev(`document.querySelector('#app')?.innerText ?? ''`)));
await go('#/news');
check('News: live panel has auto label', await ev(`!!document.querySelector('.live .autobadge')`));
await ev(`localStorage.setItem('tch-lang','zh'); location.reload(); 1`); await settle(3500);
check('Chinese: auto label translated', /自动/.test(await ev(`document.querySelector('.autobadge')?.innerText ?? ''`)));
await ev(`localStorage.setItem('tch-lang','en'); 1`);
console.log(`\n${fails} failed check(s)`); process.exit(0);
