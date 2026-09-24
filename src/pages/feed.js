// News feed and reviews/videos feed. Both are views over the same document store,
// so every item keeps its source, evidence class and extraction status.

import { html, mount } from '../lib/html.js';
import { fmtDate, fmtDateTime, plural, timeAgo, fmtViews } from '../lib/format.js';
import { store, sourceName } from '../core/store.js';
import { href } from '../core/router.js';
import { docCard, emptyState, provBadge, sourceLink, extLink, tag, sectionHead, icon, pageTrail, cardThumb, thumbLink } from '../ui/components.js';
import { loadHeadlines, refreshHeadlines, canCollectLive, isSafeUrl, loadViews, youtubeId } from '../engine/live.js';
import { isZh } from '../core/i18n.js';

const MODES = {
  news: {
    title: 'Technology news',
    eyebrow: 'Launches, prices, updates and issues',
    intro: 'The latest headlines from tech publications, collected automatically, followed by checked news attached to specific devices and chipsets.',
    liveTitle: 'Latest headlines',
    liveKinds: ['news'],
    checkedTitle: 'Checked news',
    checkedIntro: 'Each item was read by hand, links to the original report and is summarised in our own words.',
    kinds: ['news', 'official'],
    filterKey: 'type',
    filters: () => store.core.taxonomy.newsTypes,
  },
  reviews: {
    title: 'Reviews, tests & YouTube analysis',
    eyebrow: 'Independent evidence',
    intro: 'The newest reviews and videos, collected automatically, followed by the checked lab reviews, analyses, benchmark databases and YouTube videos whose results feed the comparisons.',
    liveTitle: 'Latest reviews & videos',
    liveKinds: ['review', 'video'],
    checkedTitle: 'Checked reviews & tests',
    checkedIntro: 'Each is a source document: its test results and findings are extracted into structured data, and the comparison engine uses them.',
    kinds: ['review', 'video', 'analysis', 'benchmark'],
    filterKey: 'kind',
    filters: () => store.core.taxonomy.documentKinds.filter((k) => ['review', 'video', 'analysis', 'benchmark'].includes(k.id)),
  },
};

function pipeline(docs) {
  const videos = docs.filter((d) => d.kind === 'video');
  const count = (s) => videos.filter((d) => d.extraction === s).length;
  const steps = [
    ['Device', `${plural(new Set(videos.flatMap((d) => d.devices ?? [])).size, 'device')} linked`],
    ['Source', `${new Set(videos.map((d) => d.source)).size} verified channels`],
    ['Review type', `${new Set(videos.map((d) => d.category)).size} categories`],
    ['Test results', plural(videos.reduce((s, d) => s + d.recordCount, 0), 'record')],
    ['Findings', `${videos.reduce((s, d) => s + d.findingCount, 0)} extracted`],
    ['Comparison engine', 'Used in verdicts'],
  ];
  return html`<section class="card pipeline" aria-labelledby="pipe-h">
    ${sectionHead('YouTube evidence pipeline', { level: 3, id: 'pipe-h', right: html`<span class="tiny muted">${count('complete')} complete · ${count('partial')} partial · ${count('metadata-only')} metadata only</span>` })}
    <ol class="pipeline__steps">${steps.map(([label, sub]) => html`<li><strong>${label}</strong><span class="tiny muted">${sub}</span></li>`)}</ol>
    <p class="tiny muted">Every channel is checked against YouTube's oEmbed record before a video is added. Candidate videos from unverifiable or AI-generated review channels were excluded. “Metadata only” videos are linked and categorised; their findings will be extracted in a later pass rather than guessed.</p>
  </section>`;
}

