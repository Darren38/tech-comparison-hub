// Site chrome: header (nav, search with suggestions, theme), footer, compare tray, toasts.

import { html, mount } from '../lib/html.js';
import { fmtDate, fmtDateTime, fmtNumber } from '../lib/format.js';
import { store, deviceTitle } from '../core/store.js';
import { href } from '../core/router.js';
import { compareTray, theme, MAX_COMPARE } from '../core/state.js';
import { icon } from './components.js';
import { search, groupResults } from '../engine/search.js';
import { parseIntent, describeIntent, intentHref } from '../engine/intent.js';
import { currencyList, selectedCurrency, ratesLabel } from '../engine/money.js';
import { t, lang } from '../core/i18n.js';

function currencySelect(variant) {
  const current = selectedCurrency();
  return html`<label class="currency currency--${variant}" title="${t('Display currency')}">
    <span class="${variant === 'mobile' ? 'currency__label small' : 'sr-only'}">${t('Currency')}</span>
    <select data-currency aria-label="${t('Display currency')}">${currencyList().map((c) => html`<option value="${c.code}" ${c.code === current ? 'selected' : ''}>${c.label}</option>`)}</select>
  </label>`;
}

export const NAV = [
  { path: '/devices', label: 'Devices', match: ['devices', 'device', 'brand'] },
  { path: '/compare', label: 'Compare', match: ['compare'] },
  { path: '/chipsets', label: 'Chipsets', match: ['chipsets', 'chipset'] },
  { path: '/news', label: 'News', match: ['news'] },
  { path: '/reviews', label: 'Reviews & videos', match: ['reviews'] },
  { path: '/charts', label: 'Charts', match: ['charts'] },
  { path: '/coverage', label: 'Coverage', match: ['coverage'] },
  { path: '/methodology', label: 'Methodology', match: ['methodology', 'source'] },
];

// ------------------------------------------------------------------ header
export function renderHeader() {
  const root = document.getElementById('site-header');
  mount(root, html`
    <div class="wrap site-header__inner">
      <a class="brand" href="#/" aria-label="Tech Comparison Hub home">
        <span class="brand__mark" aria-hidden="true">TC</span>
        <span class="brand__text">${t('Tech Comparison Hub')}<small>${t('Evidence-first research')}</small></span>
      </a>
      <nav class="nav" aria-label="Main">${NAV.map((n) => html`<a href="${href(n.path)}" data-nav="${n.match.join(' ')}">${t(n.label)}</a>`)}</nav>
      <div class="header-tools">
        <form class="header-search searchbox" role="search" data-searchbox>
          ${icon('search', { size: 16 })}
          <input type="search" name="q" placeholder="${t('Search devices, chips, news…')}" autocomplete="off" aria-label="${t('Search')}" />
        </form>
        <a class="icon-btn search-btn" href="${href('/search')}" aria-label="Search">${icon('search')}</a>
        ${currencySelect('header')}
        <button type="button" class="lang-btn" data-action="lang" aria-label="${lang() === 'zh' ? 'Switch to English' : '切换到中文'}" title="${lang() === 'zh' ? 'English' : '中文'}"><span class="${lang() === 'en' ? 'is-on' : ''}">EN</span><span class="${lang() === 'zh' ? 'is-on' : ''}">中文</span></button>
        <button type="button" class="icon-btn" data-action="theme" aria-label="${t('Toggle colour theme')}">${icon(theme.effective() === 'dark' ? 'sun' : 'moon')}</button>
        <button type="button" class="icon-btn menu-btn" data-action="menu" aria-label="${t('Open menu')}" aria-expanded="false" aria-controls="mobile-nav">${icon('menu')}</button>
      </div>
    </div>
    <nav class="mobile-nav" id="mobile-nav" aria-label="Main (mobile)">${NAV.map((n) => html`<a href="${href(n.path)}" data-nav="${n.match.join(' ')}">${t(n.label)}</a>`)}${currencySelect('mobile')}</nav>`);
  bindSearchBox(root.querySelector('[data-searchbox]'));
  // The header search always starts empty: on load (browsers can refill form fields) and after every page change,
  // so the next search, or the next person at this screen, never sees the previous query.
  const headerInput = root.querySelector('[data-searchbox] input');
  if (headerInput) {
    headerInput.value = '';
    window.addEventListener('hashchange', () => {
      if (document.activeElement !== headerInput) headerInput.value = '';
    });
    window.addEventListener('pageshow', () => { headerInput.value = ''; });
  }
}

