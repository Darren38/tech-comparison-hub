// Charts (Version 14): ranked bars for each measured test and generation lines for each flagship series.
// Only a device's own measured results are drawn (never a chipset stand-in or a manufacturer claim), each bar names
// who measured it, and one lab's results are never mixed with another's on the same axis. Where a Galaxy was tested
// in its Snapdragon version and the site records the Malaysian Exynos model, the result is its own labelled bar.

import { html, mount } from '../lib/html.js';
import { fmtMetric, fmtNumber, fmtDateTime } from '../lib/format.js';
import { store, metricDef, sourceName, deviceTitle, brandName } from '../core/store.js';
import { href } from '../core/router.js';
import { pageTrail, autoBadge } from '../ui/components.js';
import { t } from '../core/i18n.js';
import { LINES } from '../engine/lines.js';

// Legible on dark and light backgrounds (some brand colours are near-black).
const BRAND_COLOR = {
  samsung: '#4c7dff', apple: '#a7b0c0', google: '#34a853', xiaomi: '#ff7a1a', redmi: '#ff5a4f', poco: '#e8b900',
  vivo: '#7d8cff', iqoo: '#ffae00', oppo: '#1fb57a', oneplus: '#ff3b4a', realme: '#d9ae00', honor: '#29b6f6',
  huawei: '#e53935', asus: '#5aa0e6', sony: '#b8b8b8', motorola: '#8fa3bf', nothing: '#ff5a5f', redmagic: '#ff4d4d',
  nubia: '#ff4d4d', zte: '#27a4e8',
};
const colorOf = (brand) => BRAND_COLOR[brand] ?? '#9aa0a6';

const TABS = [
  { id: 'cpu', label: 'CPU', hue: 'cpu', tests: [['gb6_multi', 'Geekbench 6 multi-core'], ['gb6_single', 'Geekbench 6 single-core']] },
  { id: 'gpu', label: 'GPU', hue: 'gpu', tests: [['wle', '3DMark Wild Life Extreme'], ['steel_nomad_light', '3DMark Steel Nomad Light'], ['solar_bay', '3DMark Solar Bay']] },
  { id: 'antutu', label: 'AnTuTu', hue: 'cpu', tests: [['antutu_v11', 'AnTuTu 11 total']] },
  { id: 'battery', label: 'Battery', hue: 'battery', tests: [['tg_web', "Tom's Guide web test"], ['gsma_active_use', 'GSMArena Active Use'], ['dxomark_battery', 'DXOMARK battery score'], ['tr_video_drain', 'Trusted Reviews video drain']] },
  { id: 'charging', label: 'Charging', hue: 'charging', tests: [['charge_30', 'Charge after 30 minutes'], ['charge_15', 'Charge after 15 minutes'], ['charge_full', 'Time to full']] },
  { id: 'display', label: 'Display', hue: 'display', tests: [['nits_peak', 'Peak brightness (measured)'], ['dxomark_display', 'DXOMARK display score']] },
  { id: 'camera', label: 'Camera', hue: 'camera', tests: [['dxomark_camera', 'DXOMARK camera (protocol v6)'], ['dxomark_camera_v5', 'DXOMARK camera (protocol v5)']] },
  { id: 'claims', label: 'Maker claims', hue: 'battery', tests: [['claim_buds_total', 'Earbuds: hours with the case'], ['claim_buds_life', 'Earbuds: hours per charge'], ['claim_watch_life', 'Watches & bands: battery days'], ['claim_tab_weight', 'Tablets: weight'], ['claim_tab_charging', 'Tablets: charging speed'], ['claim_phone_charging', 'Phones: charging speed']] },
  { id: 'generations', label: 'Generations', hue: 'gen', tests: [['gb6_multi', 'Geekbench 6 multi-core'], ['wle', '3DMark Wild Life Extreme'], ['antutu_v11', 'AnTuTu 11'], ['tg_web', "Tom's Guide battery test"], ['charge_30', 'Charge after 30 minutes'], ['dxomark_camera_v5', 'DXOMARK camera (v5)']] },
];
const YEARS = ['2023', '2024', '2025', '2026'];
// Version 19: tests whose results update by themselves (tools/refresh_benchmarks.py daily, tools/auto_benchmarks.py for
// phones not matched by hand; NanoReview's Geekbench averages weekly). Other tests are reviewers' own, added by hand.
const AUTO_TESTS = {
  gb6_multi: ['weekly', 'Geekbench 6 averages from NanoReview; results from reviews are added by hand'],
  gb6_single: ['weekly', 'Geekbench 6 averages from NanoReview; results from reviews are added by hand'],
  wle: ['daily', 'from UL’s 3DMark database'], steel_nomad_light: ['daily', 'from UL’s 3DMark database'], solar_bay: ['daily', 'from UL’s 3DMark database'],
  antutu_v11: ['daily', 'from AnTuTu’s ranking'],
  dxomark_camera: ['daily', 'from DXOMARK’s public list'], dxomark_camera_v5: ['daily', 'from DXOMARK’s public list'],
  dxomark_display: ['daily', 'from DXOMARK’s public list'], dxomark_battery: ['daily', 'from DXOMARK’s public list'],
};
// Drawn at first: each brand's top series. Every other series can be switched on under the chart.
const PRIMARY = ['Galaxy S Ultra', 'Galaxy Z Fold', 'iPhone Pro Max', 'Pixel Pro XL', 'Xiaomi Ultra', 'OPPO Find X Pro',
  'vivo X Pro', 'HONOR Magic Pro', 'Huawei Pura Ultra', 'OnePlus', 'iQOO', 'POCO F Ultra'];
