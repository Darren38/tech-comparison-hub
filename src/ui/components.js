// Shared presentational components. Each returns an html`` template.

import { html, raw } from '../lib/html.js';
import { fmtNumber, fmtMetric, fmtDate, plural, fmtViews } from '../lib/format.js';
import { store, brandName, sourceName, deviceTitle, metricDef } from '../core/store.js';
import { href } from '../core/router.js';
import { compareTray } from '../core/state.js';
import { previousPage } from '../core/trail.js';
import { dotPlot } from './charts.js';
import { displayPrice, priceText, priceExplanation, availabilityIn } from '../engine/money.js';

// ------------------------------------------------------------------ icons (inline SVG, currentColor)
const ICONS = {
  search: '<path d="M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.3 4.3-1.4 1.4-4.3-4.3A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z"/>',
  plus: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/>',
  check: '<path d="m9.5 16.2-4.2-4.2-1.4 1.4 5.6 5.6L21 7.5l-1.4-1.4z"/>',
  close: '<path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z"/>',
  arrow: '<path d="M13.2 5.3 19.9 12l-6.7 6.7-1.4-1.4 4.3-4.3H4v-2h12.1l-4.3-4.3z"/>',
  back: '<path d="M10.8 5.3 4.1 12l6.7 6.7 1.4-1.4L7.9 13H20v-2H7.9l4.3-4.3z"/>',
  external: '<path d="M14 4h6v6h-2V7.4l-7.3 7.3-1.4-1.4L16.6 6H14zM5 6h6v2H6v10h10v-5h2v7H4V6z"/>',
  sun: '<path d="M11 2h2v3h-2zm0 17h2v3h-2zM2 11h3v2H2zm17 0h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zm12.1 12.1 1.4-1.4 2.1 2.1-1.4 1.4zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1zm12.1-12.1 2.1-2.1 1.4 1.4-2.1 2.1zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/>',
  moon: '<path d="M20.3 14.6A8.5 8.5 0 0 1 9.4 3.7 8.5 8.5 0 1 0 20.3 14.6z"/>',
  menu: '<path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  spark: '<path d="M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5l-2.2-6.3L3.5 10l6.3-1.7zM19 15l1 2.6 2.6 1-2.6 1L19 22l-1-2.4-2.6-1 2.6-1z"/>',
  info: '<path d="M11 10h2v7h-2zm0-3h2v2h-2zM12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16z"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
  swap: '<path d="M7 7h11l-3-3 1.4-1.4L21.8 8l-5.4 5.4L15 12l3-3H7zm10 10H6l3 3-1.4 1.4L2.2 16l5.4-5.4L9 12l-3 3h11z"/>',
  copy: '<path d="M8 3h11v13h-2V5H8zM4 7h11v14H4zm2 2v10h7V9z"/>',
  download: '<path d="M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4 3.3 3.3zM4 19h16v2H4z"/>',
  refresh: '<path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z"/>',
  chat: '<path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v10h2v2l2.5-2H20V6zm3 3h10v2H7zm0 3h7v2H7z"/>',
};

export function icon(name, { size = 18, label } = {}) {
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return raw(`<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" ${a11y}>${ICONS[name] ?? ''}</svg>`);
}

// ------------------------------------------------------------------ page trail: Back button + folder path
/**
 * `crumbs` is the folder path to this page, parents first: [{ label, href }, …, { label }] (the last is this page).
 * The Back button returns to the page you actually came from (keeping your place there); when this is the first
 * page of the visit it goes up one folder instead.
 */
export function pageTrail(crumbs = []) {
  const prev = previousPage();
  const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null;
  const back = prev ? { href: prev.href, label: prev.title || 'previous page', history: true } : parent?.href ? { href: parent.href, label: parent.label } : null;
  const short = (s) => (s.length > 42 ? `${s.slice(0, 40)}…` : s);
  return html`<nav class="pagetrail" aria-label="Breadcrumb">
    ${back ? html`<a class="pagetrail__back" href="${back.href}" ${back.history ? html`data-history-back` : ''} title="${back.history ? 'Back to the page you came from' : 'Up one level'}">${icon('back', { size: 16 })}<span>Back to ${short(back.label)}</span></a>` : ''}
    <ol class="pagetrail__path">${crumbs.map((c, i) => html`<li>${c.href && i < crumbs.length - 1 ? html`<a href="${c.href}">${c.label}</a>` : html`<span aria-current="page">${c.label}</span>`}</li>`)}</ol>
    ${modeSwitch()}
  </nav>`;
}

/** Simple / Detailed view switch (Version 17). The current choice is marked by viewMode.apply(). */
/**
 * Version 19: a small label on every section that updates by itself, with how often ("every 3 hours", "daily",
 * "weekly"). The tooltip says the rest. Timings match .github/workflows/pages.yml.
 */
export function autoBadge(every, what = '') {
  return html`<span class="autobadge" title="${`Updates automatically ${every}${what ? ` (${what})` : ''}. No one has to update this part by hand.`}"><span class="autobadge__icon" aria-hidden="true">↻</span> Auto · ${every}</span>`;
}