function newsTimeline(docs) {
  const byMonth = new Map();
  for (const d of docs) {
    const key = (d.published ?? 'Undated').slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(d);
  }
  return html`${[...byMonth.entries()].map(([month, items]) => html`<section class="month">
    <h2 class="subhead">${month === 'Undated' ? 'Undated' : fmtDate(month, 'month')}</h2>
    <ol class="timeline">${items.map((doc) => html`<li class="timeline__item ${cardThumb({ url: doc.url, devices: doc.devices ?? [] }) ? 'has-thumb' : ''}">
      <div class="timeline__date tiny num">${doc.published && doc.published.length > 7 ? fmtDate(doc.published).split(' ').slice(0, 2).join(' ') : doc.publishedApprox ? 'c.' : ''}</div>
      <div class="timeline__body">
        <div class="row tiny">${provBadge(doc.class)} ${tag(store.core.taxonomy.newsTypes.find((t) => t.id === doc.type)?.label ?? 'News')} ${doc.region ? tag(doc.region, 'muted') : ''} ${sourceLink(doc.testedBy ?? doc.source)}</div>
        <h3 class="timeline__title">${extLink(doc.url, doc.title)}</h3>
        ${doc.summary ? html`<p class="small muted">${doc.summary}</p>` : ''}
        <div class="row tiny">${[...(doc.devices ?? []), ...(doc.chipsets ?? [])].slice(0, 4).map((id) => {
          const dev = store.deviceById.get(id);
          const chip = store.chipsetById.get(id);
          return dev ? html`<a class="chip" href="${href(`/device/${id}`)}">${dev.name}</a>` : chip ? html`<a class="chip" href="${href(`/chipset/${id}`)}">${chip.name}</a>` : '';
        })}</div>
      </div>
      ${thumbLink(cardThumb({ url: doc.url, devices: doc.devices ?? [] }), { url: doc.url, title: doc.title, size: 'side' })}
    </li>`)}</ol>
  </section>`)}`;
}

// ------------------------------------------------------------------ latest headlines (live)
// Fewer at a time on phones, where the list is a single column.
const livePage = () => (window.matchMedia('(max-width: 640px)').matches ? 6 : 12);

function livePanel(mode) {
  return html`<section class="live" aria-labelledby="live-h" data-live>
    <div class="live__head">
      <div class="live__heading">
        <div class="eyebrow live__eyebrow"><span class="live__dot" aria-hidden="true"></span> Collected automatically · not checked by hand</div>
        <h2 id="live-h">${mode.liveTitle}</h2>
        <p class="small live__status" data-live-status role="status" aria-live="polite">Loading the latest collection…</p>
      </div>
      <div class="live__actions">
        ${mode.liveKinds.includes('video') ? html`<div class="seg seg--sm" role="group" aria-label="Sort"><button type="button" class="seg__btn is-on" aria-pressed="true" data-live-sort="newest">Newest</button><button type="button" class="seg__btn" aria-pressed="false" data-live-sort="views">Most viewed</button></div>` : ''}
        <label class="check small"><input type="checkbox" data-live-matched /> Only devices in this hub</label>
        <label class="check small"><input type="checkbox" data-live-zh ${isZh() ? 'checked' : ''} /> Include Chinese-language sources</label>
        <button type="button" class="btn btn--sm live__refresh" data-live-refresh>${icon('refresh', { size: 16 })}<span>Refresh</span></button>
      </div>
    </div>
    <ol class="live__list" data-live-list aria-busy="true">
      ${[0, 1, 2].map(() => html`<li class="live__item live__item--loading" aria-hidden="true"><div class="skeleton skeleton--short"></div><div class="skeleton"></div></li>`)}
    </ol>
    <div class="live__foot">
      <button type="button" class="btn btn--ghost btn--sm" data-live-more hidden>Show more</button>
      <p class="tiny muted">Titles and links come from each publisher's public RSS or YouTube feed and open on their site. Devices are matched by name automatically. These headlines are not evidence and never change scores; the checked documents below are.${mode.liveKinds.includes('video') ? html` <span>View counts are YouTube’s own, as published in each channel’s feed when collected. Articles don’t publish view counts. A high count means a video reached many people, not that it is more accurate.</span>` : ''}</p>
    </div>
  </section>`;
}