// Series of one brand share its colour, so they are told apart by lightness.
function seriesColors() {
  const seen = {};
  return Object.fromEntries(LINES.map(([name, brand]) => {
    const k = Math.min(seen[brand] = (seen[brand] ?? -1) + 1, 3);
    return [name, k ? `color-mix(in srgb, ${colorOf(brand)} ${100 - k * 22}%, #ffffff)` : colorOf(brand)];
  }));
}
const SERIES_COLOR = seriesColors();

// A series is named by its real models, never by an invented series name: "Galaxy S23 Ultra → S26 Ultra".
const lineRows = (ids) => ids.map((id) => store.deviceById.get(id)).filter(Boolean);
function modelRange(ids) {
  const rows = lineRows(ids);
  if (!rows.length) return '';
  const first = rows[0].name, last = rows[rows.length - 1].name;
  if (rows.length === 1) return first;
  // the latest model without the words it shares with the first ("Galaxy", "OPPO Find"), when that still reads as a model
  const a = first.split(' '), b = last.split(' ');
  let k = 0;
  while (k < a.length - 1 && k < b.length - 1 && a[k] === b[k]) k++;
  const tail = b.slice(k).join(' ');
  return `${first} → ${/^[A-Za-z]/.test(tail) ? tail : last}`;
}
const modelList = (ids) => lineRows(ids).map((r) => r.name).join(' → ');
const LINE_IDS = Object.fromEntries(LINES.map(([name, , ids]) => [name, ids]));

const yearOf = (row) => String(row.announced ?? '').slice(0, 4);
const monthPos = (row) => {
  const [y, m] = String(row.announced ?? '').split('-');
  return Number(y) + ((Number(m) || 6) - 0.5) / 12;
};

function readState(query = {}) {
  const tab = TABS.find((t) => t.id === query.tab) ?? TABS[0];
  const test = tab.tests.find(([id]) => id === query.test)?.[0] ?? tab.tests[0][0];
  return { tab: tab.id, test, all: query.all === '1', years: new Set(query.years ? query.years.split(',') : YEARS), hidden: new Set(), lines: new Set(PRIMARY) };
}

