// node sweep.mjs <port> <base> <widths comma> <lang en|zh> <mode detailed|simple> <route> [route...]
// For each route and width: horizontal overflow, elements poking out of the viewport, console errors and exceptions.
const [port, base, widthsArg, lang, mode, file] = process.argv.slice(2); const routes = (await import('node:fs')).readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
const widths = widthsArg.split(',').map(Number);
const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page' && !t.url.startsWith('chrome-extension')).webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(); let errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0].slice(0, 200));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('ERR ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon/.test(m.params.entry.url ?? '')) errors.push('LOG ' + (m.params.entry.text + ' ' + (m.params.entry.url ?? '')).slice(0, 200));
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); return r.result?.result?.value; };

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
const PROBE = `(() => {
  const cw = document.documentElement.clientWidth, sw = document.documentElement.scrollWidth;
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.right > cw + 1 || r.left < -1) {
      // ignore things inside a deliberately scrolling box
      let p = el.parentElement, scrolls = false;
      while (p && p !== document.body) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflowX) && p.scrollWidth > p.clientWidth - 1) { scrolls = true; break; } if (/(auto|scroll|hidden)/.test(s.overflowX)) { scrolls = true; break; } p = p.parentElement; }
      if (!scrolls && getComputedStyle(el).position !== 'fixed') out.push((el.tagName.toLowerCase() + '.' + [...el.classList].slice(0, 2).join('.')).slice(0, 50) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
    }
  }
  const wrapped = [...document.querySelectorAll('.btn, .lang-btn, .modeswitch__btn, .chip, .tag, .seg__btn')].filter((b) => b.offsetHeight && b.getClientRects().length && b.scrollHeight > 0 && b.offsetHeight > 2 * parseFloat(getComputedStyle(b).lineHeight || 20) + 16).map((b) => b.textContent.trim().slice(0, 30));
  return JSON.stringify({ cw, sw, out: [...new Set(out)].slice(0, 6), wrapped: wrapped.slice(0, 5), h: document.documentElement.scrollHeight, title: document.title.slice(0, 50) });
})()`;
// language and view preferences
await send('Page.navigate', { url: base + '#/' });
await sleep(2500);
await send('Runtime.evaluate', { expression: `localStorage.setItem('tch-lang', '${lang}'); localStorage.setItem('tch.mode.v1', JSON.stringify('${mode}')); 1` });
let problems = 0; global.__n = 0;
for (const w of widths) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 600 });
  for (const route of routes) {
    errors = [];
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(200);
    await send('Page.navigate', { url: base + route });
    await settle(+process.env.WAIT || 3200);
    const r = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    let v; try { v = JSON.parse(r.result.result.value); } catch { v = { error: 'probe failed' }; }
    const bad = v.sw > v.cw + 1 || v.out?.length || errors.length || v.wrapped?.length || v.error;
    if (bad) problems++;
    if (bad || (++global.__n % 100 === 0)) console.log(`${bad ? 'FAIL' : 'ok  '} ${w}px ${route.padEnd(48)} sw=${v.sw} cw=${v.cw} h=${v.h}${v.out?.length ? ' OUT:' + v.out.join(' | ') : ''}${v.wrapped?.length ? ' WRAP:' + v.wrapped.join(' | ') : ''}${errors.length ? '\n     ' + [...new Set(errors)].join('\n     ') : ''}`);
  }
}
await send('Emulation.clearDeviceMetricsOverride');
await send('Runtime.evaluate', { expression: `localStorage.setItem('tch.mode.v1', JSON.stringify('detailed')); 1` });
console.log(`done: ${problems} problem page(s)`);
process.exit(0);
