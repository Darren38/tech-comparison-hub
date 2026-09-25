// Size view (Version 17): devices drawn side by side at the same scale from the makers' published height, width and
// thickness, each with its product picture inside the outline, dimension lines and weight. Optional bank card for scale,
// an overlay mode (outlines stacked on one corner) and an approximate real-size mode (CSS millimetres).
//
// The outline is the measurement. The picture is cropped to the product itself (tools/image_boxes.py) and fitted inside
// the outline without stretching, so a straight-on front view fills it; pictures of several devices or angles fit by
// width and look smaller.

import { html } from '../lib/html.js';
import { fmtNumber } from '../lib/format.js';
import { deviceTitle } from '../core/store.js';
import { t } from '../core/i18n.js';
import { fitCrop } from './components.js';

// ISO/IEC 7810 ID-1: every bank card, MyKad and driving licence has this size.
const CARD = { h: 53.98, w: 85.6, d: 0.76 };
const RADIUS_MM = { smartphone: 9, tablet: 11, smartwatch: 10, band: 8, earbuds: 14 };
const CSS_PX_PER_MM = 96 / 25.4;

/** The measured object for a device: the body, or for earbuds the charging case. */
export function measuresOf(device) {
  const b = device?.specs?.build ?? {};
  const earbuds = device?.category === 'earbuds';
  const dims = (earbuds ? b.case_dimensions : null) ?? b.dimensions;
  if (!dims?.height_mm || !dims?.width_mm) return null;
  return {
    h: dims.height_mm,
    w: dims.width_mm,
    d: dims.depth_mm ?? null,
    weight: earbuds ? b.case_weight_g ?? null : b.weight_g ?? null,
    budWeight: earbuds ? b.weight_g ?? null : null,
    what: earbuds && b.case_dimensions ? 'case' : 'body',
  };
}

const mm = (v, digits = 1) => `${fmtNumber(v, v % 1 ? digits : 0)} mm`;

function picture(image, m, category) {
  if (image.kind === 'photo') return html`<img src="${image.src}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-fallback-hide />`;
  const fit = image.fit;
  const deviceAr = m.w / m.h;
  // A row of phones (front and back, or several colours): every phone in it has the device's height, so scale the
  // picture to the outline's height and show the right-hand end, where makers put the front view.
  if (fit?.ar && fit.ar > deviceAr * 1.25 && fit.ar < 1.7 && category === 'smartphone' && !(fit.one && Math.abs(fit.oneAr / deviceAr - 1) < 0.2)) {
    const [x0, y0, x1, y1] = fit.box ?? [0, 0, 1, 1];
    const bh = y1 - y0;
    const natAr = (fit.ar * bh) / (x1 - x0); // width / height of the whole picture
    const H = 'calc(var(--h) * var(--k) * 1px)';
    const W = 'calc(var(--w) * var(--k) * 1px)';
    const imgH = `calc(${H} / ${bh.toFixed(4)})`;
    const style = `height:${imgH};width:calc(${imgH} * ${natAr.toFixed(4)});top:calc(${H} * ${(-y0 / bh).toFixed(4)});left:calc(${W} - ${imgH} * ${(natAr * x1).toFixed(4)})`;
    return html`<span class="fitcrop szv__pic szv__pic--row ${fit.bg === 'light' ? 'is-onwhite' : ''}"><img src="${image.src}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" style="${style}" data-fallback-hide /></span>`;
  }
  const crop = fitCrop(fit, 'one');
  const img = html`<img src="${image.src}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"${crop ? html` style="${crop.img}"` : ''} data-fallback-hide />`;
  return crop ? html`<span class="fitcrop szv__pic ${crop.light ? 'is-onwhite' : ''}" style="${crop.wrap}">${img}</span>` : img;
}

function item({ row, device, mark = '', image = true }) {
  let m = measuresOf(device);
  if (!m) return '';
  // tablet pictures are usually landscape: draw the tablet on its side then (same measurements, turned)
  if (device.category === 'tablet' && image && row?.image?.fit?.ar > 1.15 && m.h > m.w) m = { ...m, h: m.w, w: m.h, turned: true };
  const radius = RADIUS_MM[device.category] ?? 9;
  const src = image && row?.image?.src;
  const name = row ? deviceTitle(row) : device.name;
  const weight = m.what === 'case'
    ? [m.weight ? t('case {g} g', { g: fmtNumber(m.weight, 1) }) : '', m.budWeight ? t('each earbud {g} g', { g: fmtNumber(m.budWeight, 1) }) : ''].filter(Boolean).join(' · ')
    : m.weight ? `${fmtNumber(m.weight, m.weight % 1 ? 1 : 0)} g` : '';
  return html`<figure class="szv__item" style="--h:${m.h};--w:${m.w};--d:${m.d ?? 0};--r:${radius}">
    <div class="szv__fig">
      <span class="szv__vdim" aria-hidden="true"><span>${mm(m.h)}</span></span>
      <span class="szv__front" role="img" aria-label="${t('{name}: {h} tall, {w} wide', { name, h: mm(m.h), w: mm(m.w) })}">
        ${src ? picture(row.image, m, device.category) : ''}
      </span>
      ${m.d ? html`<span class="szv__side" title="${t('Thickness {d}', { d: mm(m.d, 2) })}" aria-hidden="true"></span>` : ''}
    </div>
    <span class="szv__hdim" aria-hidden="true"><span>${mm(m.w)}</span></span>
    <figcaption class="szv__cap">
      <span class="szv__name">${mark}${name}</span>
      <span class="tiny muted num">${[mm(m.turned ? m.w : m.h), mm(m.turned ? m.h : m.w), m.d ? mm(m.d, 2) : ''].filter(Boolean).join(' × ')}${m.what === 'case' ? ` (${t('charging case')})` : ''}</span>
      ${weight ? html`<span class="tiny muted num">${weight}</span>` : ''}
    </figcaption>
  </figure>`;
}

