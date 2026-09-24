// Source profile: who the source is, how it tests, its tier, and everything it contributed.

import { html } from '../lib/html.js';
import { plural } from '../lib/format.js';
import { store, loadSource } from '../core/store.js';
import { href } from '../core/router.js';
import { tierBadge, extLink, docCard, deviceCard, emptyState, sectionHead, tag, pageTrail } from '../ui/components.js';

export default async function render({ params }) {
  const [id] = params;
  if (!store.sourceById.has(id)) {
    const err = new Error(`No source with the id "${id}" is in the registry.`);
    err.status = 404;
    throw err;
  }
  const data = await loadSource(id);
  const s = data.source;
  const tier = store.core.taxonomy.sourceTiers.find((t) => t.id === s.tier);
  const specDevices = data.specDevices.map((d) => store.deviceById.get(d)).filter(Boolean);
  const chips = [...store.chipsetById.values()].filter((c) => c.vendor === id).sort((a, b) => a.name.localeCompare(b.name));
  return {
    title: s.name,
    html: html`<div class="stack-lg">
      <header>
        ${pageTrail([{ label: 'Home', href: href('/') }, { label: 'Methodology', href: href('/methodology') }, { label: 'Source registry', href: href('/methodology', { section: 'sources' }) }, { label: s.name }])}
        <div class="eyebrow" style="margin-top:10px">${s.type} ${s.status === 'planned' ? tag('planned', 'muted') : ''}</div>
        <h1 class="row">${s.name} ${tierBadge(s.tier)}</h1>
        <p class="muted" style="margin-top:6px">${tier?.label}: ${tier?.description}</p>
        ${s.url ? html`<p class="small" style="margin-top:6px">${extLink(s.url, s.url.replace(/^https?:\/\//, ''))}</p>` : ''}
      </header>
      <div class="grid grid-2">
        <section class="card small stack"><h3>Method</h3><p>${s.methodology ?? 'No methodology notes recorded.'}</p>${s.notes ? html`<p class="muted">${s.notes}</p>` : ''}</section>
        <section class="card"><h3>Contribution</h3>
          <dl class="kv">
            <div><dt>Documents</dt><dd class="num">${data.documents.length}</dd></div>
            <div><dt>Evidence records</dt><dd class="num">${data.recordCount}</dd></div>
            <div><dt>Default spec source for</dt><dd class="num">${plural(specDevices.length, 'device')}</dd></div>
          </dl>
        </section>
      </div>
      ${data.documents.length
        ? html`<section>${sectionHead('Documents', { eyebrow: plural(data.documents.length, 'document') })}<div class="grid grid-3">${data.documents.map((d) => docCard(d))}</div></section>`
        : s.status === 'planned'
          ? emptyState('No records yet', 'This source is registered so its data can be added with proper attribution. See the notes above.')
          : ''}
      ${specDevices.length ? html`<section>${sectionHead('Specification source for', { eyebrow: s.type === 'manufacturer' ? 'Official data' : 'From launch reports' })}<div class="grid grid-3">${specDevices.map((d) => deviceCard(d))}</div></section>` : ''}
      ${chips.length ? html`<section>${sectionHead(`${s.name} chipsets in the database`, { eyebrow: plural(chips.length, 'chipset') })}
        <ul class="chip-list">${chips.map((c) => html`<li><a class="chip" href="${href(`/chipset/${c.id}`)}">${c.name}</a></li>`)}</ul>
        <p class="tiny muted" style="margin-top:8px">Each chipset page lists the phones that use it and any benchmark results recorded for it.</p></section>` : ''}
      ${!data.documents.length && !specDevices.length && !chips.length && s.status !== 'planned'
        ? emptyState('Cited for individual values', 'This source is cited on specific values rather than whole documents. The badge next to a value names it; hover the badge for details.')
        : ''}
    </div>`,
  };
}