// Version 17: tablets, watches, bands and earbuds have few lab tests yet, so the "Maker claims" tab charts what the makers
// state, clearly labelled as claims and never mixed with measured results. The values are the ones on each device page.
const days = (h) => `${fmtNumber(h / 24, h % 24 ? 1 : 0)} days`;
const CLAIMS = {
  claim_buds_total: { cats: ['earbuds'], get: (r) => r.f?.totalLifeH, fmt: (v) => `${fmtNumber(v, v % 1 ? 1 : 0)} h`, name: 'Listening time including the charging case (maker’s claim)' },
  claim_buds_life: { cats: ['earbuds'], get: (r) => r.f?.batteryLifeH, fmt: (v) => `${fmtNumber(v, v % 1 ? 1 : 0)} h`, name: 'Listening time from one charge of the earbuds (maker’s claim)' },
  claim_watch_life: { cats: ['smartwatch', 'band'], get: (r) => r.f?.batteryLifeH, fmt: days, name: 'Longest battery life the maker claims (usually with light use)' },
  claim_tab_weight: { cats: ['tablet'], get: (r) => r.f?.weightG, fmt: (v) => `${fmtNumber(v)} g`, lower: true, name: 'Tablet weight as the maker lists it (Wi-Fi model where they differ)' },
  claim_tab_charging: { cats: ['tablet'], get: (r) => r.f?.wiredW, fmt: (v) => `${fmtNumber(v)} W`, name: 'Fastest wired charging the maker lists' },
  claim_phone_charging: { cats: ['smartphone'], get: (r) => r.f?.wiredW, fmt: (v) => `${fmtNumber(v)} W`, name: 'Fastest wired charging the maker lists' },
};

function claimEntries(test, state) {
  const c = CLAIMS[test];
  const out = [];
  for (const row of store.devices) {
    if (!c.cats.includes(row.category)) continue;
    const y = yearOf(row);
    if (y && !state.years.has(y)) continue;
    if (state.hidden.has(row.brand)) continue;
    const v = c.get(row);
    if (typeof v === 'number' && v > 0) out.push({ row, value: v, sources: [], claim: true });
  }
  out.sort((a, b) => (c.lower ? a.value - b.value : b.value - a.value));
  return { def: { name: c.name, better: c.lower ? 'lower' : 'higher', fmt: c.fmt }, list: out, lower: Boolean(c.lower) };
}

/** Entries for one test: each phone's own result, plus other chip versions as separate entries. */
function entries(test, state) {
  if (CLAIMS[test]) return claimEntries(test, state);
  const def = metricDef(test);
  const out = [];
  for (const row of store.devices) {
    if (row.category !== 'smartphone') continue;
    if (!state.all && !row.flagship) continue;
    if (!state.years.has(yearOf(row))) continue;
    if (state.hidden.has(row.brand)) continue;
    const m = row.m?.[test];
    if (m && !m[2]) out.push({ row, value: m[0], sources: row.ms?.[test] ?? [], chip: row.chipsetName });
    for (const [chip, value, sources] of row.mv?.[test] ?? []) {
      out.push({ row, value, sources, chip: store.chipsetById.get(chip)?.name ?? chip, variant: true });
    }
  }
  const lower = def?.better === 'lower';
  out.sort((a, b) => (lower ? a.value - b.value : b.value - a.value));
  return { def, list: out, lower };
}

function rankedBars(test, state, hue) {
  const { def, list, lower } = entries(test, state);
  if (!list.length) return html`<p class="muted small chart-empty">No measured results for these filters yet.</p>`;
  const best = list[0].value;
  const scale = (v) => (lower ? best / v : v / best) * 100;
  return html`<ol class="rank" style="--hue:var(--chart-${hue})">
    ${list.map((e, i) => html`<li class="rank__row ${e.variant ? 'is-variant' : ''}">
      <span class="rank__n num">${i + 1}</span>
      <span class="rank__who">
        <a class="rank__name" href="${href(`/device/${e.row.id}`)}" style="--brand:${colorOf(e.row.brand)}">${deviceTitle(e.row)}${e.variant ? html` <span class="rank__variant">${e.chip} version</span>` : ''}</a>
        <span class="rank__sub tiny">${e.variant ? 'Not the Malaysian model · ' : ''}${e.chip ?? ''}${e.chip ? ' · ' : ''}${yearOf(e.row) || 'year not recorded'}</span>
      </span>
      <span class="rank__track" aria-hidden="true"><span class="rank__fill" style="width:${Math.max(2, scale(e.value)).toFixed(1)}%"></span></span>
      <span class="rank__val num">${def.fmt ? def.fmt(e.value) : fmtMetric(def, e.value)}</span>
      <span class="rank__src tiny">${e.claim ? html`<span class="src-chip src-chip--claim">${brandName(e.row.brand)} claim</span>` : e.sources.map((s) => html`<a href="${href(`/source/${s}`)}" class="src-chip">${sourceName(s)}</a>`)}</span>
    </li>`)}
  </ol>`;
}

