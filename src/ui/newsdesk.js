// News page sections (Version 18): Software updates (iOS and One UI), Service offers in Malaysia (Apple and Samsung) and
// Flagship chips. All of it updates by itself:
//   - live/official.json (tools/fetch_official.py, about every 6 hours): Apple's release table and developer releases feed,
//     Samsung's monthly security bulletin and Apple Malaysia's service programmes, read from their own pages;
//   - the headline archive and newest collection (tools/fetch_headlines.py every 3 hours, or a live Refresh), where each
//     headline carries flags: ios, oneui, problem, offer, chip.
// Headlines are matched automatically and not checked by hand, and the labels say so; official facts are labelled Official.

import { html, mount } from '../lib/html.js';
import { fmtDate as fmtDay, timeAgo } from '../lib/format.js';
import { store, sourceName, deviceTitle } from '../core/store.js';
import { href } from '../core/router.js';
import { extLink, cardThumb, thumbLink, autoBadge } from './components.js';
import { loadMatchedItems, isSafeUrl } from '../engine/live.js';
import { t } from '../core/i18n.js';

let officialPromise = null;
export function loadOfficial() {
  officialPromise ??= fetch(`live/official.json?t=${Math.floor(Date.now() / 600000)}`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return officialPromise;
}

// headline times are full ISO timestamps; the date formatter wants the day part
const fmtDate = (iso) => fmtDay(String(iso ?? '').slice(0, 10));
const has = (i, flag) => (i.flags ?? []).includes(flag);
const MY_SOURCES = new Set(['soyacincau', 'technave', 'zinggadget', 'malaymail', 'samsung-newsroom-my']);
const isMalaysian = (i) => MY_SOURCES.has(i.source) || /\bmalaysia|大马|马来西亚/i.test(i.title);
const OFFICIAL_SOURCES = new Set(['apple-newsroom', 'apple-developer', 'samsung-newsroom', 'samsung-newsroom-my', 'google-blog']);
const ONEUI_VERSION = /\bone ?ui ?(\d+(?:\.\d+)?)/i;
const ROLLOUT = /\b(?:rolling out|rolls? out|rollout|stable|now available|arriv\w*|gets?|getting|receiv\w*|begins?|starts?|update brings|lands?)\b|推送|正式版/i;
const BETA = /\bbeta\b|内测|公测/i;
const OTHER_OS = /\b(?:android \d+|hyperos|coloros|oxygenos|originos|magicos|harmonyos|funtouch|realme ui|wear os|pixel drop)\b|澎湃OS|鸿蒙|ColorOS|OriginOS|MagicOS/i;
const PHONE_WORDS = /\b(?:pixel|galaxy|xiaomi|redmi|poco|oppo|vivo|iqoo|honor|huawei|oneplus|realme|motorola|nothing|phones?|smartphones?|tablets?|watch)\b|手机|平板/i;

// Where in Malaysia an offer applies, when the title or (for official pages) the page itself names it.
export const MY_REGIONS = [
  ['East Malaysia', /\beast malaysia\b|malaysia timur|东马/i], ['West Malaysia', /\bwest malaysia\b|peninsular malaysia|semenanjung|西马/i],
  ['Sabah', /\bsabah\b|沙巴/i], ['Sarawak', /\bsarawak\b|砂拉越|砂州/i], ['Labuan', /\blabuan\b|纳闽/i],
  ['Johor', /\bjohor\b|柔佛/i], ['Kedah', /\bkedah\b|吉打/i], ['Kelantan', /\bkelantan\b|吉兰丹/i], ['Melaka', /\bmelaka\b|\bmalacca\b|马六甲/i],
  ['Negeri Sembilan', /\bnegeri sembilan\b|森美兰/i], ['Pahang', /\bpahang\b|彭亨/i], ['Penang', /\bpenang\b|pulau pinang|槟城/i], ['Perak', /\bperak\b|霹雳/i],
  ['Perlis', /\bperlis\b|玻璃市/i], ['Selangor', /\bselangor\b|雪兰莪/i], ['Terengganu', /\bterengganu\b|登嘉楼/i],
  ['Kuala Lumpur', /\bkuala lumpur\b|\bKL\b|吉隆坡/], ['Putrajaya', /\bputrajaya\b|布城/i], ['Klang Valley', /\bklang valley\b|巴生谷/i],
];
export const regionsIn = (text) => MY_REGIONS.filter(([, re]) => re.test(text ?? '')).map(([name]) => name);

function regionTags(regions, { official = false } = {}) {
  return regions?.length
    ? html`<span class="desk__regions">${regions.map((r) => html`<span class="auto__topic auto__topic--region">${t(r)}</span>`)}</span>`
    : html`<span class="tiny muted">${t(official ? 'No region named on the page' : 'Region not stated in the headline')}</span>`;
}

// ------------------------------------------------------------------ shared list

function row(i, { showDevices = true, regions = null } = {}) {
  const devs = showDevices ? (i.devices ?? []).map((id) => store.deviceById.get(id)).filter(Boolean).slice(0, 3) : [];
  const chips = (i.chipsets ?? []).map((id) => store.chipsetById.get(id)).filter(Boolean).slice(0, 2);
  const tags = [
    OFFICIAL_SOURCES.has(i.source) ? html`<span class="auto__topic auto__topic--official">${t('Official')}</span>` : '',
    has(i, 'problem') ? html`<span class="auto__topic auto__topic--issue">${t('Problem reported')}</span>` : '',
    has(i, 'offer') ? html`<span class="auto__topic auto__topic--price">${t('Offer')}</span>` : '',
    i.kind === 'video' ? html`<span class="auto__topic auto__topic--video">${t('Video')}</span>` : '',
    BETA.test(i.title) ? html`<span class="auto__topic">${t('Beta')}</span>` : '',
  ].filter(Boolean);
  return html`<li class="fresh__item">
    ${thumbLink(cardThumb({ image: isSafeUrl(i.image) ? i.image : null, url: i.url }, { allowDevice: false }), { url: i.url, title: i.title })}
    <div class="tiny muted">${tags.length ? html`${tags} · ` : ''}<a href="${href(`/source/${i.source}`)}">${sourceName(i.source)}</a>${i.lang === 'zh' ? ` · ${t('In Chinese')}` : ''}${i.published ? html` · <time datetime="${i.published}">${timeAgo(i.published)}</time>` : ''}</div>
    ${extLink(i.url, i.title, 'fresh__link')}
    ${regions ? html`<div class="tiny">${regions}</div>` : ''}
    ${devs.length || chips.length ? html`<div class="tiny auto__devs">${devs.map((r) => html`<a href="${href(`/device/${r.id}`)}">${deviceTitle(r)}</a>`)}${chips.map((c) => html`<a href="${href(`/chipset/${c.id}`)}">${c.name}</a>`)}</div>` : ''}
  </li>`;
}

/** A filterable, "show more" list of headlines inside `box`. */
function drawList(box, items, { page = 10, empty = 'Nothing recent.', rowOpts = () => ({}) } = {}) {
  let shown = page;
  const draw = () => {
    mount(box, items.length
      ? html`<ol class="fresh__list desk__list">${items.slice(0, shown).map((i) => row(i, rowOpts(i)))}</ol>
        ${items.length > shown ? html`<button type="button" class="btn btn--ghost btn--sm auto__more" data-desk-more>${t('Show more')} (${items.length - shown})</button>` : ''}`
      : html`<p class="small muted desk__empty">${t(empty)}</p>`);
    box.querySelector('[data-desk-more]')?.addEventListener('click', () => { shown += page; draw(); });
  };
  draw();
}

function segButtons(name, options, current) {
  return html`<div class="seg seg--sm" role="group" aria-label="${t(name)}">${options.map(([id, label]) =>
    html`<button type="button" class="seg__btn ${id === current ? 'is-on' : ''}" aria-pressed="${id === current}" data-desk-filter="${id}">${t(label)}</button>`)}</div>`;
}

function wireSeg(root, onPick) {
  root.querySelectorAll('[data-desk-filter]').forEach((b) => b.addEventListener('click', () => {
    root.querySelectorAll('[data-desk-filter]').forEach((x) => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    onPick(b.dataset.deskFilter);
  }));
}

const auto = () => html`<span class="tiny muted">${t('matched automatically from headlines · not checked by hand')}</span> ${autoBadge('every 3 hours', 'with the headlines')}`;
const officialNote = (o) => html`<span class="tiny muted">${t('Official')} · ${t('read automatically from the maker’s own page')}${o?.updatedAt ? html` · ${t('checked')} ${timeAgo(o.updatedAt)}` : ''}</span> ${autoBadge('every 6 hours', 'from Apple’s and Samsung’s own pages')}`;

// ------------------------------------------------------------------ Software updates

/** One UI rollout, worked out from headlines: the newest stable version, which phones were reported first and Malaysia. */
export function oneUiRollout(items) {
  const reports = [];
  for (const i of items) {
    if (!has(i, 'oneui') || BETA.test(i.title) || !ROLLOUT.test(i.title)) continue;
    const m = ONEUI_VERSION.exec(i.title);
    if (!m || !i.published) continue;
    reports.push({ item: i, version: m[1].replace(/\.0$/, ''), major: parseFloat(m[1]) });
  }
  if (!reports.length) return null;
  const top = Math.max(...reports.map((r) => Math.floor(r.major)));
  const mine = reports.filter((r) => Math.floor(r.major) === top).sort((a, b) => a.item.published.localeCompare(b.item.published));
  const firstBy = new Map();
  for (const r of mine) for (const id of r.item.devices ?? []) if (!firstBy.has(id) && store.deviceById.get(id)) firstBy.set(id, r.item);
  const official = mine.find((r) => r.item.source.startsWith('samsung-newsroom'));
  const malaysia = mine.find((r) => isMalaysian(r.item));
  return { version: String(top), first: mine[0].item, official: official?.item, malaysia: malaysia?.item, devices: [...firstBy.entries()] };
}

function iosCard(o) {
  const rel = (o?.appleReleases ?? []).filter((r) => r.os === 'iOS');
  const latest = rel[0];
  const older = rel.find((r) => latest && r.version.split('.')[0] !== latest.version.split('.')[0]);
  const beta = (o?.appleBetas ?? []).find((b) => b.os === 'iOS' && b.stage !== 'release');
  const watch = (o?.appleReleases ?? []).find((r) => r.os === 'watchOS');
  if (!latest) return '';
  return html`<article class="card desk__card">
    <div class="eyebrow">${t('Apple · iPhone and iPad')}</div>
    <h3 class="desk__big">iOS ${latest.version}</h3>
    <p class="small">${t('Latest release')}: <strong>${fmtDate(latest.date)}</strong> · ${extLink(latest.url, t('Apple’s notes'))}</p>
    ${older ? html`<p class="small muted">${t('Staying on the previous version')}: iOS ${older.version} (${fmtDate(older.date)})</p>` : ''}
    ${beta ? html`<p class="small muted">${t('Newest beta')}: iOS ${beta.version} ${beta.stage} (${beta.build}), ${fmtDate(beta.date)}</p>` : ''}
    ${watch ? html`<p class="small muted">Apple Watch: watchOS ${watch.version} (${fmtDate(watch.date)})</p>` : ''}
    <p class="tiny muted desk__foot">${t('iOS updates reach every supported iPhone in Malaysia on the same day as elsewhere.')}</p>
    ${officialNote(o)}
  </article>`;
}

function oneUiCard(o, rollout) {
  const smr = o?.samsungSecurity;
  if (!rollout && !smr) return '';
  return html`<article class="card desk__card">
    <div class="eyebrow">${t('Samsung · Galaxy')}</div>
    ${rollout ? html`<h3 class="desk__big">One UI ${rollout.version}</h3>
      <p class="small">${t('Stable rollout first reported')}: <strong>${fmtDate(rollout.first.published)}</strong> · ${extLink(rollout.first.url, sourceName(rollout.first.source))}</p>
      ${rollout.official ? html`<p class="small muted">${t('Samsung announced the rollout')}: ${extLink(rollout.official.url, fmtDate(rollout.official.published))}</p>` : ''}
      <p class="small desk__my"><strong>${t('Malaysia')}:</strong> ${rollout.malaysia
        ? html`${t('reported')} ${fmtDate(rollout.malaysia.published)} · ${extLink(rollout.malaysia.url, sourceName(rollout.malaysia.source))}`
        : t('no Malaysian rollout report yet. It usually follows within days to weeks of the first countries; check Settings › Software update on the phone.')}</p>`
      : ''}
    ${smr ? html`<p class="small muted">${t('Latest monthly security update')}: <strong>${smr.release}</strong>${smr.samsungFixes ? ` · ${smr.samsungFixes} ${t('Samsung fixes')}` : ''} · ${extLink(smr.url, t('Samsung’s bulletin'))}</p>` : ''}
    ${rollout ? auto() : officialNote(o)}
  </article>`;
}

function rolloutTable(rollout) {
  if (!rollout?.devices.length) return '';
  return html`<section class="desk__block">
    <h3 class="subhead">${t('Which Galaxy phones got One UI {v} first', { v: rollout.version })} ${auto()}</h3>
    <ol class="desk__rollout">${rollout.devices.slice(0, 16).map(([id, item], n) => {
      const d = store.deviceById.get(id);
      return html`<li><span class="num tiny muted">${n + 1}</span> <a href="${href(`/device/${id}`)}">${deviceTitle(d)}</a> <span class="tiny muted">${fmtDate(item.published)} · ${extLink(item.url, sourceName(item.source))}${isMalaysian(item) ? html` · <strong>${t('Malaysia')}</strong>` : ''}</span></li>`;
    })}</ol>
    <p class="tiny muted">${t('The date a publication first reported the stable update for that phone (any country). Your phone may get it later: Samsung rolls out by country and carrier.')}</p>
  </section>`;
}

export function softwareSection() {
  return html`<div class="desk" data-desk="software">
    <div class="desk__cards" data-sw-cards><div class="skeleton"></div></div>
    <div data-sw-rollout></div>
    <section class="desk__block">
      <div class="desk__bar">
        <h3 class="subhead">${t('Software update news')} ${auto()}</h3>
        <div class="row">${segButtons('Platform', [['all', 'All'], ['ios', 'iOS'], ['oneui', 'One UI'], ['other', 'Other Android']], 'all')}
          <label class="check small"><input type="checkbox" data-sw-problems /> ${t('Only reported problems')}</label></div>
      </div>
      <div data-sw-list><div class="skeleton"></div></div>
    </section>
  </div>`;
}

export async function fillSoftware(root) {
  const box = root.querySelector('[data-desk="software"]');
  if (!box) return;
  const [official, all] = await Promise.all([loadOfficial(), loadMatchedItems().catch(() => [])]);
  if (!box.isConnected) return;
  // iOS and One UI by their flags; other systems only when a phone OS is named and the headline is about phones
  const software = all.filter((i) => has(i, 'ios') || has(i, 'oneui') || (i.topic === 'software' && OTHER_OS.test(i.title) && ((i.devices ?? []).length || PHONE_WORDS.test(i.title))));
  const rollout = oneUiRollout(all);
  mount(box.querySelector('[data-sw-cards]'), html`${iosCard(official)}${oneUiCard(official, rollout)}`);
  mount(box.querySelector('[data-sw-rollout]'), rolloutTable(rollout));
  let platform = 'all';
  const problems = box.querySelector('[data-sw-problems]');
  const draw = () => drawList(box.querySelector('[data-sw-list]'), software.filter((i) =>
    (platform === 'all' || (platform === 'other' ? !has(i, 'ios') && !has(i, 'oneui') : has(i, platform))) && (!problems.checked || has(i, 'problem'))),
  { empty: problems.checked ? 'No reported problems in recent headlines.' : 'No software-update headlines yet.' });
  wireSeg(box, (p) => { platform = p; draw(); });
  problems.addEventListener('change', draw);
  draw();
}

// ------------------------------------------------------------------ Service offers in Malaysia (Apple and Samsung)

export function offersSection({ brand = null } = {}) {
  return html`<div class="desk" data-desk="offers" data-brand="${brand ?? ''}">
    <p class="small muted desk__intro">${t('Free or discounted repairs, replacement and extended-repair programmes and recalls from Apple and Samsung that apply in Malaysia. Always confirm eligibility with an authorised service centre before going.')}</p>
    <div data-offers-apple></div>
    <div data-offers-samsung></div>
    <section class="desk__block">
      <h3 class="subhead">${t('Reported in the news')} ${auto()}</h3>
      <div data-offers-list><div class="skeleton"></div></div>
    </section>
  </div>`;
}

export async function fillOffers(root) {
  const box = root.querySelector('[data-desk="offers"]');
  if (!box) return;
  const brand = box.dataset.brand || null;
  const [official, all] = await Promise.all([loadOfficial(), loadMatchedItems().catch(() => [])]);
  if (!box.isConnected) return;
  const programs = official?.appleServicePrograms ?? [];
  if (brand !== 'samsung') {
    mount(box.querySelector('[data-offers-apple]'), programs.length ? html`<section class="desk__block">
      <h3 class="subhead">${t('Apple service programmes in Malaysia')} ${officialNote(official)}</h3>
      <ul class="desk__programs">${programs.map((p) => html`<li>${p.kind === 'recall' ? html`<span class="auto__topic auto__topic--issue">${t('Recall')}</span> ` : ''}${extLink(p.url, p.title)} ${regionTags(p.regions, { official: true })}${(p.devices ?? []).map((id) => store.deviceById.get(id)).filter(Boolean).map((d) => html` <a class="chip" href="${href(`/device/${d.id}`)}">${d.name}</a>`)}</li>`)}</ul>
      <p class="tiny muted">${t('From Apple Malaysia’s own list of current programmes, which covers every Apple product. Each page says which models and serial numbers qualify.')}</p>
    </section>` : '');
  }
  // Version 19: Samsung Malaysia publishes no list of programmes, so the pages where it would announce one are watched
  const pages = official?.samsungServicePages ?? [];
  if (brand !== 'apple' && pages.length) {
    mount(box.querySelector('[data-offers-samsung]'), html`<section class="desk__block">
      <h3 class="subhead">${t('Samsung Malaysia service pages')} ${officialNote(official)}</h3>
      <ul class="desk__programs">${pages.map((pg) => html`<li>${extLink(pg.url, pg.title)}
        ${pg.offers?.length
          ? html`${pg.offers.map((o) => html` <span class="auto__topic auto__topic--price">${t(`Mentions: ${o}`)}</span>`)}${pg.dates?.length ? html` <span class="tiny muted">${t('Dates on the page')}: ${pg.dates.join(', ')}</span>` : ''} ${regionTags(pg.regions, { official: true })}`
          : html` <span class="tiny muted">${t('No free or discounted offer on the page right now')}</span>`}
        <span class="tiny muted desk__watch">${pg.changed ? html`${t('Page last changed')}: ${fmtDate(pg.changed)}` : html`${t('Watched since')} ${fmtDate(pg.watchedSince)}`}</span></li>`)}</ul>
      <p class="tiny muted">${t('Samsung Malaysia doesn’t publish a list of service programmes, so the site reads the pages where it would announce one and flags any free, discount, promotion or extended-warranty wording, with any dates and the part of Malaysia it names.')}</p>
    </section>`);
  }
  const brandRe = brand === 'apple' ? /\b(?:apple|iphone|ipad|airpods|apple watch)\b|苹果/i : brand === 'samsung' ? /\b(?:samsung|galaxy)\b|三星/i : null;
  const offers = all.filter((i) => has(i, 'offer') && (!brandRe || brandRe.test(i.title)));
  const pageRegions = official?.offerPageRegions ?? {};
  drawList(box.querySelector('[data-offers-list]'), offers, {
    rowOpts: (i) => ({ regions: pageRegions[i.url] ? regionTags(pageRegions[i.url], { official: true }) : regionTags(regionsIn(i.title)) }),
    empty: 'No Apple or Samsung service offers for Malaysia in recent headlines. New ones appear here automatically.',
  });
}

// ------------------------------------------------------------------ Flagship chips

const CHIP_FAMILIES = [
  ['snapdragon', 'Snapdragon', /snapdragon|骁龙/i],
  ['apple', 'Apple', /\bapple [am]\d|\b[am]\d{2} (?:pro|bionic|max|ultra)\b/i],
  ['mediatek', 'Dimensity', /dimensity|天玑/i],
  ['exynos', 'Exynos', /exynos/i],
  ['other', 'Tensor, Kirin, XRING', /tensor|kirin|麒麟|xring|玄戒/i],
];
// Snapdragon Sound (audio), Snapdragon X (PCs), Snapdragon AR/XR and cars are not phone flagship chips
const NOT_PHONE_CHIP = /snapdragon (?:sound|x\d?\b|x elite|x plus|ar\d|xr\d|ride|cockpit|auto|w5)|surface (?:pro|laptop)/i;
const VENDOR_FAMILY = { qualcomm: 'snapdragon', apple: 'apple', mediatek: 'mediatek', samsung: 'exynos', google: 'other', hisilicon: 'other', xiaomi: 'other' };

function familiesOf(i) {
  const out = new Set(CHIP_FAMILIES.filter(([, , re]) => re.test(i.title)).map(([id]) => id));
  for (const id of i.chipsets ?? []) {
    const c = store.chipsetById.get(id);
    if (c?.tier === 'flagship' && VENDOR_FAMILY[c.vendor]) out.add(VENDOR_FAMILY[c.vendor]);
  }
  return out;
}

export function chipsSection() {
  return html`<div class="desk" data-desk="chips">
    <p class="small muted desk__intro">${t('News and videos about the flagship chips: Snapdragon 8, Apple A and M, MediaTek Dimensity 9000-series, Exynos 2000-series, Google Tensor, HUAWEI Kirin 9000-series and Xiaomi XRING.')} <a href="${href('/chipsets')}">${t('Compare the chips')} →</a></p>
    <section class="desk__block">
      <div class="desk__bar"><h3 class="subhead">${t('Latest')} ${auto()}</h3>
        <div class="row">${segButtons('Chip maker', [['all', 'All'], ...CHIP_FAMILIES.map(([id, label]) => [id, label])], 'all')}
          <label class="check small"><input type="checkbox" data-chip-videos /> ${t('Videos only')}</label></div></div>
      <div data-chip-list><div class="skeleton"></div></div>
    </section>
  </div>`;
}

export async function fillChips(root) {
  const box = root.querySelector('[data-desk="chips"]');
  if (!box) return;
  const all = await loadMatchedItems().catch(() => []);
  if (!box.isConnected) return;
  // only headlines about a flagship chip: the collector's chip flag, or a chip in the hub whose tier is flagship
  const flagshipTagged = (i) => (i.chipsets ?? []).some((id) => store.chipsetById.get(id)?.tier === 'flagship');
  const chipItems = all.filter((i) => (has(i, 'chip') || flagshipTagged(i)) && !NOT_PHONE_CHIP.test(i.title)).map((i) => [i, familiesOf(i)]);
  let family = 'all';
  const videos = box.querySelector('[data-chip-videos]');
  const draw = () => drawList(box.querySelector('[data-chip-list]'), chipItems
    .filter(([i, fam]) => (family === 'all' || fam.has(family)) && (!videos.checked || i.kind === 'video')).map(([i]) => i),
  { empty: 'No recent headlines about these chips yet.' });
  wireSeg(box, (f) => { family = f; draw(); });
  videos.addEventListener('change', draw);
  draw();
}