export function modeSwitch() {
  return html`<div class="modeswitch" role="group" aria-label="View">
    <span class="modeswitch__label tiny muted">View</span>
    <button type="button" class="modeswitch__btn" data-mode-set="simple" aria-pressed="false" title="Plain words, fewer research details">Simple</button>
    <button type="button" class="modeswitch__btn" data-mode-set="detailed" aria-pressed="true" title="Every source, badge and table">Detailed</button>
  </div>`;
}

// ------------------------------------------------------------------ evidence badges
export function provBadge(cls, { long = false } = {}) {
  const def = store.classById.get(cls) ?? { label: cls, short: cls?.toUpperCase?.() ?? '?' };
  return html`<span class="prov prov--${cls}" title="${def.label}: ${def.description ?? ''}"><i aria-hidden="true"></i>${long ? def.label : def.short}<span class="sr-only"> (${def.label})</span></span>`;
}

const CONF_TEXT = { high: 'High', medium: 'Medium', low: 'Low' };
export function confMeter(level, { label = true, why = '' } = {}) {
  if (!level) return '';
  const bars = { high: 3, medium: 2, low: 1 }[level] ?? 1;
  return html`<span class="conf conf--${level}" title="${CONF_TEXT[level]} confidence${why ? `: ${why}` : ''}">
    <span class="conf__bars" aria-hidden="true">${[1, 2, 3].map((i) => html`<i class="${i <= bars ? 'on' : ''}"></i>`)}</span>${label ? html`<span class="conf__label">${CONF_TEXT[level]}</span>` : html`<span class="sr-only">${CONF_TEXT[level]} confidence</span>`}
  </span>`;
}

export function tierBadge(tier) {
  return tier ? html`<span class="tier tier--${tier}" title="Source tier ${tier}">${tier}</span>` : '';
}

export function sourceLink(id, { tier = true } = {}) {
  if (!id) return '';
  if (id === 'platform') return html`<span class="source-link">Platform analysis</span>`;
  const src = store.sourceById.get(id);
  if (!src) return html`<span class="source-link">${id}</span>`;
  return html`<a class="source-link" href="${href(`/source/${id}`)}">${src.name}${tier ? html` ${tierBadge(src.tier)}` : ''}</a>`;
}

// Only web addresses become links: a javascript: or data: address from a feed or a data file is shown as plain text.
const webUrl = (url) => /^https?:\/\//i.test(String(url ?? '').trim());

export function extLink(url, text, cls = '') {
  if (!url || !webUrl(url)) return html`<span class="${cls}">${text}</span>`;
  return html`<a class="ext ${cls}" href="${url}" target="_blank" rel="noopener noreferrer">${text}${icon('external', { size: 12 })}<span class="sr-only"> (opens in a new tab)</span></a>`;
}

export function statusBadge(status) {
  const labels = { released: 'On sale', 'pre-order': 'Pre-order', announced: 'Announced', rumored: 'Rumoured', discontinued: 'Discontinued' };
  return status && status !== 'released' ? html`<span class="status status--${status}">${labels[status] ?? status}</span>` : '';
}

export function tag(text, variant = '') {
  return html`<span class="tag ${variant ? `tag--${variant}` : ''}">${text}</span>`;
}

export function seriesMark(index) {
  return html`<span class="series series--${index + 1}" aria-hidden="true">${'ABCD'[index]}</span>`;
}

// ------------------------------------------------------------------ provenance of a spec field
export function provenanceFor(entity, path) {
  const prov = entity?.provenance ?? {};
  const fields = prov.fields ?? {};
  const parts = path.split('.');
  for (let end = parts.length; end > 0; end -= 1) {
    const key = parts.slice(0, end).join('.');
    if (fields[key]) return { ...(prov.default ?? {}), ...fields[key], overridden: true };
  }
  return { ...(prov.default ?? {}), overridden: false };
}

// ------------------------------------------------------------------ metric value with evidence drill-down
export function metricValue(def, summary, { compact = false } = {}) {
  if (!summary) return html`<span class="faint">No data</span>`;
  return html`<span class="mv">
    <strong class="num">${fmtMetric(def, summary.value)}</strong>
    ${summary.inherited ? html`<span class="tag tag--muted" title="${summary.why}">chipset</span>` : ''}
    ${compact ? '' : confMeter(summary.confidence, { label: false, why: summary.why })}
  </span>`;
}

/** Full evidence card for one metric: consensus, confidence, dot plot and every source record. */
export function evidenceBlock(def, summary, { title } = {}) {
  if (!summary) return '';
  const inherited = summary.inherited ? store.chipsetById.get(summary.inherited) : null;
  return html`<div class="evidence">
    <div class="evidence__head">
      <div>
        <div class="evidence__name">${title ?? def.name}</div>
        ${def.description ? html`<p class="tiny muted clamp-2" title="${def.description}">${def.description}</p>` : ''}
      </div>
      <div class="evidence__value">
        <span class="num">${fmtMetric(def, summary.value)}</span>
        ${confMeter(summary.confidence, { why: summary.why })}
      </div>
    </div>
    ${inherited
      ? html`<p class="evidence__why small">No test of this device yet. Showing the <a href="${href(`/chipset/${inherited.id}`)}">${inherited.name}</a> consensus as a stand-in. ${summary.why}</p>`
      : html`
        <p class="evidence__why small">${summary.n > 1 ? 'Consensus (median): ' : ''}${summary.why}.</p>
        ${summary.origins?.length > 1 ? dotPlot(summary, def) : ''}
        <details class="evidence__detail">
          <summary>${plural(summary.origins?.reduce((s, o) => s + o.records.length, 0) ?? 0, 'record')} from ${plural(summary.origins?.length ?? 0, 'source')}</summary>
          <ul class="records">${(summary.origins ?? []).map((o) => originRow(def, o))}</ul>
        </details>`}
    ${(summary.otherVariants ?? []).map((v) => otherVariantRow(def, v))}
    ${(summary.disputed ?? []).map((r) => disputedRow(def, r))}
  </div>`;
}