function liveItem(item, isNew) {
  const devices = (item.devices ?? []).map((id) => store.deviceById.get(id)).filter(Boolean);
  const thumb = cardThumb({ image: isSafeUrl(item.image) ? item.image : null, url: item.url, devices: item.devices ?? [] });
  return html`<li class="live__item has-thumb ${isNew ? 'is-new' : ''}">
    ${thumbLink(thumb, { url: item.url, title: item.title, size: 'row', placeholder: sourceName(item.source) })}
    <div class="live__meta tiny">
      <a class="live__source" href="${href(`/source/${item.source}`)}">${sourceName(item.source)}</a>
      ${item.kind === 'video' ? tag('Video', 'muted') : item.kind === 'review' ? tag('Review', 'muted') : ''}
      ${item.views != null ? html`<span class="live__views">${fmtViews(item.views)}</span>` : ''}
      ${item.lang === 'zh' ? tag('In Chinese', 'muted') : ''}
      ${item.published ? html`<time datetime="${item.published}" title="${fmtDateTime(item.published)}">${timeAgo(item.published)}</time>` : html`<span class="faint">Date not given</span>`}
      ${isNew ? html`<span class="live__new">New</span>` : ''}
    </div>
    ${extLink(item.url, item.title, 'live__link')}
    ${devices.length ? html`<div class="live__devices">${devices.map((d) => html`<a class="chip" href="${href(`/device/${d.id}`)}">${d.name}</a>`)}</div>` : ''}
  </li>`;
}

const AUTO_COLLECT_AFTER_MS = 20 * 60 * 1000;