function cardItem() {
  return html`<figure class="szv__item szv__item--card" style="--h:${CARD.h};--w:${CARD.w};--d:${CARD.d};--r:3.2" data-szv-carditem>
    <div class="szv__fig">
      <span class="szv__vdim" aria-hidden="true"><span>${mm(CARD.h, 2)}</span></span>
      <span class="szv__front szv__front--card" role="img" aria-label="${t('Bank card for scale')}"><span class="tiny">${t('Bank card')}</span></span>
    </div>
    <span class="szv__hdim" aria-hidden="true"><span>${mm(CARD.w)}</span></span>
    <figcaption class="szv__cap"><span class="szv__name">${t('Bank card (for scale)')}</span><span class="tiny muted">${t('Same size as a MyKad')}</span></figcaption>
  </figure>`;
}

/**
 * @param entries [{ row, device, mark }] — row from the index (for the picture and name), device = full record (for dimensions)
 * @param opts.card show the bank card at first; opts.overlay offer the overlay switch (needs 2+ devices)
 */
export function sizeView(entries, { card = true, overlay = true } = {}) {
  const usable = entries.filter((e) => measuresOf(e.device));
  if (!usable.length) return '';
  const cases = usable.some((e) => measuresOf(e.device).what === 'case');
  return html`<div class="szv ${card ? 'has-card' : ''}" data-szv>
    <div class="szv__controls small">
      <label class="check"><input type="checkbox" data-szv-card ${card ? 'checked' : ''} /> ${t('Bank card for scale')}</label>
      ${overlay && usable.length > 1 ? html`<label class="check"><input type="checkbox" data-szv-overlay /> ${t('Overlay the outlines')}</label>` : ''}
      <label class="check"><input type="checkbox" data-szv-real /> ${t('Real size (approximate)')}</label>
    </div>
    <div class="szv__scroll"><div class="szv__stage" data-szv-stage>${usable.map(item)}${cardItem()}</div></div>
    ${usable.length > 1 ? html`<ul class="szv__legend tiny">${usable.map((e, i) => html`<li><i class="szv__swatch szv__swatch--${i + 1}" aria-hidden="true"></i>${e.row ? deviceTitle(e.row) : e.device.name}</li>`)}</ul>` : ''}
    <p class="tiny muted szv__note">${t('Outlines are drawn to the same scale from each maker’s published height, width and thickness (the narrow bar is the side view). The picture inside is only for recognition.')}${cases ? ` ${t('For earbuds the outline is the charging case.')}` : ''}
      <span data-szv-realnote hidden>${t('Real size depends on your screen: hold a bank card against it to check.')}</span></p>
  </div>`;
}

/** Scale the drawing to the space available (or to CSS millimetres in real-size mode). Returns a cleanup function. */
export function bindSize(root) {
  const cleanups = [];
  root.querySelectorAll('[data-szv]').forEach((box) => {
    const stage = box.querySelector('[data-szv-stage]');
    const scroll = box.querySelector('.szv__scroll');
    const fit = () => {
      const overlay = box.classList.contains('is-overlay');
      const real = box.classList.contains('is-real');
      const items = [...stage.querySelectorAll('.szv__item')].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const num = (el, v) => Number(el.style.getPropertyValue(v)) || 0;
      const maxH = Math.max(...items.map((el) => num(el, '--h')));
      const maxW = Math.max(...items.map((el) => num(el, '--w') + num(el, '--d')));
      const sumW = items.reduce((s, el) => s + num(el, '--w') + num(el, '--d'), 0);
      const avail = Math.max(200, scroll.clientWidth - 8);
      let k;
      if (real) k = CSS_PX_PER_MM;
      else if (overlay) k = Math.min((avail - 60) / maxW, 320 / maxH);
      else k = Math.min((avail - 40 - items.length * 48) / sumW, (items.length > 2 ? 260 : 220) / maxH);
      stage.style.setProperty('--k', Math.max(0.35, Math.min(k, 4)).toFixed(3));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(scroll);
    const on = (sel, cls) => box.querySelector(sel)?.addEventListener('change', (e) => {
      box.classList.toggle(cls, e.target.checked);
      if (cls === 'is-real') box.querySelector('[data-szv-realnote]').hidden = !e.target.checked;
      fit();
    });
    on('[data-szv-card]', 'has-card');
    on('[data-szv-overlay]', 'is-overlay');
    on('[data-szv-real]', 'is-real');
    box.querySelectorAll('img[data-fallback-hide]').forEach((img) => img.addEventListener('error', () => (img.closest('.fitcrop') ?? img).remove(), { once: true }));
    fit();
    cleanups.push(() => ro.disconnect());
  });
  return () => cleanups.forEach((f) => f());
}