// A published result that contradicts every other test of the same hardware (Version 15): shown with the reason,
// never counted.
function disputedRow(def, r) {
  return html`<p class="evidence__disputed small">
    ${tag('Disputed', 'warn')} <span class="num">${fmtMetric(def, r.value)}</span>
    <span class="tiny muted">${sourceLink(r.source ?? r.origin)}${r.note ? html` · ${r.note.replace(/^Disputed: /, '')}` : ' · not counted in the value above'}</span>
  </p>`;
}

// A result for the same phone sold with a different chip (e.g. the Snapdragon Galaxy where the site records the
// Exynos model): shown for reference, counted for that chip only, never in this phone's value above.
function otherVariantRow(def, v) {
  return html`<details class="evidence__detail evidence__variant">
    <summary>
      ${tag(`${v.chipName} version`, 'warn')}
      <span class="num">${fmtMetric(def, v.value)}</span>
      <span class="tiny muted">tested on the <a href="${href(`/chipset/${v.chip}`)}">${v.chipName}</a> model, not the one this page describes; not counted in the value above</span>
    </summary>
    <ul class="records">${(v.origins ?? []).map((o) => originRow(def, o))}</ul>
  </details>`;
}

function originRow(def, origin) {
  return html`<li class="origin">
    <div class="origin__head">
      ${sourceLink(origin.origin)}
      ${provBadge(origin.class)}
      <span class="num origin__value">${fmtMetric(def, origin.value)}</span>
    </div>
    <ul class="origin__records">${origin.records.map((r) => recordRow(def, r))}</ul>
  </li>`;
}

export function recordRow(def, r) {
  const doc = r.spec ? null : store.docById.get(r.doc);
  const title = doc ? doc.title : 'Manufacturer specification';
  return html`<li>
    <span class="num">${fmtMetric(def, r.value)}</span>
    ${extLink(r.url ?? doc?.url, title, 'record__title')}
    <span class="faint tiny">${r.date ? `${r.dateApprox ? 'c. ' : ''}${fmtDate(r.date)}` : ''}</span>
    ${r.variant ? tag(r.variant, 'warn') : ''}
    ${(r.flags ?? []).map((f) => tag(f.replace('-', ' '), 'bad'))}
    ${r.excerpt ? html`<span class="tag tag--muted" title="Value taken from a search excerpt of the article and not yet re-read on the page">excerpt</span>` : ''}
    ${r.derived ? html`<span class="tag tag--platform" title="${r.derived.formula}: ${r.derived.inputs}">calculated</span>` : ''}
    ${r.note ? html`<span class="tiny muted">${r.note}</span>` : ''}
  </li>`;
}

// ------------------------------------------------------------------ device presentation
export function compareButton(id, { small = false } = {}) {
  const on = compareTray.has(id);
  return html`<button type="button" class="btn ${small ? 'btn--sm' : ''} btn--compare ${on ? 'is-on' : ''}" data-compare-toggle="${id}" aria-pressed="${on}">
    ${icon(on ? 'check' : 'plus', { size: 16 })}<span>${on ? 'Added' : 'Compare'}</span>
  </button>`;
}

export function deviceSpecLine(row) {
  const s = row.specs ?? {};
  const bits = [];
  if (s['display.size_in']) bits.push(`${fmtNumber(s['display.size_in'], 2)}″`);
  else if (s['display.size_mm']) bits.push(s['display.size_mm']);
  if (row.chipsetName) bits.push(row.chipsetName);
  if (s['battery.capacity_mah']) bits.push(`${fmtNumber(s['battery.capacity_mah'])} mAh`);
  else if (s['battery.capacity_wh']) bits.push(`${fmtNumber(s['battery.capacity_wh'], 1)} Wh`);
  else if (s['battery.life_h']) bits.push(`${fmtMetric({ format: 'life' }, s['battery.life_h'])} battery`);
  if (s['charging.wired_w']) bits.push(`${s['charging.wired_w']} W`);
  return bits.join(' · ');
}

/**
 * Price in the reader's chosen currency: a recorded local launch price, or a conversion marked "≈"
 * whose tooltip gives the source price, the rate and its date.
 */
