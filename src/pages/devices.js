// Browse & filter. Filters come from the category definition (data/categories/*.json),
// so a new device category gets its own filters without code changes. State lives in the URL.

import { html, mount } from '../lib/html.js';
import { fmtNumber, fmtPrice, fmtMetric, plural } from '../lib/format.js';
import { store, brandName, deviceTitle, metricDef, categoryDef } from '../core/store.js';
import { href, setQuery } from '../core/router.js';
import { deviceCard, emptyState, compareButton, provBadge, confMeter, icon, statusBadge, priceTag, pageTrail } from '../ui/components.js';
import { displayPrice, selectedCurrency, convert } from '../engine/money.js';
import { miniMeter } from '../ui/charts.js';
import { allCategoryScores, profileScore, valueScores, rankingCurrency, getMetric, profilePhrase, isOnSale } from '../engine/scoring.js';

/** Filter value for a device: prices follow the reader's currency (local launch price, else converted). */
const fieldValue = (row, id) => (id === 'price' ? displayPrice(row)?.amount : row.f[id]);

function rangeText(id, [lo, hi]) {
  const fmt = (x) => (x === null ? '…' : id === 'price' ? fmtPrice(x, selectedCurrency()) : fmtNumber(x, 1));
  return `${fmt(lo)}–${fmt(hi)}`;
}

