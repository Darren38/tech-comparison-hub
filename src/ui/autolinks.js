// Automatically matched headlines (Version 17): news, test reports, reviews and videos that name a device or chip,
// shown in the matching section of device, chipset and compare pages.
//
// Two collections are merged: the rolling archive the scheduled build keeps (live/archive.json, about 400 days, every
// item re-matched against the whole database on each run) and the newest headlines (this visit's live collection or
// live/headlines.json). Each item already carries the device ids, chip ids and a topic (test / review / video / software /
// price / issue / launch / news) worked out by tools/fetch_headlines.py or engine/collect.js. Nothing here is checked by
// hand, and the labels say so.

import { html, mount } from '../lib/html.js';
import { timeAgo } from '../lib/format.js';
import { store, sourceName, deviceTitle } from '../core/store.js';
import { href } from '../core/router.js';
import { extLink, cardThumb, thumbLink } from './components.js';
import { loadMatchedItems, isSafeUrl } from '../engine/live.js';
export { loadMatchedItems };
import { t } from '../core/i18n.js';

export const TOPIC_LABEL = {
  test: 'Test or benchmark', review: 'Review', video: 'Video', software: 'Software update', price: 'Price', issue: 'Problem report', launch: 'Launch', news: 'News',
};

// which topics each page section shows
export const SLOT_TOPICS = {
  test: ['test'],
  reviews: ['review', 'video'],
  news: ['launch', 'price', 'software', 'issue', 'news'],
  all: Object.keys(TOPIC_LABEL),
};

/** Items about any of the given devices or chips. */
export async function matchedItems({ devices = [], chipsets = [] } = {}) {
  const d = new Set(devices);
  const c = new Set(chipsets);
  return (await loadMatchedItems()).filter((i) => (i.devices ?? []).some((id) => d.has(id)) || (i.chipsets ?? []).some((id) => c.has(id)));
}

/** A hidden slot a page fills after it renders: data-auto names the SLOT_TOPICS group. */
export function autoSlot(slot, title, { limit = 6 } = {}) {
  return html`<div class="auto" data-auto="${slot}" data-limit="${limit}" hidden>
    <h3 class="subhead">${t(title)} <span class="tiny muted">${t('matched automatically from recent headlines · not checked by hand')}</span></h3>
    <ol class="fresh__list auto__list" data-auto-list></ol>
    <button type="button" class="btn btn--ghost btn--sm auto__more" data-auto-more hidden>${t('Show more')}</button>
  </div>`;
}

function itemHtml(i, { showDevices }) {
  const devs = showDevices ? (i.devices ?? []).map((id) => store.deviceById.get(id)).filter(Boolean).slice(0, 3) : [];
  return html`<li class="fresh__item">
    ${thumbLink(cardThumb({ image: isSafeUrl(i.image) ? i.image : null, url: i.url }, { allowDevice: false }), { url: i.url, title: i.title })}
    <div class="tiny muted"><span class="auto__topic auto__topic--${i.topic ?? 'news'}">${t(TOPIC_LABEL[i.topic] ?? 'News')}</span> · <a href="${href(`/source/${i.source}`)}">${sourceName(i.source)}</a>${i.published ? ` · ${timeAgo(i.published)}` : ''}</div>
    ${extLink(i.url, i.title, 'fresh__link')}
    ${devs.length ? html`<div class="tiny auto__devs">${devs.map((r) => html`<a href="${href(`/device/${r.id}`)}">${deviceTitle(r)}</a>`)}</div>` : ''}
  </li>`;
}

/** Fill every [data-auto] slot under root. Returns nothing; empty slots stay hidden. */
export async function fillAuto(root, { devices = [], chipsets = [], showDevices = false } = {}) {
  const slots = [...root.querySelectorAll('[data-auto]')];
  if (!slots.length) return;
  let items;
  try {
    items = await matchedItems({ devices, chipsets });
  } catch {
    return;
  }
  for (const slot of slots) {
    if (!slot.isConnected) continue;
    const topics = new Set(SLOT_TOPICS[slot.dataset.auto] ?? SLOT_TOPICS.all);
    const list = items.filter((i) => topics.has(i.topic ?? 'news'));
    if (!list.length) continue;
    const limit = Number(slot.dataset.limit) || 6;
    const target = slot.querySelector('[data-auto-list]');
    const draw = (n) => mount(target, html`${list.slice(0, n).map((i) => itemHtml(i, { showDevices }))}`);
    draw(limit);
    const more = slot.querySelector('[data-auto-more]');
    if (list.length > limit) {
      more.hidden = false;
      more.addEventListener('click', () => { draw(list.length); more.hidden = true; }, { once: true });
    }
    slot.hidden = false;
    // a section that only said "nothing linked yet" now has something: soften that message
    slot.closest('section')?.querySelector('.state--empty')?.classList.add('state--quiet');
  }
}