export function priceTag(row, { currency, compact = false } = {}) {
  const dp = displayPrice(row, currency);
  const avail = availabilityIn(row, currency);
  // Why there is no local price ("not sold in MY") sits on its own line so it wraps instead of widening tables.
  const availLine = avail ? html`<span class="price-tag__avail">${avail.short}</span>` : '';
  if (!dp) return html`<span class="muted">${compact ? '—' : 'Price not recorded'}</span>${availLine}`;
  // The region is visible (not only in the tooltip, which touch screens never show):
  // "RM5,999 MY" is a Malaysian launch price, "≈ RM3,944 from CN" a conversion of the China one.
  const region = dp.basis.region ? (dp.local ? dp.basis.region : `from ${dp.basis.region}`) : '';
  const title = [priceExplanation(dp), avail ? `${avail.long}.` : ''].filter(Boolean).join(' ');
  const tag = html`<span class="price-tag num ${dp.local ? '' : 'is-converted'}" title="${title}">${priceText(dp)}</span>`;
  if (compact) {
    // Tables name the currency in the column header, so a local price needs no region; a conversion
    // shows where it came from (and any availability note) on a second line that wraps.
    const note = dp.local ? '' : [region, avail?.short].filter(Boolean).join(' · ');
    return html`${tag}${note ? html`<span class="price-tag__avail">${note}</span>` : ''}`;
  }
  return html`${tag}${region ? html`<span class="price-tag__region"> ${region}</span>` : ''}${dp.local ? '' : availLine}`;
}

export function deviceCard(row, { note } = {}) {
  return html`<article class="dcard">
    <a class="dcard__link" href="${href(`/device/${row.id}`)}" aria-label="${deviceTitle(row)}">
      <div class="dcard__art">${deviceMedia(row, { height: 92 })}</div>
      <div class="dcard__body">
        <div class="dcard__brand eyebrow">${brandName(row.brand)} ${statusBadge(row.status)}</div>
        <h3 class="dcard__name">${row.name}</h3>
        <p class="dcard__specs small muted">${deviceSpecLine(row)}</p>
        <div class="dcard__meta tiny">
          ${priceTag(row)}
          <span class="faint">·</span>
          <span class="${row.f?.hasTests ? '' : 'faint'}">${row.f?.hasTests ? plural(row.docCount, 'source') : 'Specs only'}</span>
        </div>
        ${note ? html`<p class="dcard__note tiny">${note}</p>` : ''}
      </div>
    </a>
    <div class="dcard__actions">${compareButton(row.id, { small: true })}</div>
  </article>`;
}

/**
 * Crop marks for a picture measured by tools/image_boxes.py: the product's rectangle inside the maker's canvas.
 * Returns the wrapper and picture styles that show only that rectangle (the file itself is not changed), or null.
 * which = 'box' (everything in the picture) or 'one' (the largest single device, when several stand apart).
 */
export function fitCrop(fit, which = 'box') {
  const box = which === 'one' && fit?.one ? fit.one : fit?.box;
  const ar = which === 'one' && fit?.one ? fit.oneAr : fit?.ar;
  if (!ar) return null;
  const [x0, y0, x1, y1] = box ?? [0, 0, 1, 1];
  const bw = x1 - x0;
  const bh = y1 - y0;
  const pct = (v) => `${(v * 100).toFixed(3)}%`;
  return {
    wrap: `--ar:${ar}`,
    img: `width:${pct(1 / bw)};height:${pct(1 / bh)};left:${pct(-x0 / bw)};top:${pct(-y0 / bh)}`,
    light: fit.bg === 'light',
  };
}

/**
 * The device's picture (a maker's product image or a freely licensed photo, shown from its owner's server), or its
 * to-scale outline when it has none. Makers' pictures are shown cropped to the product itself, so the device fills
 * the space instead of sitting small inside a white canvas. If the picture cannot load, main.js swaps in the outline.
 */
export function deviceMedia(row, { height = 92, size = 'card' } = {}) {
  const outline = schematic(row, { height, label: size === 'hero' });
  const image = row.image;
  if (!image?.src) return outline;
  const official = image.kind === 'official';
  const alt = `${official ? 'Product image' : image.kind === 'drawing' ? 'Drawing' : 'Photo'} of the ${deviceTitle(row)}`;
  const credit = official ? `Image: ${image.credit}` : [image.author, image.license].filter(Boolean).join(', ');
  const crop = image.kind !== 'photo' ? fitCrop(image.fit) : null;
  const kindClass = [official ? 'is-official' : image.kind === 'drawing' ? 'is-drawing' : '', crop ? 'is-fit' : '', crop?.light ? 'is-onwhite' : ''].join(' ');
  const img = html`<img class="dmedia__img" src="${image.src}" alt="${alt}"${crop ? html` style="${crop.img}"` : size === 'card' && image.focus ? html` style="object-position:${image.focus}"` : ''} loading="${size === 'hero' ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer" title="${credit ? `${alt}. ${credit}${official ? '' : ', Wikimedia Commons'}` : alt}" data-fallback />`;
  return html`<span class="dmedia dmedia--${size} ${kindClass}">
    ${crop ? html`<span class="fitcrop" style="${crop.wrap}">${img}</span>` : img}
    <span class="dmedia__fallback" hidden>${outline}</span>
  </span>`;
}

/** YouTube video id from a watch, shorts, embed or youtu.be link. */
export function youtubeId(url) {
  const m = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(url ?? '');
  return m ? m[1] : null;
}

/**
 * The picture for a headline, news or video card: the thumbnail the publisher put in its own feed, YouTube's
 * thumbnail for a video, or else the picture of the first device the item is about (so news and devices point
 * at each other). Pictures are shown from their owner's server, never copied. Returns null when there is none.
 */
