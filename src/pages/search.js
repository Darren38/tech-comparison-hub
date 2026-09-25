// Search results page: grouped by type, with the detected intent offered first.

import { html } from '../lib/html.js';
import { plural } from '../lib/format.js';
import { store } from '../core/store.js';
import { href } from '../core/router.js';
import { bindSearchBox } from '../ui/layout.js';
import { icon, deviceCard, docCard, emptyState, sourceLink, tierBadge, pageTrail, extLink } from '../ui/components.js';
import { TOPIC_LABEL } from '../ui/autolinks.js';
import { search, groupResults } from '../engine/search.js';
import { parseIntent, describeIntent, intentHref } from '../engine/intent.js';

function group(g) {
  switch (g.type) {
    case 'device':
      return html`<div class="grid grid-3">${g.items.slice(0, 12).map((r) => deviceCard(store.deviceById.get(r.id)))}</div>`;
    case 'chipset':
      return html`<ul class="result-list">${g.items.map((r) => html`<li><a href="${href(`/chipset/${r.id}`)}"><strong>${r.title}</strong></a> <span class="small muted">${r.sub}</span></li>`)}</ul>`;
    case 'brand':
      return html`<div class="row">${g.items.map((r) => html`<a class="chip" href="${href(`/brand/${r.id}`)}">${r.title} <span class="tiny muted">${r.sub}</span></a>`)}</div>`;
    case 'source':
      return html`<ul class="result-list">${g.items.map((r) => html`<li>${sourceLink(r.id)} <span class="small muted">${r.sub}</span></li>`)}</ul>`;
    case 'page':
      return html`<ul class="result-list">${g.items.map((r) => html`<li><a href="${href(r.path, r.section ? { section: r.section } : undefined)}"><strong>${r.title}</strong></a> <span class="small muted">${r.sub}</span></li>`)}</ul>`;
    case 'headline':
      return html`<ul class="result-list">${g.items.slice(0, 20).map((r) => html`<li><span class="auto__topic auto__topic--${r.topic ?? 'news'} tiny">${TOPIC_LABEL[r.topic] ?? 'News'}</span> ${extLink(r.url, r.title)} <span class="small muted">${r.sub}</span></li>`)}</ul>
        <p class="tiny muted">Headlines are matched to devices automatically and are not checked by hand.</p>`;
    default:
      return html`<div class="grid grid-3">${g.items.slice(0, 9).map((r) => (store.docById.get(r.id) ? docCard(store.docById.get(r.id)) : ''))}</div>`;
  }
}

export default async function render({ query }) {
  const q = (query.q ?? '').trim();
  const [results, intent] = q ? await Promise.all([search(q, { limit: 80 }), parseIntent(q)]) : [[], { type: 'search' }];
  const groups = groupResults(results);
  const link = intent.type !== 'search' ? intentHref(intent, q) : null;
  return {
    title: q ? `Search: ${q}` : 'Search',
    html: html`<div class="stack-lg">
      ${pageTrail([{ label: 'Home', href: href('/') }, { label: q ? `Search: ${q}` : 'Search' }])}
      <header class="stack">
        <h1 class="sr-only">${q ? `Search results for “${q}”` : 'Search'}</h1>
        <div class="eyebrow" aria-hidden="true">Search</div>
        <form class="searchbox searchbox--hero" role="search" data-page-search>
          ${icon('search', { size: 22 })}
          <input type="search" name="q" value="${q}" placeholder="Anything: a device, chip, brand, headline, review, video, spec or a comparison…" autocomplete="off" aria-label="Search" />
          <button class="btn btn--primary" type="submit">Search</button>
        </form>
        ${link ? html`<a class="intent-banner" href="${link}">${icon('arrow', { size: 18 })}<span><span class="tiny muted">Looks like you want</span><br /><strong>${describeIntent(intent)}</strong></span></a>` : ''}
        ${q ? html`<p class="small muted">${plural(results.length, 'result')} for “${q}”${groups.length ? ` in ${groups.map((g) => g.label.toLowerCase()).join(', ')}` : ''}</p>` : ''}
      </header>
      ${!q
        ? emptyState('Search the hub', 'Type a device (“S26 Ultra”), a chip (“Dimensity 9500”), a brand, a reviewer, a headline topic (“iPhone 18 battery test”), a tech word (“LDAC”), or a comparison such as “OnePlus 15 vs Galaxy S26 Ultra for battery”.')
        : groups.length
          ? groups.map((g) => html`<section><h2 class="subhead">${g.label} <span class="tiny muted">${g.items.length}</span></h2>${group(g)}</section>`)
          : link
            ? ''
            : emptyState(`Nothing found for “${q}”`, 'Check the spelling, or try a shorter query such as the model number. Newer devices may not be in the database yet.', html`<a class="btn" href="${href('/devices')}">Browse all devices</a>`)}
      <p class="tiny faint">Sources in the registry: ${store.core.sources.filter((s) => s.type !== 'manufacturer').map((s) => html`${s.name} ${tierBadge(s.tier)} `)}</p>
    </div>`,
    mount(root) {
      bindSearchBox(root.querySelector('[data-page-search]'));
    },
  };
}
