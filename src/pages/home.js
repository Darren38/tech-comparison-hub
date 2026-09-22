// Homepage: search-first entry, featured comparisons, measured leaderboards,
// use-case picks, latest releases, news and videos, chipset ladder.

import { html, mount as mountHtml } from '../lib/html.js';
import { fmtMetric, fmtNumber, fmtDate, relativeDate, timeAgo } from '../lib/format.js';
import { store, deviceTitle, brandName, metricDef, sourceName } from '../core/store.js';
import { href } from '../core/router.js';
import { bindSearchBox } from '../ui/layout.js';
import { icon, deviceCard, confMeter, provBadge, sectionHead, legend, seriesMark, cardThumb, thumbLink, extLink } from '../ui/components.js';
import { loadHeadlines, isSafeUrl } from '../engine/live.js';
import { scoreBars } from '../ui/charts.js';
import { metricLeaderboard, profileLeaderboard } from '../engine/scoring.js';

const EXAMPLES = [
  'Galaxy S26 Ultra vs iPhone 17 Pro Max',
  'Xiaomi 17 Ultra vs vivo X300 Pro for photography',
  'best gaming phone under RM4,000',
  'Snapdragon 8 Elite Gen 5 phones',
];

const BOARDS = [
  { id: 'battery', label: 'Battery', metric: 'gsma_active_use', blurb: 'GSMArena Active Use Score: one lab, one method, directly comparable.' },
  { id: 'charging', label: 'Charging', metric: 'charge_full', blurb: 'Minutes from empty to full with the maker’s charger (measured).' },
  { id: 'display', label: 'Outdoor brightness', metric: 'nits_auto', blurb: 'Measured 75% white patch in auto mode: what you see in sunlight.' },
  { id: 'gpu', label: 'Peak GPU', metric: 'wle', blurb: '3DMark Wild Life Extreme. Consensus of sources where more than one tested the phone.' },
  { id: 'sustained', label: 'Sustained GPU', metric: 'wle_stability', blurb: 'Share of peak kept through a 20-loop stress test. Depends on the phone’s cooling, not just the chip.' },
  { id: 'cpu', label: 'CPU single-core', metric: 'gb6_single', blurb: 'Geekbench 6 single-core, the best proxy for everyday responsiveness.' },
];

const PICKS = ['gaming', 'photography', 'battery', 'student', 'longterm'];

function hero() {
  const c = store.core.build.counts;
  return html`<section class="hero">
    <div class="hero__copy">
      <div class="eyebrow">Evidence-first device research</div>
      <h1>Compare devices on the evidence, not just the spec sheet.</h1>
      <p class="hero__lede">Specifications, independent lab results, reviewer findings and news for ${c.devices} devices. Every number is traced to its source and rated for confidence, and scores explain <em>why</em> one device wins.</p>
      <form class="searchbox searchbox--hero" role="search" data-hero-search>
        ${icon('search', { size: 22 })}
        <input type="search" name="q" placeholder="Try “S26 Ultra vs iPhone 17 Pro Max” or “Dimensity 9500”" autocomplete="off" aria-label="Search devices, chipsets and news, or type a comparison" />
        <button class="btn btn--primary" type="submit">Search</button>
      </form>
      <div class="hero__examples small">
        <span class="muted">Try:</span>
        ${EXAMPLES.map((q) => html`<button type="button" class="chip" data-example="${q}">${q}</button>`)}
      </div>
    </div>
    <dl class="hero__stats">
      <div><dt>Devices</dt><dd class="num">${c.devices}</dd></div>
      <div><dt>Chipsets</dt><dd class="num">${c.chipsets}</dd></div>
      <div><dt>Evidence records</dt><dd class="num">${fmtNumber(c.records)}</dd></div>
      <div><dt>Source documents</dt><dd class="num">${c.documents}</dd></div>
      <div><dt>Sources tracked</dt><dd class="num">${c.sources}</dd></div>
    </dl>
  </section>`;
}