export function cardThumb({ image, url, devices = [] }, { allowDevice = true } = {}) {
  const yt = youtubeId(url);
  if (image && /^https:\/\//.test(image)) return { src: image, kind: yt ? 'video' : 'publisher' };
  if (yt) return { src: `https://i.ytimg.com/vi/${yt}/mqdefault.jpg`, kind: 'video' };
  if (!allowDevice) return null;
  const dev = devices.map((id) => store.deviceById.get(id)).find((r) => r?.image?.src);
  return dev ? { src: dev.image.src, kind: 'device', device: dev } : null;
}

/** Card picture linking to the article (publisher / video thumbnails) or to the device page (device pictures). */
export function thumbLink(thumb, { url, title = '', size = 'card', placeholder = null } = {}) {
  // no picture: an optional tile with the publication's name keeps rows of cards aligned
  if (!thumb) return placeholder ? html`<span class="thumb thumb--${size} thumb--none" aria-hidden="true"><span>${placeholder}</span></span>` : '';
  // data-label: if the picture fails to load, main.js swaps in the same name tile
  if (!webUrl(thumb.src)) return '';
  const img = html`<img src="${thumb.src}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-thumb${placeholder ? html` data-label="${placeholder}"` : ''} />`;
  if (thumb.kind === 'device') {
    return html`<a class="thumb thumb--${size} thumb--device" href="${href(`/device/${thumb.device.id}`)}" title="${deviceTitle(thumb.device)} in this hub">
      ${img}<span class="thumb__label">${thumb.device.name}</span></a>`;
  }
  if (!webUrl(url)) return html`<span class="thumb thumb--${size} thumb--${thumb.kind}" aria-hidden="true">${img}</span>`;
  return html`<a class="thumb thumb--${size} thumb--${thumb.kind}" href="${url}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true" title="${title}">
    ${img}${thumb.kind === 'video' ? html`<span class="thumb__play">${icon('play', { size: size === 'mini' ? 12 : 18 })}</span>` : ''}</a>`;
}

/** Attribution line: the maker's page for official product images; author, licence and file page for Commons photos. */
export function photoCredit(image) {
  if (!image?.page) return '';
  if (image.kind === 'official') {
    return html`<p class="dmedia__credit tiny"><span>Product image: ${extLink(image.page, image.credit)}</span><span>© the manufacturer${image.auto ? ' · found automatically' : ''}</span></p>`;
  }
  return html`<p class="dmedia__credit tiny"><span>${image.kind === 'drawing' ? 'Drawing' : 'Photo'}: ${extLink(image.page, image.author ?? image.title ?? 'Wikimedia Commons')}</span>
    <span>${image.licenseUrl ? extLink(image.licenseUrl, image.license) : image.license} · Wikimedia Commons</span></p>`;
}

/**
 * To-scale outline of a device drawn from its recorded dimensions.
 * `pxPerMm` lets several schematics share one scale (size comparison).
 */
export function schematic(row, { height = 120, pxPerMm = null, label = false } = {}) {
  const category = row.category ?? row.device?.category;
  if (category === 'earbuds') return budsSchematic(row, { height, pxPerMm, label });
  const dims = row.specs?.['build.dimensions'] ?? row.specs?.build?.dimensions ?? null;
  const known = dims && dims.height_mm && dims.width_mm;
  let h = known ? dims.height_mm : category === 'tablet' ? 280 : category === 'smartwatch' ? 46 : category === 'band' ? 43 : 160;
  let w = known ? dims.width_mm : category === 'tablet' ? 210 : category === 'smartwatch' ? 42 : category === 'band' ? 24 : 75;
  const scale = pxPerMm ?? height / h;
  const W = Math.max(8, w * scale);
  const H = Math.max(8, h * scale);
  const wearable = category === 'smartwatch' || category === 'band';
  const radius = wearable ? Math.min(W, H) * 0.3 : Math.min(W, H) * (category === 'tablet' ? 0.05 : 0.13);
  const inset = wearable ? W * 0.12 : Math.max(2, W * 0.035);
  const color = store.brandById.get(row.brand ?? row.device?.brand)?.color ?? '#888';
  const title = known ? `${fmtNumber(h, 1)} × ${fmtNumber(w, 1)}${dims.depth_mm ? ` × ${fmtNumber(dims.depth_mm, 2)}` : ''} mm` : 'Dimensions not recorded (generic outline)';
  return raw(`<svg class="schematic ${known ? '' : 'is-generic'}" viewBox="0 0 ${W + 4} ${H + 4}" width="${W + 4}" height="${H + 4}" role="img" aria-label="${title}">
    <title>${title}</title>
    <rect x="2" y="2" width="${W}" height="${H}" rx="${radius}" class="schematic__body" style="--brand:${color}"/>
    <rect x="${2 + inset}" y="${2 + inset}" width="${Math.max(2, W - inset * 2)}" height="${Math.max(2, H - inset * 2)}" rx="${Math.max(1, radius - inset)}" class="schematic__screen"/>
    ${wearable ? '' : `<circle cx="${2 + W / 2}" cy="${2 + inset + Math.max(3, H * 0.025)}" r="${Math.max(1.2, W * 0.025)}" class="schematic__cam"/>`}
  </svg>${label ? `<span class="schematic__label tiny faint">${title}</span>` : ''}`);
}

/**
 * Earbuds: the charging case drawn to scale from its recorded size (the part you carry around), with the two
 * buds sketched inside. Falls back to a generic case outline when the maker gives no case size.
 */
function budsSchematic(row, { height = 120, pxPerMm = null, label = false } = {}) {
  const dims = row.specs?.['build.case_dimensions'] ?? row.specs?.build?.case_dimensions ?? null;
  const known = dims && dims.height_mm && dims.width_mm;
  // makers list case sizes largest side first; draw the case lying flat, wider than tall
  const a = known ? dims.height_mm : 60;
  const b = known ? dims.width_mm : 48;
  const w = Math.max(a, b);
  const h = Math.min(a, b);
  const scale = pxPerMm ?? height / h / 1.25;
  const W = Math.max(10, w * scale);
  const H = Math.max(8, h * scale);
  const color = store.brandById.get(row.brand ?? row.device?.brand)?.color ?? '#888';
  const r = Math.min(W, H) * 0.34;
  const lid = 2 + H * 0.36;
  const bud = (cx) => `<ellipse cx="${cx}" cy="${2 + H * 0.62}" rx="${W * 0.1}" ry="${H * 0.16}" class="schematic__screen"/>`;
  const title = known ? `Charging case ${fmtNumber(dims.height_mm, 1)} × ${fmtNumber(dims.width_mm, 1)}${dims.depth_mm ? ` × ${fmtNumber(dims.depth_mm, 2)}` : ''} mm` : 'Case size not recorded (generic outline)';
  return raw(`<svg class="schematic schematic--buds ${known ? '' : 'is-generic'}" viewBox="0 0 ${W + 4} ${H + 4}" width="${W + 4}" height="${H + 4}" role="img" aria-label="${title}">
    <title>${title}</title>
    <rect x="2" y="2" width="${W}" height="${H}" rx="${r}" class="schematic__body" style="--brand:${color}"/>
    <line x1="${2 + W * 0.06}" y1="${lid}" x2="${2 + W * 0.94}" y2="${lid}" class="schematic__lid"/>
    ${bud(2 + W * 0.33)}${bud(2 + W * 0.67)}
  </svg>${label ? `<span class="schematic__label tiny faint">${title}</span>` : ''}`);
}

// ------------------------------------------------------------------ spec value formatting
/** Value of a spec-sheet field: "display.size_in" reads device.specs; "@announced" reads the device record itself. */
export function specValue(device, key) {
  if (key.startsWith('@')) return device?.[key.slice(1)] ?? null;
  return key.split('.').reduce((o, k) => o?.[k], device?.specs);
}

/** Provenance path of a spec-sheet field ("specs.display.size_in", or "announced" for "@announced"). */
export const specPath = (key) => (key.startsWith('@') ? key.slice(1) : `specs.${key}`);

export function fmtSpec(field, value, entity) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return null;
  // claimed wearable battery life: "21 days" rather than "504 h"
  if (field.format === 'life' && typeof value === 'number') return fmtMetric({ format: 'life' }, value);
  switch (field.type) {
    case 'date':
      return fmtDate(value);
    case 'lines':
      return Array.isArray(value) ? html`<ul class="spec-lines">${value.map((v) => html`<li>${v}</li>`)}</ul>` : String(value);
    case 'number':
      return `${fmtNumber(value, field.digits ?? (value % 1 ? 1 : 0))}${field.unit ? (field.unit === 'x' ? '×' : ` ${field.unit}`) : ''}`;
    case 'bool':
      return value ? 'Yes' : 'No';
    case 'list':
      return Array.isArray(value) ? `${value.join(' / ')}${field.unit ? ` ${field.unit}` : ''}` : String(value);
    case 'storage':
      return (Array.isArray(value) ? value : [value]).map((gb) => (gb >= 1024 ? `${gb / 1024} TB` : `${gb} GB`)).join(' / ');
    case 'dimensions': {
      const dims = [['height', value.height_mm], ['width', value.width_mm], ['thickness', value.depth_mm]];
      const known = dims.filter(([, v]) => v);
      if (!known.length) return null;
      if (known.length === dims.length) return `${dims.map(([, v]) => fmtNumber(v, 2)).join(' × ')} mm`;
      // Partial record: name what is known instead of printing "? × ? × 8 mm".
      const text = known.map(([k, v]) => `${k} ${fmtNumber(v, 2)} mm`).join(', ');
      const missing = dims.filter(([, v]) => !v).map(([k]) => k).join(' and ');
      return `${text[0].toUpperCase()}${text.slice(1)} (${missing} not recorded)`;
    }
    case 'chipset': {
      const chip = store.chipsetById.get(value);
      return chip ? html`<a href="${href(`/chipset/${chip.id}`)}">${chip.name}</a>` : value;
    }
    case 'cameras':
      return Array.isArray(value) && value.length
        ? html`<ul class="cams">${value.map((c) => html`<li><strong>${c.mp ? `${fmtNumber(c.mp, 1)} MP` : 'MP not stated'}</strong> ${c.role}${c.zoom_x ? ` · ${c.zoom_x}×` : ''}${c.sensor ? ` · ${c.sensor}` : ''}${c.aperture ? ` · ${c.aperture}` : ''}${c.focal_mm ? ` · ${c.focal_mm} mm` : ''}${c.note ? html` <span class="muted">(${c.note})</span>` : ''}</li>`)}</ul>`
        : null;
    default:
      if (typeof value === 'boolean') return value ? 'Yes' : 'No';
      return String(value);
  }
}