const SORTS = [
  ['newest', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['price-asc', 'Price: low to high'],
  ['price-desc', 'Price: high to low'],
  ['name', 'Name A–Z'],
  ['evidence', 'Most evidence'],
];

const TABLE_METRICS = {
  smartphone: ['gb6_multi', 'wle_stability', 'gsma_active_use', 'charge_full'],
  tablet: ['gb6_multi', 'spec_battery_wh', 'spec_weight'],
  smartwatch: ['spec_battery_life', 'spec_water_m', 'spec_weight'],
};

function labelFor(filterId, value) {
  if (filterId === 'brand') return brandName(value);
  if (filterId === 'chipset') return store.chipsetById.get(value)?.name ?? value;
  if (filterId === 'form') return { bar: 'Bar', foldable: 'Foldable', tablet: 'Tablet', watch: 'Watch' }[value] ?? value;
  return String(value);
}

function readState(query, filters) {
  const state = {};
  for (const f of filters) {
    if (f.type === 'multi' && query[f.id]) state[f.id] = query[f.id].split(',').filter(Boolean);
    if (f.type === 'range') {
      const min = query[`${f.id}Min`];
      const max = query[`${f.id}Max`];
      if (min || max) {
        let range = [min ? Number(min) : null, max ? Number(max) : null];
        // Price bounds may come from a link written in another currency (e.g. "under $900").
        const cur = selectedCurrency();
        if (f.id === 'price' && query.cur && query.cur !== cur) {
          range = range.map((v) => (v === null ? null : Math.round(convert(v, query.cur, cur) ?? v)));
        }
        state[f.id] = range;
      }
    }
    if (f.type === 'min' && query[f.id]) state[f.id] = Number(query[f.id]);
    if (f.type === 'bool' && query[f.id] === '1') state[f.id] = true;
  }
  return state;
}

function writeState(state, extra) {
  const q = { ...extra };
  for (const [id, v] of Object.entries(state)) {
    if (Array.isArray(v) && v.length && typeof v[0] !== 'number' && v[0] !== null) q[id] = v.join(',');
    else if (Array.isArray(v)) {
      if (v[0] !== null) q[`${id}Min`] = v[0];
      if (v[1] !== null) q[`${id}Max`] = v[1];
    } else if (v === true) q[id] = '1';
    else if (typeof v === 'number') q[id] = v;
  }
  return q;
}

function matches(row, state) {
  for (const [id, v] of Object.entries(state)) {
    const value = fieldValue(row, id);
    if (Array.isArray(v) && typeof v[0] === 'string') {
      const values = Array.isArray(value) ? value : [value];
      if (!values.some((x) => v.includes(String(x)))) return false;
    } else if (Array.isArray(v)) {
      if (value === undefined) return false;
      if (v[0] !== null && value < v[0]) return false;
      if (v[1] !== null && value > v[1]) return false;
    } else if (v === true) {
      if (!value) return false;
    } else if (typeof v === 'number') {
      if (value === undefined || value < v) return false;
    }
  }
  return true;
}

function optionsFor(rows, filterId) {
  const counts = new Map();
  for (const r of rows) {
    const value = r.f[filterId];
    for (const v of Array.isArray(value) ? value : [value]) if (v !== undefined && v !== null) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => (filterId === 'year' ? b[0].localeCompare(a[0]) : labelFor(filterId, a[0]).localeCompare(labelFor(filterId, b[0]))));
}

function filterPanel(filters, rows, state) {
  return html`<form class="filters" data-filters aria-label="Filters">
    ${filters.map((f) => {
      if (f.type === 'multi') {
        const opts = optionsFor(rows, f.id);
        if (opts.length < 2) return '';
        const box = ([v, n]) => html`<label class="check"><input type="checkbox" name="${f.id}" value="${v}" ${(state[f.id] ?? []).includes(v) ? 'checked' : ''} /> ${labelFor(f.id, v)}<span class="count">${n}</span></label>`;
        // Long lists (chipsets, brands) show the most common options first; the rest fold away.
        if (opts.length > 10) {
          const top = [...opts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v]) => v);
          const shown = opts.filter(([v]) => top.includes(v));
          const rest = opts.filter(([v]) => !top.includes(v));
          const openRest = rest.some(([v]) => (state[f.id] ?? []).includes(v));
          return html`<fieldset class="field"><legend>${f.label}</legend><div class="checks">${shown.map(box)}</div>
            <details class="checks-more" ${openRest ? 'open' : ''}><summary>All ${opts.length} options</summary><div class="checks">${rest.map(box)}</div></details></fieldset>`;
        }
        return html`<fieldset class="field"><legend>${f.label}</legend><div class="checks">${opts.map(box)}</div></fieldset>`;
      }
      if (f.type === 'range') {
        const values = rows.map((r) => fieldValue(r, f.id)).filter((v) => v !== undefined && v !== null);
        if (!values.length) return '';
        const [min, max] = state[f.id] ?? [null, null];
        const legend = f.unit === 'currency' ? `${f.label} (${selectedCurrency()})` : f.label;
        return html`<fieldset class="field"><legend>${legend}</legend><div class="range">
          <input class="input" type="number" name="${f.id}Min" placeholder="${fmtNumber(Math.min(...values), 1)}" value="${min ?? ''}" step="${f.step ?? 1}" aria-label="${f.label} minimum" />
          <span class="faint">–</span>
          <input class="input" type="number" name="${f.id}Max" placeholder="${fmtNumber(Math.max(...values), 1)}" value="${max ?? ''}" step="${f.step ?? 1}" aria-label="${f.label} maximum" /></div></fieldset>`;
      }
      if (f.type === 'min') {
        return html`<div class="field"><label for="f-${f.id}">${f.label}</label><select id="f-${f.id}" name="${f.id}"><option value="">Any</option>${f.options.map((o) => html`<option value="${o}" ${state[f.id] === o ? 'selected' : ''}>${fmtNumber(o)}+ ${f.unit ?? ''}</option>`)}</select></div>`;
      }
      if (f.type === 'bool') {
        const n = rows.filter((r) => r.f[f.id]).length;
        return n ? html`<label class="check"><input type="checkbox" name="${f.id}" value="1" ${state[f.id] ? 'checked' : ''} /> ${f.label}<span class="count">${n}</span></label>` : '';
      }
      return '';
    })}
  </form>`;
}

function readForm(form, filters) {
  const data = new FormData(form);
  const state = {};
  for (const f of filters) {
    if (f.type === 'multi') {
      const values = data.getAll(f.id);
      if (values.length) state[f.id] = values;
    } else if (f.type === 'range') {
      const min = data.get(`${f.id}Min`);
      const max = data.get(`${f.id}Max`);
      if (min || max) state[f.id] = [min ? Number(min) : null, max ? Number(max) : null];
    } else if (f.type === 'min') {
      if (data.get(f.id)) state[f.id] = Number(data.get(f.id));
    } else if (f.type === 'bool' && data.get(f.id)) state[f.id] = true;
  }
  return state;
}

function rankRows(rows, category, profileId, valueCurrency) {
  const profile = store.profileById.get(profileId);
  const cats = new Map(rows.map((r) => [r.id, allCategoryScores(r)]));
  const balanced = store.profileById.get('balanced');
  const values = valueCurrency
    ? valueScores(rows, valueCurrency, new Map(rows.map((r) => [r.id, profileScore(cats.get(r.id), balanced, { category, id: r.id })?.score])))
    : new Map();
  // devices not on sale yet (scored on pre-release listings at best) come after the rest (Version 11)
  const onSale = (r) => (isOnSale(r.row) ? 1 : 0);
  return rows
    .map((r) => ({ row: r, result: profileScore(cats.get(r.id), profile, { category, id: r.id, valueScore: values.get(r.id)?.score ?? null }) }))
    .sort((a, b) => onSale(b) - onSale(a) || (b.result?.score ?? -1) - (a.result?.score ?? -1));
}

function sortRows(rows, sort) {
  const price = (r) => displayPrice(r)?.amount ?? null;
  const copy = [...rows];
  switch (sort) {
    case 'oldest':
      return copy.sort((a, b) => (a.announced ?? '').localeCompare(b.announced ?? ''));
    case 'price-asc':
      return copy.sort((a, b) => (price(a) ?? Infinity) - (price(b) ?? Infinity));
    case 'price-desc':
      return copy.sort((a, b) => (price(b) ?? -Infinity) - (price(a) ?? -Infinity));
    case 'name':
      return copy.sort((a, b) => deviceTitle(a).localeCompare(deviceTitle(b)));
    case 'evidence':
      return copy.sort((a, b) => b.docCount - a.docCount);
    default:
      return copy.sort((a, b) => (b.announced ?? '').localeCompare(a.announced ?? ''));
  }
}

function resultsTable(items, category, ranked) {
  const metrics = (TABLE_METRICS[category] ?? []).filter((id) => metricDef(id));
  return html`<div class="table-wrap"><table class="data-table">
    <thead><tr>
      ${ranked ? html`<th scope="col" class="num">Fit</th>` : ''}
      <th scope="col">Device</th>${ranked ? '' : html`<th scope="col">Chipset</th>`}
      ${metrics.map((id) => html`<th scope="col" class="num" title="${metricDef(id).name}">${metricDef(id).short}</th>`)}
      <th scope="col" class="num">Price (${selectedCurrency()})</th><th scope="col"><span class="sr-only">Compare</span></th>
    </tr></thead>
    <tbody>${items.map(({ row, result }) => html`<tr>
      ${ranked ? html`<td class="num">${result ? html`${fmtNumber(result.score)}<div>${miniMeter(result.score)}</div>` : html`<span class="faint">—</span>`}</td>` : ''}
      <th scope="row"><a href="${href(`/device/${row.id}`)}">${deviceTitle(row)}</a> ${statusBadge(row.status)}<div class="tiny muted">${(row.announced ?? '').slice(0, 4)}${ranked && row.chipsetName ? ` · ${row.chipsetName}` : ''}${row.f.hasTests ? '' : ' · specs only'}</div></th>
      ${ranked ? '' : html`<td class="small">${row.chipsetName ?? '—'}</td>`}
      ${metrics.map((id) => {
        const m = getMetric(row, id);
        return html`<td class="num">${m ? html`${fmtMetric(metricDef(id), m.value)} ${confMeter(m.confidence, { label: false })}${m.inherited ? html`<span class="tiny faint"> chip</span>` : ''}` : html`<span class="faint">—</span>`}</td>`;
      })}
      <td class="num small">${priceTag(row, { compact: true })}</td>
      <td>${compareButton(row.id, { small: true })}</td>
    </tr>`)}</tbody></table></div>`;
}

export default async function render({ params, query }) {
  const categoryId = store.categoryById.has(params[0]) ? params[0] : null;
  const cat = categoryId ? categoryDef(categoryId) : null;
  const base = categoryId ? store.devices.filter((d) => d.category === categoryId) : store.devices;
  const filters = cat ? cat.filters : [{ id: 'brand', label: 'Brand', type: 'multi' }, { id: 'year', label: 'Release year', type: 'multi' }, { id: 'hasTests', label: 'Independent test data', type: 'bool' }];
  const rankProfile = query.rank && store.profileById.has(query.rank) && categoryId ? query.rank : null;
  let view = query.view === 'table' || rankProfile ? 'table' : 'grid';
  let sort = query.sort ?? 'newest';
  let state = readState(query, filters);
  // A price filter from a link written in another currency is shown converted. While it stays unchanged the
  // URL keeps the link's own values, so switching currencies back and forth never drifts (RM4,000 → $983 → RM4,001).
  const priceLink = query.cur && query.cur !== selectedCurrency() && state.price
    ? { cur: query.cur, priceMin: query.priceMin, priceMax: query.priceMax, shown: [...state.price] }
    : null;

  const profile = rankProfile ? store.profileById.get(rankProfile) : null;
  // Value is scored only from real launch prices in one currency, never from conversions.
  const valueCurrency = profile && 'value' in profile.weights ? rankingCurrency(base, selectedCurrency()) : null;

  const results = () => {
    const rows = base.filter((r) => matches(r, state));
    return rankProfile ? rankRows(rows, categoryId, rankProfile, valueCurrency) : sortRows(rows, sort).map((row) => ({ row }));
  };

  // Show the list a page at a time; filters, sorting and view changes start again from the first page.
  const PAGE = 48;
  let limit = PAGE;
  const renderResults = (root, { more = false } = {}) => {
    if (!more) limit = PAGE;
    const items = results();
    const visible = items.slice(0, limit);
    const active = Object.entries(state);
    mount(root.querySelector('[data-results]'), html`
      <div class="results-bar">
        <p class="small"><strong>${plural(items.length, 'device')}</strong>${active.length ? html` <span class="muted">match your filters</span>` : ''}</p>
        <div class="active-filters">${active.map(([id, v]) => {
          const label = filters.find((f) => f.id === id)?.label ?? id;
          const text = Array.isArray(v) && typeof v[0] === 'string' ? v.map((x) => labelFor(id, x)).join(', ') : Array.isArray(v) ? rangeText(id, v) : v === true ? 'yes' : `${fmtNumber(v)}+`;
          return html`<button type="button" class="chip" data-clear="${id}" aria-label="Remove filter: ${label} ${text}">${label}: ${text} ${icon('close', { size: 12 })}</button>`;
        })}
          ${active.length ? html`<button type="button" class="btn btn--sm btn--ghost" data-reset>Reset all</button>` : ''}</div>
      </div>
      ${items.length === 0
        ? emptyState('No devices match these filters', 'Try removing a filter. Specs-only devices are hidden when “Independent test data” is ticked.', html`<button type="button" class="btn" data-reset>Reset filters</button>`)
        : view === 'table'
          ? resultsTable(visible, categoryId, Boolean(rankProfile))
          : html`<div class="grid grid-3">${visible.map(({ row }) => deviceCard(row))}</div>`}
      ${items.length > visible.length ? html`<div class="more-row"><button type="button" class="btn" data-more>Show ${Math.min(PAGE, items.length - visible.length)} more</button> <span class="tiny muted">Showing ${visible.length} of ${items.length}</span></div>` : ''}`);
    const q = writeState(state, { sort: sort !== 'newest' ? sort : undefined, view: view !== 'grid' && !rankProfile ? view : undefined, rank: rankProfile ?? undefined, cur: state.price ? selectedCurrency() : undefined });
    if (priceLink && state.price?.[0] === priceLink.shown[0] && state.price?.[1] === priceLink.shown[1]) {
      Object.assign(q, { priceMin: priceLink.priceMin, priceMax: priceLink.priceMax, cur: priceLink.cur });
    }
    setQuery(q);
  };

  return {
    title: profile ? `Best ${cat.name.toLowerCase()} ${profilePhrase(profile)}` : cat ? cat.name : 'All devices',
    html: html`<div class="browse">
      ${pageTrail(cat ? [{ label: 'Home', href: href('/') }, { label: 'Devices', href: href('/devices') }, { label: cat.name }] : [{ label: 'Home', href: href('/') }, { label: 'Devices' }])}
      <header class="browse__head">
        <div class="eyebrow">${rankProfile ? 'Platform ranking' : 'Device database'}</div>
        <h1>${profile ? `Best ${cat.name.toLowerCase()} ${profilePhrase(profile)}` : cat ? cat.name : 'All devices'}</h1>
        ${profile ? html`<p class="muted ranking-note">${provBadge('platform', { long: true })} ${profile.description} Scores combine the category scores with this use case's weights. Evidence that isn't recorded counts as typical for similar devices, and devices with less evidence show lower coverage. Devices not on sale yet are listed after the rest.${valueCurrency ? ` Value uses ${valueCurrency} launch prices; devices without one get no value score.` : ''} <a href="${href('/methodology', { section: 'scoring' })}">How it works</a></p>` : ''}
        <nav class="tabs" aria-label="Category">
          <a href="${href('/devices')}" aria-current="${!categoryId}">All <span class="tiny muted">${store.devices.length}</span></a>
          ${store.core.categories.map((c) => html`<a href="${href(`/devices/${c.id}`)}" aria-current="${c.id === categoryId}">${c.name} <span class="tiny muted">${store.core.build.counts.byCategory[c.id]}</span></a>`)}
        </nav>
      </header>
      <div class="browse__grid">
        <aside class="browse__side">
          <details class="filters-toggle" open>
            <summary><span class="row">${icon('filter', { size: 16 })} Filters</span></summary>
            ${filterPanel(filters, base, state)}
          </details>
        </aside>
        <div class="browse__main">
          <div class="browse__tools">
            ${rankProfile
              ? html`<div class="seg" role="group" aria-label="Use case">${store.core.scoring.profiles.map((p) => html`<a class="seg-link" href="${href(`/devices/${categoryId}`, { rank: p.id })}" aria-current="${p.id === rankProfile}">${p.label}</a>`)}</div>
                 <a class="btn btn--sm btn--ghost" href="${href(`/devices/${categoryId}`)}">Exit ranking</a>`
              : html`<label class="small">Sort <select data-sort>${SORTS.map(([v, l]) => html`<option value="${v}" ${v === sort ? 'selected' : ''}>${l}</option>`)}</select></label>
                 <div class="seg" role="group" aria-label="View"><button type="button" data-view="grid" aria-pressed="${view === 'grid'}">Cards</button><button type="button" data-view="table" aria-pressed="${view === 'table'}">Table</button></div>
                 ${categoryId ? html`<a class="btn btn--sm" href="${href(`/devices/${categoryId}`, { rank: 'balanced' })}">Rank by use case</a>` : ''}`}
          </div>
          <div data-results></div>
        </div>
      </div>
    </div>`,
    mount(root) {
      const form = root.querySelector('[data-filters]');
      renderResults(root);
      form?.addEventListener('change', () => {
        state = readForm(form, filters);
        renderResults(root);
      });
      form?.addEventListener('submit', (e) => e.preventDefault());
      root.querySelector('[data-sort]')?.addEventListener('change', (e) => {
        sort = e.target.value;
        renderResults(root);
      });
      root.querySelectorAll('[data-view]').forEach((b) =>
        b.addEventListener('click', () => {
          view = b.dataset.view;
          root.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          renderResults(root);
        }),
      );
      root.querySelector('[data-results]').addEventListener('click', (e) => {
        if (e.target.closest('[data-more]')) {
          const y = window.scrollY;
          limit += PAGE;
          renderResults(root, { more: true });
          window.scrollTo({ top: y });
          return;
        }
        const clear = e.target.closest('[data-clear]');
        if (clear) {
          delete state[clear.dataset.clear];
          form?.querySelectorAll(`[name="${clear.dataset.clear}"], [name="${clear.dataset.clear}Min"], [name="${clear.dataset.clear}Max"]`).forEach((el) => {
            if (el.type === 'checkbox') el.checked = false;
            else el.value = '';
          });
          renderResults(root);
        }
        if (e.target.closest('[data-reset]')) {
          state = {};
          form?.reset();
          form?.querySelectorAll('input[type="checkbox"]').forEach((el) => (el.checked = false));
          form?.querySelectorAll('input[type="number"], select').forEach((el) => (el.value = ''));
          renderResults(root);
        }
      });
      if (window.matchMedia('(max-width: 860px)').matches) root.querySelector('.filters-toggle')?.removeAttribute('open');
    },
  };
}
