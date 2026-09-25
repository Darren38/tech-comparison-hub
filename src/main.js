// Application entry: loads the core data, renders the chrome and routes between pages.
// Pages are loaded on demand with dynamic import(), so each page's code downloads only when needed.

import { html, mount } from './lib/html.js';
import { loadCore, store } from './core/store.js';
import { startRouter, matchRoute, refreshRoute } from './core/router.js';
import { setCurrency, currencyLabel, refreshRatesLive } from './engine/money.js';
import { compareTray, theme, viewMode, MAX_COMPARE } from './core/state.js';
import { renderHeader, renderFooter, renderTray, updateNav, toggleTheme, toast } from './ui/layout.js';
import { loadingState, errorState, compareButton } from './ui/components.js';
import { mountAssistant } from './ui/assistant.js';
import { enterPage, titlePage } from './core/trail.js';
import { t, lang, setLang, startTranslation } from './core/i18n.js';

const ROUTES = [
  { pattern: /^\/$/, load: () => import('./pages/home.js') },
  { pattern: /^\/devices(?:\/([\w-]+))?$/, load: () => import('./pages/devices.js') },
  { pattern: /^\/device\/([\w-]+)$/, load: () => import('./pages/device.js') },
  { pattern: /^\/compare(?:\/([\w,-]+))?$/, load: () => import('./pages/compare.js') },
  { pattern: /^\/chipsets$/, load: () => import('./pages/chipsets.js') },
  { pattern: /^\/chipset\/([\w-]+)$/, load: () => import('./pages/chipset.js') },
  { pattern: /^\/search$/, load: () => import('./pages/search.js') },
  { pattern: /^\/news$/, load: () => import('./pages/feed.js'), args: ['news'] },
  { pattern: /^\/reviews$/, load: () => import('./pages/feed.js'), args: ['reviews'] },
  { pattern: /^\/methodology$/, load: () => import('./pages/methodology.js') },
  { pattern: /^\/coverage$/, load: () => import('./pages/coverage.js') },
  { pattern: /^\/charts$/, load: () => import('./pages/charts.js') },
  { pattern: /^\/source\/([\w-]+)$/, load: () => import('./pages/source.js') },
  { pattern: /^\/brand\/([\w-]+)$/, load: () => import('./pages/brand.js') },
];

const app = document.getElementById('app');
let renderSeq = 0;
let currentCleanup = null;
// The scroll a navigation asked for (back to a saved position, or to ?section=). Kept until a render of that page
// finishes: an in-place re-render (e.g. exchange rates updating on start-up) can overtake the first render.
let pendingScroll = null;
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; // the page trail restores positions itself

async function renderRoute(loc, { samePath }) {
  const seq = ++renderSeq;
  const saved = enterPage(loc); // before rendering, so the page's Back button names the page you came from
  if (!samePath) pendingScroll = { restoreScroll: saved, section: loc.query.section, path: loc.path };
  updateNav(loc.segments);
  renderTray(loc.path);
  const matched = matchRoute(ROUTES, loc.path);
  if (!samePath) mount(app, loadingState());
  try {
    const module = matched ? await matched.route.load() : await import('./pages/not-found.js');
    const params = matched ? [...(matched.route.args ?? []), ...matched.params] : [];
    const page = await module.default({ params, query: loc.query, path: loc.path });
    if (seq !== renderSeq) return; // user navigated away while this page was loading
    if (currentCleanup) currentCleanup();
    currentCleanup = null;
    document.title = page.title ? `${t(page.title)} · ${t('Tech Comparison Hub')}` : t('Tech Comparison Hub');
    titlePage(page.title ?? 'Home');
    mount(app, html`<div class="page-enter">${page.html}</div>`);
    if (page.mount) currentCleanup = page.mount(app, loc) ?? null;
    viewMode.apply(); // new switches on the page show the current choice
    const scroll = pendingScroll?.path === loc.path ? pendingScroll : null;
    pendingScroll = null;
    if (scroll) {
      const { restoreScroll, section } = scroll;
      if (restoreScroll !== null) {
        // back to a page you were on: return to the same place. Long pages keep growing for a moment after
        // they render (tables, images), so keep trying for up to a second until the position is reachable.
        const restore = (tries) => {
          if (seq !== renderSeq) return; // the reader has moved on
          window.scrollTo({ top: restoreScroll });
          if (Math.abs(window.scrollY - restoreScroll) > 2 && tries < 20) setTimeout(() => restore(tries + 1), 50);
        };
        requestAnimationFrame(() => restore(0));
      } else {
        window.scrollTo({ top: 0 });
        const target = section ? document.getElementById(section) : null;
        if (target) target.scrollIntoView();
      }
      app.focus({ preventScroll: true });
    }
  } catch (error) {
    if (seq !== renderSeq) return;
    if (error?.status === 404) {
      // A device/chipset/source/brand id that isn't in the database: a normal "not found" page, not an error.
      const notFound = await import('./pages/not-found.js');
      const page = await notFound.default({ path: loc.path, message: error.message });
      if (seq !== renderSeq) return;
      if (currentCleanup) currentCleanup();
      currentCleanup = null;
      document.title = `${t(page.title)} · ${t('Tech Comparison Hub')}`;
      mount(app, html`<div class="page-enter">${page.html}</div>`);
      return;
    }
    console.error(error);
    document.title = `${t('Error')} · ${t('Tech Comparison Hub')}`;
    mount(app, errorState(error));
  }
}