/** Comparable numeric value of a spec field (max of lists, dimension-free). */
export function specNumeric(field, value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const nums = value.filter((v) => typeof v === 'number');
    return nums.length ? Math.max(...nums) : null;
  }
  return typeof value === 'number' ? value : null;
}

// ------------------------------------------------------------------ states
export function loadingState(label = 'Loading') {
  return html`<div class="state state--loading" role="status" aria-live="polite">
    <div class="skeleton skeleton--title"></div>
    <div class="skeleton"></div><div class="skeleton"></div><div class="skeleton skeleton--short"></div>
    <span class="sr-only">${label}…</span>
  </div>`;
}

/** `level: 1` when the state is the whole page (not found), so the page still has a main heading. */
export function emptyState(title, body, action, { level = 3 } = {}) {
  return html`<div class="state state--empty">
    <div class="state__mark" aria-hidden="true">∅</div>
    ${level === 1 ? html`<h1 class="state__title">${title}</h1>` : html`<h3>${title}</h3>`}
    ${body ? html`<p class="muted">${body}</p>` : ''}
    ${action ?? ''}
  </div>`;
}

export function errorState(error, { retry = true } = {}) {
  const offline = error?.status === undefined;
  return html`<div class="state state--error" role="alert">
    <div class="state__mark" aria-hidden="true">!</div>
    <h3>${error?.status === 404 ? 'Not found' : 'Something went wrong loading this page'}</h3>
    <p class="muted">${error?.message ?? 'Unknown error'}${offline ? ' If you opened index.html directly from disk, start the site with serve.py (see README).' : ''}</p>
    ${retry ? html`<button type="button" class="btn" data-action="reload">Try again</button>` : ''}
  </div>`;
}