function bindLive(root, mode) {
  const panel = root.querySelector('[data-live]');
  if (!panel) return () => {};
  const listEl = panel.querySelector('[data-live-list]');
  const statusEl = panel.querySelector('[data-live-status]');
  const refreshBtn = panel.querySelector('[data-live-refresh]');
  const moreBtn = panel.querySelector('[data-live-more]');
  const matchedBox = panel.querySelector('[data-live-matched]');
  const zhBox = panel.querySelector('[data-live-zh]');
  let sort = 'newest';
  let data = null;
  const LIVE_PAGE = livePage();
  let shown = LIVE_PAGE;
  let newIds = new Set();
  let note = null; // outcome of the last refresh: { text, tone }
  let busy = false;
  let alive = true;

  const relevant = (d) => (d?.items ?? []).filter((i) => mode.liveKinds.includes(i.kind) && i.title && isSafeUrl(i.url));
  const filtered = () => relevant(data).filter((i) => (!matchedBox.checked || i.devices?.length) && (zhBox.checked || i.lang !== 'zh'));
  // "Most viewed": items with a view count first, highest first; the rest keep their newest-first order after them
  const visible = () => {
    const items = filtered();
    if (sort !== 'views') return items;
    const counted = items.filter((i) => i.views != null).sort((a, b) => b.views - a.views);
    return [...counted, ...items.filter((i) => i.views == null)];
  };

  function renderStatus() {
    if (!data) {
      mount(statusEl, note ? html`<span class="live__note live__note--bad">${note.text}</span>` : 'Loading the latest collection…');
      return;
    }
    const feeds = (data.feeds ?? []).filter((f) => mode.liveKinds.includes(f.kind) || (mode.liveKinds.includes('review') && f.kind === 'news'));
    const failed = feeds.filter((f) => !f.ok).length;
    const when = data.fetchedAt ? html`<time datetime="${data.fetchedAt}" title="${fmtDateTime(data.fetchedAt)}">${timeAgo(data.fetchedAt)}</time>` : 'at an unknown time';
    mount(statusEl, html`${note ? html`<span class="live__note live__note--${note.tone}">${note.text}</span> ` : ''}<span class="muted">${plural(relevant(data).length, mode.liveKinds.includes('video') ? 'item' : 'headline')} from the last ${data.maxAgeDays ?? 45} days · collected ${when} from ${feeds.length - failed} of ${plural(feeds.length, 'feed')}${failed ? ` (${failed} unreachable)` : ''}.</span>`);
  }

  function renderList() {
    const items = visible();
    listEl.removeAttribute('aria-busy');
    if (!data) {
      mount(listEl, html`<li class="live__empty small muted">Latest headlines are not available right now. The checked ${mode === MODES.news ? 'news' : 'reviews'} below are unaffected.</li>`);
    } else if (!items.length) {
      mount(listEl, html`<li class="live__empty small muted">${matchedBox.checked ? 'None of the recent items mention a device in this hub. Untick “Only devices in this hub” to see everything.' : 'Nothing recent was collected for this page.'}</li>`);
    } else {
      const noCounts = sort === 'views' && !items.some((i) => i.views != null);
      mount(listEl, html`${noCounts ? html`<li class="live__empty small muted">None of these items has a view count yet (view counts come from YouTube videos only), so they are shown newest first.</li>` : ''}${items.slice(0, shown).map((i) => liveItem(i, newIds.has(i.id)))}`);
    }
    const rest = items.length - shown;
    moreBtn.hidden = !data || rest <= 0;
    if (rest > 0) moreBtn.textContent = `Show ${Math.min(rest, LIVE_PAGE)} more (${rest} left)`;
  }

  function setBusy(on) {
    busy = on;
    refreshBtn.disabled = on;
    refreshBtn.classList.toggle('is-busy', on);
    refreshBtn.querySelector('span').textContent = on ? 'Refreshing…' : 'Refresh';
    listEl.setAttribute('aria-busy', String(on));
  }

  async function refresh() {
    if (busy) return;
    setBusy(true);
    const before = new Set((data?.items ?? []).map((i) => i.id));
    const hadData = Boolean(data);
    try {
      const res = await refreshHeadlines();
      if (!alive) return;
      data = res.data;
      const fresh = relevant(data).filter((i) => !before.has(i.id));
      newIds = hadData ? new Set(fresh.map((i) => i.id)) : new Set();
      const count = fresh.length ? `${plural(fresh.length, 'new item')}, marked New.` : 'Nothing new since the last check.';
      if (res.error) note = { tone: 'bad', text: `Collection failed (${res.error}); showing the ${res.data?.live ? 'last collection' : 'saved collection'}.` };
      else if (res.live) note = { tone: 'good', text: `Collected just now from the publishers' feeds. ${hadData ? count : ''}` };
      else if (res.collectedNow) note = { tone: 'good', text: `Collected just now. ${hadData ? count : ''}` };
      else if (res.server) note = { tone: 'info', text: `Already collected under a minute ago. ${hadData ? count : ''}` };
      else note = { tone: 'info', text: `This copy of the site collects new headlines every few hours. ${hadData ? count : ''}` };
    } catch (error) {
      if (!alive) return;
      note = { tone: 'bad', text: `Could not refresh (${error.message}). Check the connection and try again.${data ? ' Showing the previous collection.' : ''}` };
    } finally {
      if (alive) {
        setBusy(false);
        renderStatus();
        renderList();
      }
    }
  }

  refreshBtn.addEventListener('click', refresh);
  panel.querySelectorAll('[data-live-sort]').forEach((b) => b.addEventListener('click', () => {
    sort = b.dataset.liveSort;
    panel.querySelectorAll('[data-live-sort]').forEach((x) => { x.setAttribute('aria-pressed', String(x === b)); x.classList.toggle('is-on', x === b); });
    shown = LIVE_PAGE;
    renderList();
  }));
  for (const box of [matchedBox, zhBox]) {
    box.addEventListener('change', () => {
      shown = LIVE_PAGE;
      renderList();
    });
  }
  moreBtn.addEventListener('click', () => {
    shown += LIVE_PAGE;
    renderList();
    listEl.children[shown - LIVE_PAGE]?.querySelector('a.live__link')?.focus();
  });

  setBusy(true);
  loadHeadlines()
    .then((d) => {
      if (alive) data = d;
    })
    .catch((error) => {
      if (alive) note = { tone: 'bad', text: `Latest headlines could not be loaded (${error.message}). Try Refresh.` };
    })
    .finally(async () => {
      if (!alive) return;
      setBusy(false);
      renderStatus();
      renderList();
      // Where a relay is set up (Version 12), a collection older than 20 minutes is replaced by a live one straight away.
      const age = data?.fetchedAt ? Date.now() - new Date(data.fetchedAt).getTime() : Infinity;
      if (alive && !data?.live && age > AUTO_COLLECT_AFTER_MS && (await canCollectLive())) refresh();
    });
  // Keep "collected 5 min ago" and each item's age current while the page stays open.
  const timer = setInterval(() => {
    if (!data || busy) return;
    renderStatus();
    listEl.querySelectorAll('time[datetime]').forEach((t) => (t.textContent = timeAgo(t.getAttribute('datetime'))));
  }, 60000);
  return () => {
    alive = false;
    clearInterval(timer);
  };
}