export function updateNav(segments) {
  const first = segments[0] ?? '';
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const on = a.dataset.nav.split(' ').includes(first);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const mobile = document.getElementById('mobile-nav');
  if (mobile) mobile.dataset.open = 'false';
  document.querySelector('[data-action="menu"]')?.setAttribute('aria-expanded', 'false');
}

export function toggleTheme(button) {
  theme.set(theme.effective() === 'dark' ? 'light' : 'dark');
  if (button) button.innerHTML = String(icon(theme.effective() === 'dark' ? 'sun' : 'moon'));
}

// ------------------------------------------------------------------ search box with suggestions
let suggestSeq = 0;

function resultHref(r) {
  switch (r.type) {
    case 'device':
      return { url: href(`/device/${r.id}`) };
    case 'chipset':
      return { url: href(`/chipset/${r.id}`) };
    case 'brand':
      return { url: href(`/brand/${r.id}`) };
    case 'source':
      return { url: href(`/source/${r.id}`) };
    default: {
      const doc = store.docById.get(r.id);
      return { url: doc?.url ?? href('/search', { q: r.title }), external: Boolean(doc?.url) };
    }
  }
}

/** Autocomplete for any search form. Enter follows the selected suggestion, the detected intent, or the results page. */
export function bindSearchBox(form, { onSubmit } = {}) {
  if (!form) return;
  const input = form.querySelector('input');
  const list = document.createElement('div');
  const listId = `suggest-${Math.random().toString(36).slice(2, 8)}`;
  list.className = 'suggest';
  list.id = listId;
  list.hidden = true;
  list.setAttribute('role', 'listbox');
  form.appendChild(list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', listId);
  input.setAttribute('aria-expanded', 'false');

  let items = [];
  let active = -1;
  let intentTarget = null;
  let timer = null;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const setActive = (index) => {
    active = index;
    items.forEach((el, i) => el.setAttribute('aria-selected', String(i === index)));
    if (items[index]) {
      input.setAttribute('aria-activedescendant', items[index].id);
      items[index].scrollIntoView({ block: 'nearest' });
    }
  };

  const update = async () => {
    const q = input.value.trim();
    const seq = ++suggestSeq;
    if (q.length < 2) {
      close();
      return;
    }
    const [results, intent] = await Promise.all([search(q, { limit: 12 }), parseIntent(q)]);
    if (seq !== suggestSeq) return; // a newer keystroke won
    intentTarget = intent.type !== 'search' ? intentHref(intent, q) : null;
    const groups = groupResults(results).map((g) => ({ ...g, items: g.items.slice(0, g.type === 'device' ? 5 : 3) }));
    let n = 0;
    mount(list, html`
      ${intentTarget ? html`<a class="suggest__intent" role="option" id="${listId}-${n++}" href="${intentTarget}">${icon('arrow', { size: 16 })} ${describeIntent(intent)}</a>` : ''}
      ${groups.length
        ? groups.map((g) => html`<div class="suggest__group eyebrow">${g.label}</div>${g.items.map((r) => {
            const target = resultHref(r);
            return html`<a class="suggest__item" role="option" id="${listId}-${n++}" href="${target.url}" ${target.external ? html`target="_blank" rel="noopener noreferrer"` : ''}>
              <strong>${r.title}</strong><span class="tiny muted">${r.sub ?? ''}${target.external ? ' ↗' : ''}</span></a>`;
          })}`)
        : intentTarget ? '' : html`<div class="suggest__group small muted">${t('No matches. Press Enter to search everything.')}</div>`}
      <a class="suggest__item tiny muted" role="option" id="${listId}-${n++}" href="${href('/search', { q })}">${t('See all results for “{q}”', { q })}</a>`);
    items = [...list.querySelectorAll('[role="option"]')];
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(-1);
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(update, 110);
  });
  input.addEventListener('focus', () => {
    if (input.value.trim().length >= 2) update();
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(items.length - 1, active + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(-1, active - 1));
    } else if (e.key === 'Escape') {
      close();
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    if (active >= 0 && items[active]) {
      items[active].click();
      close();
      return;
    }
    clearTimeout(timer);
    const intent = await parseIntent(q);
    close();
    input.blur();
    if (onSubmit) onSubmit(q, intent);
    window.location.hash = intentHref(intent, q).slice(1);
  });
  list.addEventListener('click', (e) => {
    if (e.target.closest('a')) close();
  });
  document.addEventListener('click', (e) => {
    if (!form.contains(e.target)) close();
  });
}