function quickCompare() {
  const phones = store.devices.filter((d) => d.category === 'smartphone');
  const byBrand = new Map();
  for (const d of phones) {
    if (!byBrand.has(d.brand)) byBrand.set(d.brand, []);
    byBrand.get(d.brand).push(d);
  }
  const groups = [...byBrand.entries()].sort((a, b) => brandName(a[0]).localeCompare(brandName(b[0])));
  const defaults = store.core.featured[0]?.devices ?? [];
  const select = (i) => html`<label class="qc__slot">
      ${seriesMark(i)}
      <span class="sr-only">Device ${'ABCD'[i]}</span>
      <select data-qc="${i}">
        <option value="">${i < 2 ? 'Choose a phone…' : 'Optional'}</option>
        ${groups.map(([brand, list]) => html`<optgroup label="${brandName(brand)}">${list.map((d) => html`<option value="${d.id}" ${defaults[i] === d.id ? 'selected' : ''}>${d.name}</option>`)}</optgroup>`)}
      </select></label>`;
  return html`<section class="card qc" aria-labelledby="qc-title">
    <div class="spread"><h2 id="qc-title">Quick compare</h2><span class="tiny muted">Up to 4 phones</span></div>
    <div class="qc__slots">${[0, 1, 2, 3].map(select)}</div>
    <div class="row">
      <label class="field__label" for="qc-profile">Weighted for</label>
      <select id="qc-profile" data-qc-profile>${store.core.scoring.profiles.map((p) => html`<option value="${p.id}">${p.label}</option>`)}</select>
      <button type="button" class="btn btn--accent" data-qc-go style="margin-left:auto">Compare ${icon('arrow', { size: 16 })}</button>
    </div>
    <ul class="qc__promise small">
      <li><strong>Like-for-like verdicts.</strong> Only evidence every phone shares counts.</li>
      <li><strong>Reasons with sources.</strong> Each win cites the tests behind it.</li>
      <li><strong>Confidence on every call.</strong> Thin or conflicting evidence is flagged, not hidden.</li>
      <li><strong>Evidence pack export.</strong> Cited JSON, ready for AI-assisted research.</li>
    </ul>
  </section>`;
}

function featured() {
  return html`<section aria-labelledby="featured-title">
    ${sectionHead('Trending comparisons', { eyebrow: 'Curated', id: 'featured-title', right: html`<a class="small" href="${href('/compare')}">Build your own →</a>` })}
    <div class="grid grid-4">
      ${store.core.featured.map((f) => html`<a class="feature" href="${href(`/compare/${f.devices.join(',')}`, { profile: f.profile })}">
        <div class="feature__devices">${f.devices.map((id, i) => html`<span class="feature__dev">${seriesMark(i)}<span>${store.deviceById.get(id)?.name ?? id}</span></span>`)}</div>
        <h3>${f.title}</h3>
        <p class="small muted">${f.blurb}</p>
        <span class="tiny feature__profile">${store.profileById.get(f.profile)?.label ?? 'Balanced'} weighting →</span>
      </a>`)}
    </div>
  </section>`;
}

function board(b, index) {
  const def = metricDef(b.metric);
  const all = metricLeaderboard('smartphone', b.metric, { limit: Infinity });
  const rows = all.slice(0, 6);
  const top = rows[0]?.m.value;
  return html`<div class="board" data-board="${b.id}" ${index ? 'hidden' : ''}>
    <p class="small muted">${b.blurb}</p>
    <ol class="board__list">
      ${rows.map(({ row, m }, i) => {
        const pct = def.better === 'lower' ? (top / m.value) * 100 : (m.value / top) * 100;
        return html`<li class="board__row">
          <span class="board__rank num">${i + 1}</span>
          <a class="board__name" href="${href(`/device/${row.id}`)}">${deviceTitle(row)}</a>
          <span class="board__bar" aria-hidden="true"><span style="width:${pct.toFixed(0)}%"></span></span>
          <span class="board__value num">${fmtMetric(def, m.value)}</span>
          ${confMeter(m.confidence, { label: false })}
        </li>`;
      })}
    </ol>
    <p class="tiny faint">${all.length === 1 ? '1 phone has' : `${all.length} phones have`} this measurement${all.length > rows.length ? `; top ${rows.length} shown` : ''}. Phones without an independent test are left out, not estimated.</p>
  </div>`;
}

function leaderboards() {
  return html`<section class="card" aria-labelledby="lb-title">
    ${sectionHead('Measured leaderboards', { eyebrow: 'Independent tests only', id: 'lb-title' })}
    <div class="seg" role="group" aria-label="Leaderboard">${BOARDS.map((b, i) => html`<button type="button" data-board-tab="${b.id}" aria-pressed="${i === 0}">${b.label}</button>`)}</div>
    <div class="boards">${BOARDS.map(board)}</div>
  </section>`;
}

