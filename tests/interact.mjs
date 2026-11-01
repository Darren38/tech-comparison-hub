// Click through the site like a visitor and check each result. node interact.mjs <port> <base>
const [port, base] = process.argv.slice(2);
const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page' && !t.url.startsWith('chrome-extension')).webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(); let errors = [];
const IGNORE = /api\/live\/headlines|tech-hub-relay|favicon/; // local-only endpoint and pre-push relay allow-list (see QA notes)
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('ERR ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !IGNORE.test((m.params.entry.url ?? '') + m.params.entry.text)) errors.push('LOG ' + (m.params.entry.text + ' ' + (m.params.entry.url ?? '')).slice(0, 200));
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };

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
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
const go = async (route, wait = 3000) => { await send('Page.navigate', { url: 'about:blank' }); await sleep(150); await send('Page.navigate', { url: base + route }); await settle(wait); };
let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const click = (sel, i = 0) => ev(`(() => { const el = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!el) return 'missing'; el.click(); return 'ok'; })()`);

await go('#/'); await ev(`localStorage.setItem('tch-lang','en'); localStorage.setItem('tch.mode.v1', JSON.stringify('detailed')); localStorage.setItem('tch.theme.v1', JSON.stringify('light')); 1`);

// ---- software updates tab
errors = [];
await go('#/news?tab=software', 4000);
check('Software: iOS card shows a version', /iOS \d+/.test(await ev(`document.querySelector('[data-sw-cards]')?.innerText ?? ''`)));
check('Software: One UI card shows a version and a Malaysia line', /One UI \d+[\s\S]*(Malaysia)/.test(await ev(`document.querySelector('[data-sw-cards]')?.innerText ?? ''`)));
const allN = await ev(`document.querySelectorAll('[data-sw-list] .fresh__item').length`);
check('Software: news list has items', allN > 0, `${allN} shown`);
await ev(`[...document.querySelectorAll('[data-desk-filter]')].find(b => b.dataset.deskFilter === 'oneui').click()`); await sleep(300);
const oneui = await ev(`[...document.querySelectorAll('[data-sw-list] .fresh__link')].map(a => a.textContent)`);
check('Software: One UI filter only shows One UI / Galaxy items', oneui.length > 0 && oneui.every((t) => /one ?ui|galaxy|samsung|三星/i.test(t)), `${oneui.length} items`);
await ev(`[...document.querySelectorAll('[data-desk-filter]')].find(b => b.dataset.deskFilter === 'ios').click()`); await sleep(300);
const ios = await ev(`[...document.querySelectorAll('[data-sw-list] .fresh__link')].map(a => a.textContent)`);
check('Software: iOS filter only shows Apple items', ios.length > 0 && ios.every((t) => /ios|ipados|watchos|apple|iphone|苹果/i.test(t)), `${ios.length} items`);
await click('[data-sw-problems]'); await sleep(300);
check('Software: "Only reported problems" shows problems or the empty message', await ev(`!!document.querySelector('[data-sw-list] .desk__empty') || [...document.querySelectorAll('[data-sw-list] .auto__topic--issue')].length > 0`));
const more = await ev(`(() => { document.querySelector('[data-sw-problems]').click(); document.querySelector('[data-desk-filter="all"]').click(); const b = document.querySelector('[data-desk-more]'); if (!b) return 'none'; const n = document.querySelectorAll('[data-sw-list] .fresh__item').length; b.click(); return n + '->' + document.querySelectorAll('[data-sw-list] .fresh__item').length; })()`);
check('Software: Show more adds items', more === 'none' || /^(\d+)->(\d+)$/.test(more) && Number(more.split('->')[1]) > Number(more.split('->')[0]), more);
check('Software: no errors', !errors.length, errors.join(' | '));

// ---- offers tab
errors = [];
await go('#/news?tab=offers', 4000);
const progs = await ev(`document.querySelectorAll('.desk__programs li').length`);
check('Offers: Apple Malaysia programmes listed', progs > 0, `${progs}`);
check('Offers: every programme shows a region status', await ev(`[...document.querySelectorAll('[data-offers-apple] .desk__programs li')].every(li => /region|Malaysia|Sabah|Sarawak|Johor|Penang|Selangor|Kuala|Perak|Kedah|Pahang|Melaka|Kelantan|Terengganu|Perlis|Labuan|Putrajaya|Negeri/i.test(li.innerText))`));
check('Offers: news list or empty message', await ev(`!!document.querySelector('[data-offers-list] .desk__empty, [data-offers-list] .fresh__item')`));
check('Offers: no errors', !errors.length, errors.join(' | '));

// ---- chips tab
errors = [];
await go('#/news?tab=chips', 4000);
const chipTitles = await ev(`[...document.querySelectorAll('[data-chip-list] .fresh__link')].map(a => a.textContent)`);
check('Chips: list has items', chipTitles.length > 0, `${chipTitles.length}`);
check('Chips: no audio / PC / car Snapdragon items', chipTitles.every((t) => !/snapdragon (sound|x\d?\b|x elite|x plus)/i.test(t)));
await ev(`[...document.querySelectorAll('[data-desk-filter]')].find(b => b.dataset.deskFilter === 'snapdragon').click()`); await sleep(300);
const sd = await ev(`[...document.querySelectorAll('[data-chip-list] .fresh__item')].map(li => li.innerText)`);
check('Chips: Snapdragon filter', sd.length > 0 && sd.every((t) => /snapdragon|骁龙/i.test(t)), `${sd.length}`);
await click('[data-chip-videos]'); await sleep(300);
check('Chips: Videos only shows videos or empty message', await ev(`!!document.querySelector('[data-chip-list] .desk__empty') || [...document.querySelectorAll('[data-chip-list] .fresh__item')].every(li => li.querySelector('.auto__topic--video'))`));
check('Chips: no errors', !errors.length, errors.join(' | '));

