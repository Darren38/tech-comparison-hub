// Chipset index: a sortable ladder of consensus benchmark values with confidence.

import { html, mount } from '../lib/html.js';
import { fmtMetric, fmtDate } from '../lib/format.js';
import { store, metricDef } from '../core/store.js';
import { href } from '../core/router.js';
import { confMeter, sectionHead, pageTrail } from '../ui/components.js';
import { miniMeter } from '../ui/charts.js';

const COLUMNS = ['gb6_single', 'gb6_multi', 'antutu_v11', 'wle', 'wle_stability'];
const LETTER = { h: 'high', m: 'medium', l: 'low' };

export default async function render({ query }) {
  let sortKey = COLUMNS.includes(query.sort) ? query.sort : 'gb6_multi';
  let tier = query.tier ?? 'all';
  const tiers = ['all', ...new Set(store.chipsets.map((c) => c.tier).filter(Boolean))];
  const stats = store.core.stats.chipset ?? {};

  const table = () => {
    const rows = store.chipsets
      .filter((c) => tier === 'all' || c.tier === tier)
      .sort((a, b) => (b.m[sortKey]?.[0] ?? -1) - (a.m[sortKey]?.[0] ?? -1));
    return html`<div class="table-wrap"><table class="data-table">
      <thead><tr>
        <th scope="col">Chipset</th><th scope="col">Process</th><th scope="col">CPU / GPU</th>
        ${COLUMNS.map((id) => html`<th scope="col" class="num" aria-sort="${id === sortKey ? 'descending' : 'none'}"><button type="button" class="th-sort" data-sort="${id}" title="${metricDef(id).name}">${metricDef(id).short}${id === sortKey ? ' ▼' : ''}</button></th>`)}
        <th scope="col" class="num">Devices</th>
      </tr></thead>
      <tbody>${rows.map((c) => html`<tr>
        <th scope="row"><a href="${href(`/chipset/${c.id}`)}">${c.name}</a><div class="tiny muted">${c.vendorName} · ${fmtDate(c.announced, 'month')}</div></th>
        <td class="small">${c.process ?? '—'}</td>
        <td class="small">${c.cores ? `${c.cores}-core` : '—'}<div class="tiny muted">${c.gpu ?? ''}</div></td>
        ${COLUMNS.map((id) => {
          const v = c.m[id];
          if (!v) return html`<td class="num faint">—</td>`;
          const max = stats[id]?.max;
          return html`<td class="num">${fmtMetric(metricDef(id), v[0])}<div class="row tiny" style="justify-content:flex-end">${max ? miniMeter((v[0] / max) * 100) : ''} ${confMeter(LETTER[v[1]], { label: false })}<span class="faint">${v[2]} src</span></div></td>`;
        })}
        <td class="num">${c.deviceCount}</td>
      </tr>`)}</tbody></table></div>`;
  };

  return {
    title: 'Chipsets',
    html: html`<div class="stack-lg">
      ${pageTrail([{ label: 'Home', href: href('/') }, { label: 'Chipsets' }])}
      <header>
        <div class="eyebrow">SoC database</div>
        <h1>Chipsets</h1>
        <p class="muted" style="margin-top:8px;max-width:70ch">Each value is the consensus (median) of independent sources: chip-level databases plus results measured on the phones that use the chip. The spread between phones on the same chip is shown on each chipset page, because cooling and tuning matter as much as the silicon.</p>
      </header>
      <section>
        ${sectionHead('Benchmark ladder', { right: html`<div class="seg" role="group" aria-label="Tier">${tiers.map((t) => html`<button type="button" data-tier="${t}" aria-pressed="${t === tier}">${t === 'all' ? 'All' : t}</button>`)}</div>` })}
        <div data-table>${table()}</div>
        <p class="tiny muted" style="margin-top:8px">“src” is the number of independent sources behind the consensus. AnTuTu v11 is shown because v10 and v11 totals cannot be compared.</p>
      </section>
    </div>`,
    mount(root) {
      const box = root.querySelector('[data-table]');
      root.addEventListener('click', (e) => {
        const s = e.target.closest('[data-sort]');
        const t = e.target.closest('[data-tier]');
        if (s) sortKey = s.dataset.sort;
        if (t) {
          tier = t.dataset.tier;
          root.querySelectorAll('[data-tier]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
        }
        if (s || t) mount(box, table());
      });
    },
  };
}