function picks() {
  return html`<section aria-labelledby="picks-title">
    ${sectionHead('Best phones for…', { eyebrow: 'Platform analysis', id: 'picks-title', right: html`<a class="small" href="${href('/methodology', { section: 'scoring' })}">How picks are scored →</a>` })}
    <div class="grid grid-3 picks">
      ${PICKS.map((pid) => {
        const profile = store.profileById.get(pid);
        const top = profileLeaderboard('smartphone', pid, { limit: 3 });
        return html`<article class="card pick">
          <div class="spread"><h3>${profile.label}</h3>${provBadge('platform')}</div>
          <p class="tiny muted">${profile.description}</p>
          ${scoreBars(top.map((t, i) => {
            const inherited = Object.values(t.cats).some((c) => c.anyInherited);
            const notes = [t.result.coverage < 0.8 ? `${Math.round(t.result.coverage * 100)}% evidence` : '', inherited ? 'incl. chipset data' : ''].filter(Boolean);
            return { label: store.deviceById.get(t.id).name, href: href(`/device/${t.id}`), score: t.result.score, series: i, dim: inherited, sub: notes.join(' · ') };
          }), { stacked: true })}
          <a class="small pick__link" href="${href(`/compare/${top.map((t) => t.id).join(',')}`, { profile: pid })}">Why? Compare the top 3 →</a>
        </article>`;
      })}
    </div>
  </section>`;
}

function latest() {
  const rows = [...store.devices].sort((a, b) => (b.announced ?? '').localeCompare(a.announced ?? '')).slice(0, 8);
  return html`<section aria-labelledby="latest-title">
    ${sectionHead('Latest releases', { eyebrow: 'Newest first', id: 'latest-title', right: html`<a class="small" href="${href('/devices')}">All devices →</a>` })}
    <div class="grid grid-3">${rows.map((r) => deviceCard(r, { note: r.announced ? `Announced ${fmtDate(r.announced)}` : null }))}</div>
  </section>`;
}

function feeds() {
  const news = store.documents.filter((d) => d.kind === 'news' || d.kind === 'official').slice(0, 5);
  const videos = store.documents.filter((d) => d.kind === 'video' || d.kind === 'review' || d.kind === 'analysis').slice(0, 5);
  const list = (docs) => html`<ul class="feed-list">${docs.map((d) => html`<li class="${cardThumb({ url: d.url, devices: d.devices ?? [] }) ? 'has-thumb' : ''}">
      ${thumbLink(cardThumb({ url: d.url, devices: d.devices ?? [] }), { url: d.url, title: d.title, size: 'mini' })}
      <div class="tiny muted">${provBadge(d.class)} ${sourceName(d.testedBy ?? d.source)} · ${d.published ? relativeDate(d.published) : 'undated'}</div>
      <a class="feed-list__title" href="${d.url}" target="_blank" rel="noopener noreferrer">${d.title}</a>
      <div class="feed-list__devices">${(d.devices ?? []).slice(0, 3).map((id) => html`<a class="chip" href="${href(`/device/${id}`)}">${store.deviceById.get(id)?.name}</a>`)}</div>
    </li>`)}</ul>`;
  return html`<section class="grid grid-2">
    <div class="card">${sectionHead('Latest technology news', { level: 3, right: html`<a class="small" href="${href('/news')}">All news →</a>` })}${list(news)}</div>
    <div class="card">${sectionHead('Latest reviews, tests & videos', { level: 3, right: html`<a class="small" href="${href('/reviews')}">All reviews →</a>` })}${list(videos)}</div>
  </section>`;
}

// Newest headlines with a picture, filled in after the page renders (hidden if the collection can't be read).
function freshHeadlines() {
  return html`<section class="fresh" aria-labelledby="fresh-title" data-fresh hidden>
    ${sectionHead('Fresh from the feeds', { eyebrow: 'Collected automatically · not checked by hand', id: 'fresh-title', right: html`<a class="small" href="${href('/news')}">All headlines →</a>` })}
    <ol class="fresh__list" data-fresh-list></ol>
  </section>`;
}

async function fillFreshHeadlines(root) {
  const box = root.querySelector('[data-fresh]');
  if (!box) return;
  try {
    const data = await loadHeadlines();
    const withThumb = data.items
      .filter((i) => isSafeUrl(i.url))
      .map((i) => ({ i, thumb: cardThumb({ image: isSafeUrl(i.image) ? i.image : null, url: i.url, devices: i.devices ?? [] }) }))
      .filter((x) => x.thumb && x.thumb.kind !== 'device');
    // headlines about devices in this hub first, then the newest of the rest
    const picked = [...withThumb.filter((x) => x.i.devices?.length), ...withThumb.filter((x) => !x.i.devices?.length)].slice(0, 4)
      .sort((a, b) => String(b.i.published ?? '').localeCompare(String(a.i.published ?? '')));
    if (!picked.length || !box.isConnected) return;
    mountHtml(box.querySelector('[data-fresh-list]'), html`${picked.map(({ i, thumb }) => html`<li class="fresh__item">
      ${thumbLink(thumb, { url: i.url, title: i.title })}
      <div class="tiny muted"><a href="${href(`/source/${i.source}`)}">${sourceName(i.source)}</a>${i.published ? ` · ${timeAgo(i.published)}` : ''}</div>
      ${extLink(i.url, i.title, 'fresh__link')}
      ${(i.devices ?? []).slice(0, 2).map((id) => store.deviceById.get(id)).filter(Boolean).map((d) => html`<a class="chip" href="${href(`/device/${d.id}`)}">${d.name}</a>`)}
    </li>`)}`);
    box.hidden = false;
  } catch {
    /* no collection available: the section stays hidden */
  }
}