function refreshCompareButtons(id) {
  document.querySelectorAll(`[data-compare-toggle="${CSS.escape(id)}"]`).forEach((btn) => {
    const small = btn.classList.contains('btn--sm');
    btn.outerHTML = String(compareButton(id, { small }));
  });
}

function bindGlobalEvents() {
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-compare-toggle]');
    if (toggle) {
      const id = toggle.dataset.compareToggle;
      const had = compareTray.has(id);
      if (!compareTray.toggle(id)) toast(t('The comparison holds up to {n} devices. Remove one first.', { n: MAX_COMPARE }));
      else if (!had) toast(t('{name} added to the comparison', { name: store.deviceById.get(id)?.name ?? t('Device') }));
      refreshCompareButtons(id);
      return;
    }
    const remove = e.target.closest('[data-tray-remove]');
    if (remove) {
      const id = remove.dataset.trayRemove;
      compareTray.remove(id);
      refreshCompareButtons(id);
      return;
    }
    if (e.target.closest('[data-tray-clear]')) {
      const ids = compareTray.ids;
      compareTray.clear();
      ids.forEach(refreshCompareButtons);
      return;
    }
    // "Back to …": step back through the browser history so the browser's own Back/Forward stay consistent
    const back = e.target.closest('[data-history-back]');
    if (back && !e.metaKey && !e.ctrlKey && !e.shiftKey && window.history.length > 1) {
      e.preventDefault();
      window.history.back();
      return;
    }
    const modeBtn = e.target.closest('[data-mode-set]');
    if (modeBtn) {
      viewMode.set(modeBtn.dataset.modeSet);
      toast(t(modeBtn.dataset.modeSet === 'simple' ? 'Simple view: plain words, fewer research details.' : 'Detailed view: every source, badge and table.'));
      return;
    }
    const action = e.target.closest('[data-action]');
    if (action?.dataset.action === 'reload') window.location.reload();
    if (action?.dataset.action === 'theme') toggleTheme(action);
    if (action?.dataset.action === 'lang') {
      // Version 15: English / 中文. The chrome and the current page are drawn again in the chosen language.
      setLang(lang() === 'zh' ? 'en' : 'zh');
      window.location.reload(); // every part of the page, the Ask panel included, is drawn again in the new language
      return;
    }
    if (action?.dataset.action === 'menu') {
      const nav = document.getElementById('mobile-nav');
      const open = nav.dataset.open !== 'true';
      nav.dataset.open = String(open);
      action.setAttribute('aria-expanded', String(open));
    }
  });
  document.addEventListener('change', (e) => {
    const select = e.target.closest('[data-currency]');
    if (!select) return;
    setCurrency(select.value);
    document.querySelectorAll('[data-currency]').forEach((s) => (s.value = select.value));
    refreshRoute();
    toast(t('Prices now shown in {cur}. Converted prices are marked ≈.', { cur: currencyLabel(select.value) }));
  });
  // A device photo that fails to load (offline, blocked, moved on Commons) falls back to the to-scale outline.
  // "error" does not bubble, so listen in the capture phase.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.hasAttribute('data-thumb')) {
      // a publisher's thumbnail that no longer loads: show the publication's name tile, or drop the picture
      const thumb = img.closest('.thumb');
      if (!thumb) return;
      if (img.dataset.label) {
        const tile = document.createElement('span');
        tile.className = `${[...thumb.classList].filter((c) => !/^thumb--(publisher|video|device)$/.test(c)).join(' ')} thumb--none`;
        tile.setAttribute('aria-hidden', 'true');
        tile.append(Object.assign(document.createElement('span'), { textContent: img.dataset.label }));
        thumb.replaceWith(tile);
        return;
      }
      thumb.parentElement?.classList.remove('has-thumb', 'doc--thumb');
      thumb.remove();
      return;
    }
    if (!(img instanceof HTMLImageElement) || !img.hasAttribute('data-fallback')) return;
    const box = img.closest('.dmedia');
    const fallback = box?.querySelector('.dmedia__fallback');
    if (!fallback) return;
    fallback.hidden = false;
    box.classList.add('is-fallback');
    img.remove();
  }, true);
  compareTray.subscribe(() => renderTray(window.location.hash.replace(/^#/, '').split('?')[0] || '/'));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => theme.apply());
}

async function boot() {
  theme.apply();
  viewMode.apply();
  try {
    await loadCore();
  } catch (error) {
    console.error(error);
    mount(app, errorState(error));
    return;
  }
  compareTray.prune(new Set(store.devices.map((d) => d.id)));
  startTranslation();
  renderHeader();
  renderFooter();
  bindGlobalEvents();
  startRouter(renderRoute);
  mountAssistant();
  // The published rates are Bank Negara Malaysia's latest session when the site was built. If a newer
  // day's rate is available, fetch it in the background and re-render prices once it arrives.
  refreshRatesLive()
    .then((changed) => {
      if (!changed) return;
      renderFooter();
      refreshRoute();
    })
    .catch((error) => console.warn('Live exchange rates unavailable; using the published snapshot.', error));
}

// Every later load checks the server for newer versions of the site's own files (see sw.js). Registered after the
// page starts so it never delays it; the site works the same without it (file:// or blocked).
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

boot();