export default async function render({ params, query }) {
  const mode = MODES[params[0]] ?? MODES.news;
  const all = store.documents.filter((d) => mode.kinds.includes(d.kind));
  let filter = query.filter ?? 'all';
  let order = query.sort === 'views' ? 'views' : 'newest';
  const viewsData = params[0] === 'reviews' ? await loadViews() : null;
  const viewsOf = (d) => (d.kind === 'video' ? viewsData?.videos?.[youtubeId(d.url)] ?? null : null);
  const withViews = all.filter((d) => viewsOf(d)).length;
  const options = mode.filters().filter((o) => all.some((d) => d[mode.filterKey] === o.id));

  const list = () => {
    let docs = filter === 'all' ? all : all.filter((d) => d[mode.filterKey] === filter);
    if (!docs.length) return emptyState('Nothing here yet', 'No documents of this type have been added.');
    if (order === 'views') {
      const counted = docs.filter((d) => viewsOf(d)).sort((a, b) => viewsOf(b)[0] - viewsOf(a)[0]);
      docs = [...counted, ...docs.filter((d) => !viewsOf(d))];
    }
    return params[0] === 'reviews'
      ? html`<div class="grid grid-3">${docs.map((d) => docCard(d, { views: viewsOf(d) }))}</div>`
      : newsTimeline(docs);
  };

  return {
    title: mode.title,
    html: html`<div class="stack-lg">
      ${pageTrail([{ label: 'Home', href: href('/') }, { label: mode.title }])}
      <header><div class="eyebrow">${mode.eyebrow}</div><h1>${mode.title}</h1><p class="muted" style="margin-top:8px;max-width:70ch">${mode.intro}</p></header>
      ${livePanel(mode)}
      <div class="checked-head">
        ${sectionHead(mode.checkedTitle, { eyebrow: 'Checked by hand · used as evidence', id: 'checked-h' })}
        <p class="small muted" style="max-width:70ch">${mode.checkedIntro}</p>
      </div>
      ${params[0] === 'reviews' ? pipeline(all) : ''}
      <div class="row">
        <div class="seg" role="group" aria-label="Filter">
          <button type="button" data-filter="all" aria-pressed="${filter === 'all'}">All <span class="tiny muted">${all.length}</span></button>
          ${options.map((o) => html`<button type="button" data-filter="${o.id}" aria-pressed="${filter === o.id}">${o.label} <span class="tiny muted">${all.filter((d) => d[mode.filterKey] === o.id).length}</span></button>`)}
        </div>
        ${params[0] === 'reviews' ? html`<div class="seg seg--sm" role="group" aria-label="Sort"><button type="button" class="seg__btn ${order === 'newest' ? 'is-on' : ''}" aria-pressed="${order === 'newest'}" data-order="newest">Newest</button><button type="button" class="seg__btn ${order === 'views' ? 'is-on' : ''}" aria-pressed="${order === 'views'}" data-order="views">Most viewed</button></div>` : ''}
        <span class="tiny muted">${plural(all.length, 'document')}${params[0] === 'reviews' ? ` · ${withViews} with a YouTube view count` : ''}</span>
      </div>
      <div data-list>${list()}</div>
    </div>`,
    mount(root) {
      root.querySelectorAll('[data-filter]').forEach((b) =>
        b.addEventListener('click', () => {
          filter = b.dataset.filter;
          root.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          mount(root.querySelector('[data-list]'), list());
        }),
      );
      root.querySelectorAll('[data-order]').forEach((b) =>
        b.addEventListener('click', () => {
          order = b.dataset.order;
          root.querySelectorAll('[data-order]').forEach((x) => { x.setAttribute('aria-pressed', String(x === b)); x.classList.toggle('is-on', x === b); });
          mount(root.querySelector('[data-list]'), list());
        }),
      );
      return bindLive(root, mode);
    },
  };
}