function chipLadder() {
  const chips = store.chipsets
    .filter((c) => c.m.gb6_multi)
    .sort((a, b) => b.m.gb6_multi[0] - a.m.gb6_multi[0])
    .slice(0, 8);
  const cell = (c, id) => {
    const v = c.m[id];
    return v ? html`<td class="num">${fmtMetric(metricDef(id), v[0])} ${confMeter({ h: 'high', m: 'medium', l: 'low' }[v[1]], { label: false })}</td>` : html`<td class="num faint">—</td>`;
  };
  return html`<section class="card card--flush" aria-labelledby="ladder-title">
    <div style="padding:var(--sp-5) var(--sp-5) 0">${sectionHead('Chipset ladder', { eyebrow: 'Consensus across sources', id: 'ladder-title', right: html`<a class="small" href="${href('/chipsets')}">All chipsets →</a>` })}</div>
    <div class="scroll-x"><table class="data-table">
      <thead><tr><th scope="col">Chipset</th><th scope="col">Process</th><th scope="col" class="num">GB6 single</th><th scope="col" class="num">GB6 multi</th><th scope="col" class="num">WLE peak</th><th scope="col" class="num">Sources</th></tr></thead>
      <tbody>${chips.map((c) => html`<tr>
        <th scope="row"><a href="${href(`/chipset/${c.id}`)}">${c.name}</a><div class="tiny muted">${c.vendorName}</div></th>
        <td class="small">${c.process ?? '—'}</td>
        ${cell(c, 'gb6_single')}${cell(c, 'gb6_multi')}${cell(c, 'wle')}
        <td class="num small">${Math.max(...Object.values(c.m).map((v) => v[2]))}</td>
      </tr>`)}</tbody>
    </table></div>
  </section>`;
}

function method() {
  return html`<section class="card card--tint method-strip" aria-labelledby="method-title">
    <div>
      <div class="eyebrow">Source transparency</div>
      <h2 id="method-title">Every value says where it came from</h2>
      <p class="muted" style="margin-top:8px;max-width:60ch">Official specifications, independent measurements, reviewer observations and platform calculations are never mixed up. When sources disagree, you see the spread, and confidence drops.</p>
    </div>
    ${legend()}
    <a class="btn" href="${href('/methodology')}">Read the methodology ${icon('arrow', { size: 16 })}</a>
  </section>`;
}

export default async function render() {
  return {
    title: 'Evidence-first technology comparison',
    html: html`<div class="stack-lg home">
      <div class="home__top">${hero()}${quickCompare()}</div>
      ${featured()}
      <div class="grid grid-2 home__boards">${leaderboards()}${chipLadder()}</div>
      ${picks()}
      ${latest()}
      ${freshHeadlines()}
      ${feeds()}
      ${method()}
    </div>`,
    mount(root) {
      fillFreshHeadlines(root);
      const form = root.querySelector('[data-hero-search]');
      bindSearchBox(form);
      root.querySelectorAll('[data-example]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const input = form.querySelector('input');
          input.value = btn.dataset.example;
          form.requestSubmit();
        }),
      );
      root.querySelectorAll('[data-board-tab]').forEach((btn) =>
        btn.addEventListener('click', () => {
          root.querySelectorAll('[data-board-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
          root.querySelectorAll('[data-board]').forEach((b) => (b.hidden = b.dataset.board !== btn.dataset.boardTab));
        }),
      );
      root.querySelector('[data-qc-go]')?.addEventListener('click', () => {
        const ids = [...root.querySelectorAll('[data-qc]')].map((s) => s.value).filter(Boolean);
        const unique = [...new Set(ids)];
        const profile = root.querySelector('[data-qc-profile]').value;
        if (unique.length < 2) {
          root.querySelector('[data-qc="1"]')?.focus();
          return;
        }
        window.location.hash = href(`/compare/${unique.join(',')}`, { profile }).slice(1);
      });
    },
  };
}
