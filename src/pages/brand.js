// Brand page: the brand, its sub-brands, its devices by category and the latest coverage.

import { html } from '../lib/html.js';
import { plural } from '../lib/format.js';
import { store } from '../core/store.js';
import { href } from '../core/router.js';
import { deviceCard, docCard, emptyState, extLink, sectionHead, pageTrail } from '../ui/components.js';

export default async function render({ params }) {
  const [id] = params;
  const brand = store.brandById.get(id);
  if (!brand) {
    const err = new Error(`No brand with the id "${id}" is in the database.`);
    err.status = 404;
    throw err;
  }
  const parent = brand.parent ? store.brandById.get(brand.parent) : null;
  const children = store.core.brands.filter((b) => b.parent === id);
  // A parent brand with no devices of its own (ZTE, nubia) shows its sub-brands' devices instead of an empty page.
  const descendants = (bid) => store.core.brands.filter((b) => b.parent === bid).flatMap((b) => [b.id, ...descendants(b.id)]);
  const own = store.devices.filter((d) => d.brand === id);
  const fromChildren = own.length ? [] : store.devices.filter((d) => descendants(id).includes(d.brand));
  const devices = own.length ? own : fromChildren;
  const ids = new Set(devices.map((d) => d.id));
  const ancestors = []; // folder path: Devices › ZTE › nubia › REDMAGIC
  for (let p = parent; p; p = p.parent ? store.brandById.get(p.parent) : null) ancestors.unshift(p);
  const crumbs = [{ label: 'Home', href: href('/') }, { label: 'Devices', href: href('/devices') },
    ...ancestors.map((b) => ({ label: b.name, href: href(`/brand/${b.id}`) })), { label: brand.name }];
  const docs = store.documents.filter((d) => (d.devices ?? []).some((x) => ids.has(x))).slice(0, 9);
  return {
    title: brand.name,
    html: html`<div class="stack-lg">
      <header>
        ${pageTrail(crumbs)}
        <div class="eyebrow" style="margin-top:10px">${brand.country ?? ''}${parent ? html` · part of <a href="${href(`/brand/${parent.id}`)}">${parent.name}</a>` : ''}</div>
        <h1 class="brand-title" style="--brand:${brand.color ?? 'var(--ink)'}">${brand.name}</h1>
        ${brand.description ? html`<p class="dhead__summary">${brand.description}</p>` : ''}
        <div class="row small" style="margin-top:8px">${brand.website ? extLink(brand.website, 'Official website') : ''}${children.map((c) => html`<a class="chip" href="${href(`/brand/${c.id}`)}">${c.name}</a>`)}</div>
      </header>
      ${fromChildren.length ? html`<p class="small muted">${brand.name} sells its phones under ${children.map((c, i) => html`${i ? ' and ' : ''}<a href="${href(`/brand/${c.id}`)}">${c.name}</a>`)}. ${fromChildren.length === 1 ? 'This is the one device' : `These are the ${plural(fromChildren.length, 'device')}`} from its brands in the database:</p>` : ''}
      ${devices.length
        ? store.core.categories.map((cat) => {
            const list = devices.filter((d) => d.category === cat.id);
            return list.length ? html`<section>${sectionHead(cat.name, { eyebrow: plural(list.length, 'device') })}<div class="grid grid-3">${list.map((d) => deviceCard(d))}</div></section>` : '';
          })
        : emptyState(`No ${brand.name} devices in the database yet`, children.length ? `See its sub-brands: ${children.map((c) => c.name).join(', ')}.` : 'Devices appear here once they are added to data/devices.')}
      ${docs.length ? html`<section>${sectionHead('Latest coverage', { eyebrow: 'Reviews, videos and news' })}<div class="grid grid-3">${docs.map((d) => docCard(d))}</div></section>` : ''}
    </div>`,
  };
}