// ------------------------------------------------------------------ generation lines (SVG)
function smooth(points) {
  if (points.length < 3) return points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
  let d = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [points[i - 1] ?? points[i], points[i], points[i + 1], points[i + 2] ?? points[i + 1]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function generationChart(test, state) {
  const def = metricDef(test);
  const series = [];
  for (const [name, brand, ids] of LINES) {
    if (!state.lines.has(name)) continue;
    const pts = ids.map((id) => store.deviceById.get(id)).filter(Boolean)
      .map((row) => ({ row, m: row.m?.[test] }))
      .filter(({ row, m }) => m && !m[2] && state.years.has(yearOf(row)))
      .map(({ row, m }) => ({ row, x: monthPos(row), y: m[0], sources: row.ms?.[test] ?? [] }));
    if (pts.length >= 2) series.push({ name, brand, pts });
  }
  if (!series.length) return html`<p class="muted small chart-empty">Not enough measured results in one series to draw a line for this test yet.</p>`;
  const W = 920, H = 460, L = 64, R = 170, T = 24, B = 44;
  const xs = series.flatMap((s) => s.pts.map((p) => p.x));
  const ys = series.flatMap((s) => s.pts.map((p) => p.y));
  const x0 = Math.floor(Math.min(...xs)), x1 = Math.ceil(Math.max(...xs));
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const pad = (yMax - yMin) * 0.08 || yMax * 0.1;
  const y0 = Math.max(0, yMin - pad), y1 = yMax + pad;
  const px = (x) => L + ((x - x0) / Math.max(x1 - x0, 1)) * (W - L - R);
  const py = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const ticks = Array.from({ length: 5 }, (_, i) => y0 + ((y1 - y0) * i) / 4);
  const years = Array.from({ length: Math.max(x1 - x0, 1) }, (_, i) => x0 + i);
  // End labels in a column right of the plot, each joined to its line's last dot, spaced so none overlap
  // (socpk.com labels every line with its model this way instead of a separate key).
  const labels = series.map((s) => { const last = s.pts[s.pts.length - 1]; return { s, x: px(last.x), y: py(last.y), ly: py(last.y) }; }).sort((a, b) => a.y - b.y);
  const GAP = 15;
  for (let i = 1; i < labels.length; i++) if (labels[i].ly - labels[i - 1].ly < GAP) labels[i].ly = labels[i - 1].ly + GAP;
  const overflow = labels.length ? labels[labels.length - 1].ly - (H - B) : 0;
  if (overflow > 0) {
    for (const l of labels) l.ly -= overflow;
    for (let i = labels.length - 2; i >= 0; i--) if (labels[i + 1].ly - labels[i].ly < GAP) labels[i].ly = labels[i + 1].ly - GAP;
  }
  const LX = W - R + 14;
  const lower = def?.better === 'lower';
  return html`<figure class="gen">
    <div class="gen__scroll"><svg viewBox="0 0 ${W} ${H}" class="gen__svg" role="img" aria-label="${def?.name} by launch date for each flagship series">
      ${ticks.map((t) => html`<g><line x1="${L}" x2="${W - R}" y1="${py(t).toFixed(1)}" y2="${py(t).toFixed(1)}" class="gen__grid"/><text x="${L - 8}" y="${(py(t) + 4).toFixed(1)}" class="gen__tick" text-anchor="end">${fmtNumber(t, t < 20 ? 1 : 0)}</text></g>`)}
      ${years.map((y) => html`<g><line x1="${px(y).toFixed(1)}" x2="${px(y).toFixed(1)}" y1="${T}" y2="${H - B}" class="gen__grid gen__grid--v"/><text x="${px(y + 0.5).toFixed(1)}" y="${H - B + 22}" class="gen__tick" text-anchor="middle">${y}</text></g>`)}
      ${series.map((s) => html`<g class="gen__series" style="--c:${SERIES_COLOR[s.name]}">
        <path d="${smooth(s.pts.map((p) => [px(p.x), py(p.y)]))}" class="gen__line"/>
        ${s.pts.map((p) => html`<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="4" class="gen__dot"><title>${deviceTitle(p.row)}: ${fmtMetric(def, p.y)} (${p.sources.map(sourceName).join(', ')})</title></circle>`)}
      </g>`)}
      ${series.length <= 4 ? series.map((s) => s.pts.slice(0, -1).map((p) => html`<text x="${px(p.x).toFixed(1)}" y="${(py(p.y) - 10).toFixed(1)}" class="gen__label gen__label--dot" text-anchor="middle" style="fill:${SERIES_COLOR[s.name]}">${p.row.name}</text>`)) : ''}
      ${labels.map((l) => html`<g class="gen__tag" style="--c:${SERIES_COLOR[l.s.name]}">
        <path d="M${(l.x + 5).toFixed(1)} ${l.y.toFixed(1)}C${(LX - 16).toFixed(1)} ${l.y.toFixed(1)} ${(LX - 16).toFixed(1)} ${l.ly.toFixed(1)} ${(LX - 4).toFixed(1)} ${l.ly.toFixed(1)}" class="gen__leader"/>
        <text x="${LX}" y="${(l.ly + 4).toFixed(1)}" class="gen__label" style="fill:${SERIES_COLOR[l.s.name]}">${l.s.pts[l.s.pts.length - 1].row.name}<title>${modelList(LINE_IDS[l.s.name])}</title></text>
      </g>`)}
      <text x="${L}" y="${T - 8}" class="gen__axis">${def?.name}</text>
      <text x="${W - R}" y="${T - 8}" class="gen__badge" text-anchor="end">${lower ? '↓ Lower is better' : '↑ Higher is better'}</text>
    </svg></div>
    <figcaption class="tiny muted">Each line follows one flagship series from model to model, each dot one model at its launch date, drawn only where that model was measured itself. Lines are labelled with their latest measured model; with four lines or fewer every dot is named. Hover a dot for its result and who measured it.</figcaption>
  </figure>`;
}

function seriesLegend(state) {
  return html`<div class="chips" role="group" aria-label="Series">
    ${LINES.map(([name, , ids]) => html`<button type="button" class="chip ${state.lines.has(name) ? 'is-on' : ''}" data-line="${name}" aria-pressed="${state.lines.has(name)}" title="${modelList(ids)}" style="--brand:${SERIES_COLOR[name]}"><span class="chip__dot"></span>${modelRange(ids)}</button>`)}
  </div>`;
}

function legend(state) {
  const cats = CLAIMS[state.test]?.cats;
  const brands = [...new Set(store.devices.filter((d) => (cats ? cats.includes(d.category) : d.category === 'smartphone' && d.flagship)).map((d) => d.brand))].sort();
  return html`<div class="chips" role="group" aria-label="Brands">
    ${brands.map((b) => html`<button type="button" class="chip ${state.hidden.has(b) ? '' : 'is-on'}" data-brand="${b}" aria-pressed="${!state.hidden.has(b)}" style="--brand:${colorOf(b)}"><span class="chip__dot"></span>${brandName(b)}</button>`)}
  </div>`;
}

function panel(state) {
  const tab = TABS.find((t) => t.id === state.tab);
  const def = metricDef(state.test);
  return html`<section class="chart-panel">
    <div class="chart-panel__bar">
      <div class="seg" role="tablist" aria-label="Test">${tab.tests.map(([id, label]) => html`<button type="button" role="tab" class="seg__btn ${id === state.test ? 'is-on' : ''}" aria-selected="${id === state.test}" data-test="${id}">${label}</button>`)}</div>
      <div class="chart-panel__opts">
        <div class="seg seg--sm" role="group" aria-label="Launch year">${YEARS.map((y) => html`<button type="button" class="seg__btn ${state.years.has(y) ? 'is-on' : ''}" aria-pressed="${state.years.has(y)}" data-year="${y}">${y}</button>`)}</div>
        ${state.tab === 'generations' || state.tab === 'claims' ? '' : html`<label class="switch small"><input type="checkbox" data-all ${state.all ? 'checked' : ''}> All phones, not only flagships</label>`}
      </div>
    </div>
    ${AUTO_TESTS[state.test] && state.tab !== 'generations' ? html`<p class="chart-panel__auto">${autoBadge(...AUTO_TESTS[state.test])}</p>` : ''}
    ${CLAIMS[state.test] ? html`<p class="small chart-panel__desc chart-claim-note"><strong>Maker claims, not measurements.</strong> ${CLAIMS[state.test].name}. Makers test in their own ways, so treat small differences with care; measured results appear in the other tabs as labs publish them.</p>` : def?.description ? html`<p class="tiny muted chart-panel__desc">${def.description}</p>` : ''}
    <div class="chart-panel__body">${state.tab === 'generations' ? generationChart(state.test, state) : rankedBars(state.test, state, tab.hue)}</div>
    ${state.tab === 'generations' ? seriesLegend(state) : legend(state)}
  </section>`;
}

export default async function render({ query }) {
  const state = readState(query);
  return {
    title: 'Charts',
    html: html`<div class="stack-lg charts">
      ${pageTrail([{ label: 'Home', href: href('/') }, { label: 'Charts' }])}
      <header>
        <div class="eyebrow">Measured results, with maker claims kept apart</div>
        <h1>Charts</h1>
        <p class="muted" style="margin-top:8px;max-width:78ch">Every bar is a test result for that phone, named with the labs or publications that measured it. Standard benchmarks (Geekbench, 3DMark, AnTuTu) are the same test wherever they are run, so their results share a chart; tests with a lab's own method (battery life, charging, brightness, DXOMARK scores) each get their own chart and are never put on one scale. Manufacturer claims never share a chart with measurements: they have their own <em>Maker claims</em> tab (tablets, watches, bands and earbuds, which few labs test yet), labelled as claims. A Galaxy tested in its Snapdragon version is shown as its own striped bar, separate from the Exynos model sold in Malaysia.</p>
        ${store.core.build?.auto?.benchmarks ? html`<p class="small muted" style="margin-top:6px;max-width:78ch">${t('Results from UL 3DMark, DXOMARK and AnTuTu are re-checked automatically every morning (last check {when}), and Geekbench averages from NanoReview every week. A new phone joins these charts by itself once its exact name and chip match a listing. Reviewers’ own tests (battery life, charging, brightness) are added by hand.', { when: fmtDateTime(store.core.build.auto.benchmarks.at) })}</p>` : ''}
      </header>
      <nav class="tabs" aria-label="Chart">${TABS.map((t) => html`<a href="${href('/charts', { tab: t.id })}" aria-current="${t.id === state.tab ? 'true' : 'false'}">${t.label}</a>`)}</nav>
      <div data-chart>${panel(state)}</div>
    </div>`,
    mount(root) {
      const box = root.querySelector('[data-chart]');
      const redraw = () => mount(box, panel(state));
      const onClick = (ev) => {
        const b = ev.target.closest('button');
        if (!b || !box.contains(b)) return;
        if (b.dataset.test) state.test = b.dataset.test;
        else if (b.dataset.year) {
          const y = b.dataset.year;
          if (state.years.has(y) && state.years.size > 1) state.years.delete(y); else state.years.add(y);
        } else if (b.dataset.line) {
          const x = b.dataset.line;
          if (state.lines.has(x)) state.lines.delete(x); else state.lines.add(x);
        } else if (b.dataset.brand) {
          const x = b.dataset.brand;
          if (state.hidden.has(x)) state.hidden.delete(x); else state.hidden.add(x);
        } else return;
        redraw();
      };
      const onChange = (ev) => {
        if (ev.target.matches('[data-all]')) { state.all = ev.target.checked; redraw(); }
      };
      box.addEventListener('click', onClick);
      box.addEventListener('change', onChange);
      return () => { box.removeEventListener('click', onClick); box.removeEventListener('change', onChange); };
    },
  };
}
