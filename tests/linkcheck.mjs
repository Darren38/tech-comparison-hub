// Version 33: news and reviews <-> device pages, both ways. node linkcheck.mjs <cdp port> <base>
// 1. Every checked or automatic document that names devices: each device's page links to the document.
// 2. The News / Reviews lists show each such document with links to all its devices.
// 3. A sample of automatic headlines tagged to devices: each device page's headline section links to the headline.
const [port, base] = process.argv.slice(2);
const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value; };

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

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
const go = async (route, wait = 3000) => { await send('Page.navigate', { url: 'about:blank' }); await sleep(100); await send('Page.navigate', { url: base + route }); await settle(wait); };
await go('#/');
await ev(`localStorage.setItem('tch-lang','en'); localStorage.setItem('tch.mode.v1', JSON.stringify('detailed')); 1`);
const data = await ev(`(async () => {
  const docs = await fetch('generated/index/documents.json').then((r) => r.json());
  const devs = await fetch('generated/index/devices.json').then((r) => r.json());
  let arch = { items: [] }; try { arch = await fetch('live/archive.json').then((r) => r.json()); } catch {}
  return { docs: docs.filter((d) => (d.devices ?? []).length && d.kind !== 'benchmark').map((d) => ({ id: d.id, url: d.url, kind: d.kind, devices: d.devices, auto: !!d.auto })),
    devIds: devs.map((d) => d.id), heads: (arch.items ?? []).filter((i) => (i.devices ?? []).length).slice(0, 4000).map((i) => ({ url: i.url, devices: i.devices })) };
})()`);
const devIds = new Set(data.devIds);
// open every "show more" on the page, then collect every link
const allLinks = `(async () => { for (let k = 0; k < 40; k++) { const b = [...document.querySelectorAll('main button')].find((b) => /^Show \\d+ more|^Show more|^Show all/i.test(b.innerText.trim()) && b.offsetParent); if (!b) break; b.click(); await new Promise((r) => setTimeout(r, 250)); } return [...document.querySelectorAll('main a[href]')].map((a) => a.getAttribute('href')); })()`;
const byDevice = new Map();
for (const d of data.docs) for (const dev of d.devices) { if (!byDevice.has(dev)) byDevice.set(dev, []); byDevice.get(dev).push(d); }
// headline sample: up to 3 headlines for each of 60 devices
const headSample = new Map();
for (const h of data.heads) for (const dev of h.devices) { if (!devIds.has(dev)) continue; if (!headSample.has(dev)) headSample.set(dev, []); if (headSample.get(dev).length < 3) headSample.get(dev).push(h.url); }
const headDevs = [...headSample.keys()].slice(0, 60);
const missing = []; const unknownDev = []; let checked = 0, headChecked = 0;
// Version 38: LINKCHECK_DEVICES=id,id,... checks only those device pages (a release's changed devices); empty = all
const only = new Set((process.env.LINKCHECK_DEVICES ?? '').split(',').map((x) => x.trim()).filter(Boolean));
const devicesToOpen = [...new Set([...byDevice.keys(), ...headDevs])].filter((d) => !only.size || only.has(d));
if (only.size) console.log(`only the ${devicesToOpen.length} changed device page(s) of ${only.size} listed`);
for (const dev of devicesToOpen) {
  if (!devIds.has(dev)) { unknownDev.push(dev); continue; }
  await go('#/device/' + dev, 3200);
  const links = new Set(await ev(allLinks));
  for (const d of byDevice.get(dev) ?? []) { checked++; if (!links.has(d.url)) missing.push(`device ${dev} lacks ${d.auto ? 'automatic ' : 'checked '}${d.kind} ${d.id}`); }
  for (const u of headSample.get(dev) ?? []) { headChecked++; if (!links.has(u)) missing.push(`device ${dev} lacks headline ${u}`); }
}
console.log(`device pages opened: ${devicesToOpen.length}; document links checked: ${checked}; headline links checked: ${headChecked}`);
// the other way: News and Reviews lists show each document with links to all its devices
const listMissing = [];
for (const [route, kinds] of [['#/news', ['news', 'official']], ['#/reviews', ['review', 'video', 'analysis']]]) {
  await go(route, 4000);
  const cards = await ev(`(async () => { for (let k = 0; k < 80; k++) { const b = [...document.querySelectorAll('[data-docs-more]')][0]; if (!b) break; b.click(); await new Promise((r) => setTimeout(r, 200)); }
    return [...document.querySelectorAll('[data-list] .doc, [data-list] .timeline__item')].map((c) => ({ urls: [...c.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')) })); })()`);
  const all = new Set(cards.flatMap((c) => c.urls));
  for (const d of data.docs.filter((x) => kinds.includes(x.kind) && !x.auto)) {
    if (!all.has(d.url)) { listMissing.push(`${route} lacks ${d.id}`); continue; }
    const card = cards.find((c) => c.urls.includes(d.url));
    const lacking = d.devices.filter((dev) => devIds.has(dev) && !card.urls.includes('#/device/' + dev));
    if (lacking.length) listMissing.push(`${route} card ${d.id} lacks device link(s) ${lacking.join(', ')}`);
  }
}
console.log(`\nmissing on device pages: ${missing.length}`); missing.slice(0, 40).forEach((m) => console.log('  ' + m));
console.log(`missing in the News/Reviews lists: ${listMissing.length}`); listMissing.slice(0, 40).forEach((m) => console.log('  ' + m));
console.log(`documents naming devices not in the hub: ${unknownDev.length} ${unknownDev.slice(0, 5).join(', ')}`);
await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);
process.exit(0);