export function sectionHead(title, { eyebrow, right, id, level = 2 } = {}) {
  const idAttr = id ? html` id="${id}"` : '';
  const heading = level === 2 ? html`<h2${idAttr}>${title}</h2>` : html`<h3${idAttr}>${title}</h3>`;
  return html`<header class="section-head">
    <div>${eyebrow ? html`<div class="eyebrow">${eyebrow}</div>` : ''}${heading}</div>
    ${right ? html`<div class="section-head__right">${right}</div>` : ''}
  </header>`;
}

// ------------------------------------------------------------------ in-page outline ("On this page")
/**
 * Section navigation for long pages: a sticky side rail on wide screens and a sticky, horizontally
 * scrolling bar on narrow ones. `items` is [[targetId, label], ...]; pair it with bindOutline().
 * `variant: 'bar'` keeps the horizontal bar at every width, for pages whose tables need the full width.
 */
export function pageOutline(items, { title = 'On this page', variant = 'rail' } = {}) {
  return html`<nav class="outline outline--${variant}" aria-label="${title}" data-outline>
    <p class="outline__title">${title}</p>
    <span class="outline__progress" aria-hidden="true"><span></span></span>
    <ol class="outline__list">${items.map(([id, label], i) => html`<li><a class="outline__link" href="#${id}" data-jump="${id}"><span class="outline__num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><span class="outline__label">${label}</span></a></li>`)}</ol>
  </nav>`;
}

/**
 * Scrollspy, smooth jumps and a reading-progress line for pageOutline(). Returns a cleanup function.
 * `stickySelector` names another sticky block below the header (Compare's device heads), so a section
 * counts as current only once it has scrolled out from under it.
 */
export function bindOutline(root, { stickySelector = null } = {}) {
  const nav = root.querySelector('[data-outline]');
  if (!nav) return () => {};
  const list = nav.querySelector('.outline__list');
  const bar = nav.querySelector('.outline__progress > span');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Sections that are not on this particular page (no key differences, no tests…) are left out.
  // Targets are looked up on every update because some panels re-render (custom weights on Compare).
  const entries = [...nav.querySelectorAll('[data-jump]')]
    .map((link) => ({ link, id: link.dataset.jump }))
    .filter(({ link, id }) => {
      const present = Boolean(document.getElementById(id));
      if (!present) link.closest('li').hidden = true;
      return present;
    });
  entries.forEach(({ link }, i) => (link.querySelector('.outline__num').textContent = String(i + 1).padStart(2, '0')));
  let active = -1;
  let frame = 0;

  const setActive = (index) => {
    if (index === active) return;
    active = index;
    entries.forEach(({ link }, i) => (i === index ? link.setAttribute('aria-current', 'location') : link.removeAttribute('aria-current')));
    const link = entries[index]?.link;
    if (!link) return;
    // Keep the current item visible inside the rail or bar without moving the page.
    if (list.scrollWidth > list.clientWidth + 1) {
      list.scrollTo({ left: link.offsetLeft - list.clientWidth / 2 + link.offsetWidth / 2, behavior: reduce ? 'auto' : 'smooth' });
    } else if (list.scrollHeight > list.clientHeight + 1) {
      list.scrollTo({ top: link.offsetTop - list.clientHeight / 2, behavior: reduce ? 'auto' : 'smooth' });
    }
  };

  let clicked = { index: -1, at: 0 };
  const update = () => {
    frame = 0;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (bar) bar.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 1})`;
    // Right after a click, keep the chosen item highlighted while the page scrolls to it.
    if (performance.now() - clicked.at < 1000) {
      setActive(clicked.index);
      return;
    }
    const stickyBottom = stickySelector ? document.querySelector(stickySelector)?.getBoundingClientRect().bottom ?? 0 : 0;
    const line = Math.max(window.innerHeight * 0.3, stickyBottom + 32);
    let index = 0;
    let best = -Infinity;
    entries.forEach(({ id }, i) => {
      const top = document.getElementById(id)?.getBoundingClientRect().top;
      // Sections side by side share a top edge: the first of them stays current.
      if (top !== undefined && top <= line && top > best + 4) {
        best = top;
        index = i;
      }
    });
    // If the section the reader picked shares that top edge, keep their choice.
    const pickedTop = clicked.index >= 0 ? document.getElementById(entries[clicked.index]?.id)?.getBoundingClientRect().top : undefined;
    if (pickedTop !== undefined && Math.abs(pickedTop - best) <= 4) index = clicked.index;
    if (max > 0 && window.scrollY >= max - 4) index = entries.length - 1;
    setActive(index);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  // In-page links must not change the route (hash routing), so scroll manually.
  const onClick = (e) => {
    const link = e.target.closest('[data-jump]');
    if (!link) return;
    e.preventDefault();
    clicked = { index: entries.findIndex((entry) => entry.link === link), at: performance.now() };
    setActive(clicked.index);
    document.getElementById(link.dataset.jump)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };
  nav.addEventListener('click', onClick);
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  update();
  return () => {
    nav.removeEventListener('click', onClick);
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    cancelAnimationFrame(frame);
  };
}