// ---- tabs navigate
errors = [];
await go('#/news', 3500);
await ev(`[...document.querySelectorAll('.news-tabs a')][1].click()`); await sleep(2500);
check('News tabs: clicking "Software updates" opens it', (await ev('location.hash')).includes('tab=software') && await ev(`!!document.querySelector('[data-desk="software"]')`));
check('News: latest headlines list renders', await ev(`(async () => { location.hash = '#/news'; await new Promise(r => setTimeout(r, 2500)); return document.querySelectorAll('[data-live-list] .live__item').length; })()`) > 0);

// ---- search
errors = [];
await go('#/', 3000);
await ev(`(() => { const i = document.querySelector('[data-searchbox] input'); i.value = 'one ui 9'; i.dispatchEvent(new Event('input', { bubbles: true })); i.form.requestSubmit(); return 1; })()`);
await sleep(2500);
check('Search: submitting goes to results', (await ev('location.hash')).startsWith('#/search'));
check('Search: finds headlines for "one ui 9"', /one ui 9/i.test(await ev(`document.querySelector('#app')?.innerText ?? ''`)));
check('Search: no errors', !errors.length, errors.join(' | '));

// ---- device page: picture and size view
errors = [];
await go('#/device/samsung-galaxy-a37-5g', 3500);
check('Device: hero picture is cropped', await ev(`!!document.querySelector('.dhead__art .fitcrop img')`));
check('Device: picture loaded', await ev(`(() => { const i = document.querySelector('.dhead__art img'); return !!i && i.complete && i.naturalWidth > 0; })()`));
check('Device: size view present', await ev(`!!document.querySelector('[data-szv] .szv__front')`));
await click('[data-szv-real]'); await sleep(300);
check('Device: real-size toggle works', await ev(`document.querySelector('[data-szv]').classList.contains('is-real')`));
check('Device: no errors', !errors.length, errors.join(' | '));

// ---- compare
errors = [];
await go('#/compare/samsung-galaxy-s26-ultra,apple-iphone-18-pro-max', 3500);
await click('[data-szv-overlay]'); await sleep(300);
check('Compare: overlay toggle works', await ev(`document.querySelector('[data-szv]').classList.contains('is-overlay')`));
check('Compare: verdict and benchmarks render', await ev(`document.querySelectorAll('#app section').length`) > 4);
check('Compare: no errors', !errors.length, errors.join(' | '));

// ---- compare tray
errors = [];
await go('#/devices/smartphone', 3500);
await click('[data-compare-toggle]', 0); await sleep(400);
check('Compare tray: adding a device marks the button', await ev(`document.querySelector('[data-compare-toggle]').getAttribute('aria-pressed') === 'true'`));
await click('[data-compare-toggle]', 0); await sleep(300);
check('Compare tray: no errors', !errors.length, errors.join(' | '));

// ---- Ask
errors = [];
await go('#/', 3000);
await click('.ask-launch'); await sleep(500);
await ev(`(() => { const f = document.querySelector('[data-ask-form]'); const i = f.querySelector('input, textarea'); i.value = 'which earbuds have the longest battery?'; f.requestSubmit(); return 1; })()`);
await sleep(3500);
const answer = await ev(`document.querySelector('[data-ask-log]')?.innerText ?? ''`);
check('Ask: answers an earbuds question', /earbud|buds|airpods|hour|h\b/i.test(answer) && answer.length > 60, answer.slice(0, 80).replace(/\n/g, ' '));
check('Ask: no errors', !errors.length, errors.join(' | '));

// ---- switches
errors = [];
await go('#/', 3000);
const before = await ev(`document.documentElement.dataset.theme || 'auto'`);
await ev(`document.querySelector('[data-action="theme"], .theme-btn, [aria-label*="theme" i], [aria-label*="dark" i]')?.click()`); await sleep(400);
check('Theme switch changes the theme', (await ev(`document.documentElement.dataset.theme || 'auto'`)) !== before);
await ev(`document.querySelector('[data-action="theme"], .theme-btn, [aria-label*="theme" i], [aria-label*="light" i]')?.click()`); await sleep(300);
await click('[data-mode-set="simple"]'); await sleep(400);
check('Simple view switch', await ev(`document.documentElement.dataset.mode`) === 'simple');
await click('[data-mode-set="detailed"]'); await sleep(300);
await click('[data-action="lang"]'); await sleep(1500);
check('Language switch to Chinese', /[一-鿿]/.test(await ev(`document.querySelector('.site-header')?.innerText ?? ''`)));
await click('[data-action="lang"]'); await sleep(1500);
check('Language switch back to English', await ev(`localStorage.getItem('tch-lang')`) === 'en');
check('Switches: no errors', !errors.length, errors.join(' | '));

// ---- SEO page (no scripts) and not-found
errors = [];
await send('Page.navigate', { url: base.replace(/\?.*$/, '') + 'd/samsung-galaxy-s26-ultra/' }); await sleep(2000);
check('Search-engine device page renders', /Galaxy S26 Ultra/.test(await ev(`document.body.innerText`)));
check('Search-engine page: no errors', !errors.length, errors.join(' | '));
await go('#/device/does-not-exist', 2500);
check('Unknown device shows a friendly not-found page', /not|no device|404/i.test(await ev(`document.querySelector('#app')?.innerText ?? ''`)));

await ev(`localStorage.setItem('tch-lang','en'); localStorage.setItem('tch.mode.v1', JSON.stringify('detailed')); localStorage.setItem('tch.theme.v1', JSON.stringify('light')); 1`);
await send('Emulation.clearDeviceMetricsOverride');
console.log(`\n${fails} failed check(s)`);
process.exit(0);