// ------------------------------------------------------------------ compare tray
export function renderTray(path) {
  const tray = document.getElementById('compare-tray');
  const ids = compareTray.ids.filter((id) => store.deviceById.has(id));
  const onCompare = path.startsWith('/compare');
  const show = ids.length > 0 && !onCompare;
  tray.hidden = !show;
  document.body.classList.toggle('has-tray', show);
  if (!show) {
    tray.replaceChildren(); // no stale buttons left behind in the hidden tray
    return;
  }
  mount(tray, html`
    <span class="tray__label">${t('Compare')} ${ids.length}/${MAX_COMPARE}</span>
    <div class="tray__items">${ids.map((id) => html`<span class="tray__item">${store.deviceById.get(id).name}<button type="button" data-tray-remove="${id}" aria-label="${t('Remove {name} from comparison', { name: deviceTitle(store.deviceById.get(id)) })}">${icon('close', { size: 14 })}</button></span>`)}</div>
    <button type="button" class="btn btn--sm btn--ghost tray__clear" data-tray-clear>${t('Clear')}</button>
    <a class="btn btn--sm btn--accent" href="${href(`/compare/${ids.join(',')}`)}" ${ids.length < 2 ? html`aria-disabled="true"` : ''}>${ids.length < 2 ? t('Add one more') : t('Compare now')} ${icon('arrow', { size: 14 })}</a>`);
}

// ------------------------------------------------------------------ footer
export function renderFooter() {
  const { counts, time, data = {} } = store.core.build;
  mount(document.getElementById('site-footer'), html`
    <div class="wrap site-footer__grid">
      <div>
        <div class="brand__text" style="color:var(--ink)">${t('Tech Comparison Hub')}</div>
        <p style="margin-top:8px;max-width:48ch">${t('An evidence-first research platform. Facts are attributed to their sources and linked; reviews are summarised in our own words, never republished. Platform scores are labelled as analysis.')}</p>
        ${lang() === 'zh' ? html`<p class="tiny muted" style="margin-top:8px">界面已翻译为中文；评测摘要、新闻标题和来源说明保持原文语言，数值与来源不变。</p>` : ''}
        <p class="tiny" style="margin-top:10px"><strong>${t('Data as of {date}, not live.', { date: fmtDate(data.asOf ?? time.slice(0, 10)) })}</strong> ${t('Devices announced {from} to {to}', { from: fmtDate(data.announcedFrom, 'month'), to: fmtDate(data.announcedTo, 'month') })} · ${t('{n} devices', { n: fmtNumber(counts.devices) })} · ${t('{n} evidence records', { n: fmtNumber(counts.records) })} · ${t('{n} source documents', { n: fmtNumber(counts.documents) })} · <a href="${href('/methodology', { section: 'freshness' })}">${t('How current is this?')}</a></p>
        <p class="tiny muted" style="margin-top:6px" data-rates-label>${t('Exchange rates')}: ${ratesLabel()}${store.core.currencies?.live ? t(' · updated when you opened this page') : ''}.</p>
        ${store.core.build?.auto?.benchmarks ? html`<p class="tiny muted" style="margin-top:4px">${t('Benchmark databases (UL 3DMark, DXOMARK, AnTuTu) and device pictures are re-checked automatically every day at about 08:00 Malaysia time. Last check: {when}.', { when: fmtDateTime(store.core.build.auto.benchmarks.at) })}</p>` : ''}
      </div>
      <div><h4>${t('Explore')}</h4><ul>
        <li><a href="${href('/devices/smartphone')}">${t('Smartphones')}</a></li>
        <li><a href="${href('/devices/tablet')}">${t('Tablets')}</a></li>
        <li><a href="${href('/devices/smartwatch')}">${t('Smartwatches')}</a></li>
        <li><a href="${href('/chipsets')}">${t('Chipsets')}</a></li></ul></div>
      <div><h4>${t('Evidence')}</h4><ul>
        <li><a href="${href('/reviews')}">${t('Reviews & videos')}</a></li>
        <li><a href="${href('/news')}">${t('News')}</a></li>
        <li><a href="${href('/coverage')}">${t('Evidence coverage')}</a></li>
        <li><a href="${href('/methodology', { section: 'sources' })}">${t('Source registry')}</a></li></ul></div>
      <div><h4>${t('About')}</h4><ul>
        <li><a href="${href('/methodology')}">${t('How scoring works')}</a></li>
        <li><a href="${href('/methodology', { section: 'confidence' })}">${t('Confidence levels')}</a></li>
        <li><a href="${href('/methodology', { section: 'ethics' })}">${t('Data ethics')}</a></li></ul></div>
    </div>`);
}

// ------------------------------------------------------------------ toast
let toastTimer = null;
export function toast(message) {
  const root = document.getElementById('toast-root');
  mount(root, html`<div class="toast">${message}</div>`);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => mount(root, ''), 2600);
}