export function docCard(doc, { showSubjects = true, views = null } = {}) {
  const origin = doc.testedBy ?? doc.source;
  const isVideo = doc.kind === 'video';
  const subjects = showSubjects ? (doc.devices ?? []).map((id) => store.deviceById.get(id)).filter(Boolean).slice(0, 3) : [];
  const category = isVideo ? store.core.taxonomy.videoCategories.find((c) => c.id === doc.category)?.label : null;
  const newsType = store.core.taxonomy.newsTypes.find((t) => t.id === doc.type)?.label;
  // on a device's own page its picture would repeat the header, so only video thumbnails are shown there
  const thumb = cardThumb({ url: doc.url, devices: doc.devices ?? [] }, { allowDevice: showSubjects });
  return html`<article class="doc ${isVideo ? 'doc--video' : ''} ${thumb ? 'doc--thumb' : ''}">
    ${thumbLink(thumb, { url: doc.url, title: doc.title })}
    <div class="doc__meta tiny">
      ${isVideo ? html`<span class="doc__play">${icon('play', { size: 12 })} YouTube</span>` : ''}
      ${provBadge(doc.class)}
      ${category ? tag(category) : newsType ? tag(newsType) : ''}
      <span class="faint">${doc.published ? `${doc.publishedApprox ? 'c. ' : ''}${fmtDate(doc.published)}` : 'Date not recorded'}</span>
      ${views ? html`<span class="doc__views" title="${`YouTube view count, ${fmtDate(views[1]?.slice(0, 10))}`}">${fmtViews(views[0])}</span>` : ''}
    </div>
    <h3 class="doc__title">${extLink(doc.url, doc.title)}</h3>
    <div class="doc__source small">${sourceLink(origin)}${doc.testedBy ? html` <span class="faint">via</span> ${sourceLink(doc.source, { tier: false })}` : ''}</div>
    ${doc.summary ? html`<p class="small muted clamp-2">${doc.summary}</p>` : ''}
    <div class="doc__foot tiny">
      ${subjects.map((d) => html`<a class="chip" href="${href(`/device/${d.id}`)}">${d.name}</a>`)}
      ${extractionTag(doc)}
    </div>
  </article>`;
}

export function extractionTag(doc) {
  const map = {
    complete: ['Data extracted', 'good'],
    partial: ['Partly extracted', 'warn'],
    'metadata-only': ['Metadata only: findings pending', 'muted'],
  };
  const [text, variant] = map[doc.extraction] ?? [null, null];
  const records = doc.recordCount ? plural(doc.recordCount, 'record') : '';
  return text ? html`<span class="tag tag--${variant}" title="${doc.verified?.metadata ?? ''}">${text}${records ? ` · ${records}` : ''}</span>` : '';
}

export function findingItem(f, doc) {
  const stanceIcon = { positive: '+', negative: '−', neutral: '•' }[f.stance];
  return html`<li class="finding finding--${f.stance}">
    <span class="finding__mark" aria-label="${f.stance}">${stanceIcon}</span>
    <div>
      <p>${f.text}</p>
      <p class="tiny muted">${doc ? html`${sourceLink(doc.testedBy ?? doc.source, { tier: false })} · ${extLink(doc.url, doc.title)}` : ''}</p>
    </div>
  </li>`;
}

export function legend() {
  return html`<div class="legend small">
    ${store.core.taxonomy.evidenceClasses.map((c) => html`<span class="legend__item">${provBadge(c.id)} <span class="muted">${c.label}</span></span>`)}
    <span class="legend__item">${confMeter('high', { label: false })}<span class="muted">Confidence</span></span>
  </div>`;
}
