// Evidence coverage: what the database knows and what it does not. Gaps are shown, not hidden,
// so readers can judge how much to trust a verdict and contributors know what to test next.

import { html, mount as mountHtml } from '../lib/html.js';
import { fmtNumber, fmtDate, plural } from '../lib/format.js';
import { store, loadCoverage, metricDef, deviceTitle, sourceName, categoryCount } from '../core/store.js';
import { href } from '../core/router.js';
import { sectionHead, sourceLink, tag, provBadge, emptyState, pageOutline, bindOutline, pageTrail, extLink } from '../ui/components.js';
import { scoreBars } from '../ui/charts.js';

function stackBar(row, total) {
  const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;
  return html`<div class="stackbar" role="img" aria-label="${plural(row.direct, 'device')} measured directly, ${row.inherited} using a chipset stand-in, ${row.none} with no data">
    <span class="stackbar__direct" style="width:${pct(row.direct)}"></span>
    <span class="stackbar__inherited" style="width:${pct(row.inherited)}"></span>
  </div>`;
}

function categoryMatrix(catId, cat) {
  const def = store.categoryById.get(catId);
  if (!cat.metrics.length) {
    return html`<section class="card"><h3>${def.name}</h3><p class="small muted" style="margin-top:6px">No independent measurements yet for ${categoryCount(cat.devices, catId)}. Scores in this category rely on manufacturer specifications.</p></section>`;
  }
  return html`<section class="card">
    <div class="card__title"><h3>${def.name}</h3><span class="small"><strong class="num">${cat.tested}</strong><span class="muted"> of ${cat.devices} have independent test data</span></span></div>
    <div class="cov-rows">${cat.metrics.map((row) => html`<div class="cov-row">
      <span class="cov-row__name small">${metricDef(row.id)?.name ?? row.id}</span>
      ${stackBar(row, cat.devices)}
      <span class="cov-row__num tiny num">${row.direct}<span class="muted"> / ${cat.devices}</span></span>
    </div>`)}</div>
    <p class="tiny muted cov-legend"><span class="stackbar__key stackbar__direct"></span>Measured on the device <span class="stackbar__key stackbar__inherited"></span>Chipset stand-in <span class="stackbar__key"></span>No data</p>
  </section>`;
}

export default async function render() {
  const cov = await loadCoverage();
  const phones = cov.devices.filter((d) => d.category === 'smartphone');
  const untested = cov.devices.filter((d) => !d.direct);
  const gaps = phones.filter((d) => d.direct && d.keyMissing.length).sort((a, b) => b.keyMissing.length - a.keyMissing.length);
  const pending = cov.devices.filter((d) => d.dataStatus !== 'checked');
  const totalRecords = cov.sources.reduce((s, x) => s + x.records, 0);
  const counts = store.core.build.counts;
  const extraction = cov.extraction;

  return {
    title: 'Evidence coverage',
    html: html`<div class="stack-lg coverage">
      ${pageTrail([{ label: 'Home', href: href('/') }, { label: 'Evidence coverage' }])}
      <header>
        <div class="eyebrow">Transparency</div>
        <h1>Evidence coverage</h1>
        <p class="muted" style="margin-top:8px;max-width:72ch">What the database knows, and what it doesn't yet. A verdict is only as good as the evidence behind it, so the gaps are listed here rather than filled with guesses.</p>
      </header>

      <div class="with-outline">
      ${pageOutline([
        ['cov-measurements', 'Measurements by category'],
        ['cov-untested', 'Needs independent testing'],
        ['cov-gaps', 'Missing key phone tests'],
        ['cov-origins', 'Who the evidence comes from'],
        ['cov-pipeline', 'Pipeline status'],
        ['cov-spotted', 'New models spotted'],
        ['cov-howto', 'How to close a gap'],
      ])}
      <div class="with-outline__main stack-lg">
      <dl class="cov-stats">
        <div><dt>Devices with independent tests</dt><dd class="num">${cov.devices.filter((d) => d.direct).length}<span class="muted"> / ${counts.devices}</span></dd></div>
        <div><dt>Evidence records</dt><dd class="num">${fmtNumber(totalRecords)}</dd></div>
        <div><dt>Source documents</dt><dd class="num">${counts.documents}</dd></div>
        <div><dt>Reviewer findings</dt><dd class="num">${counts.findings}</dd></div>
        <div><dt>Specs pending verification</dt><dd class="num">${pending.length}</dd></div>
      </dl>

      <section id="cov-measurements">
        ${sectionHead('Measurements by category', { eyebrow: 'How many devices have each result' })}
        <div class="grid grid-2">${Object.entries(cov.categories).map(([id, cat]) => categoryMatrix(id, cat))}</div>
      </section>

      <div class="grid grid-2">
        <section class="card" id="cov-untested">
          ${sectionHead('Needs independent testing', { level: 3, right: html`<span class="tiny muted">${plural(untested.length, 'device')}</span>` })}
          <p class="small muted" style="margin-bottom:10px">No lab or database measurement yet. These devices are compared on specifications and chipset stand-ins only.</p>
          ${untested.length ? html`<ul class="gap-list">${untested.map((d) => {
            const row = store.deviceById.get(d.id);
            return html`<li><a href="${href(`/device/${d.id}`)}">${deviceTitle(row)}</a> <span class="tiny muted">${store.categoryById.get(d.category)?.singular}${d.inherited ? ` · ${d.inherited} chipset stand-ins` : ''}${d.documents ? ` · ${plural(d.documents, 'document')}` : ''}</span></li>`;
          })}</ul>` : emptyState('Every device has at least one independent measurement')}
        </section>
        <section class="card" id="cov-gaps">
          ${sectionHead('Missing key phone tests', { level: 3, right: html`<span class="tiny muted">Tested phones with gaps</span>` })}
          <p class="small muted" style="margin-bottom:10px">Key tests: ${cov.keyMetrics.smartphone.map((id) => metricDef(id)?.short).join(', ')}.</p>
          <ul class="gap-list">${gaps.slice(0, 14).map((d) => html`<li>
            <a href="${href(`/device/${d.id}`)}">${deviceTitle(store.deviceById.get(d.id))}</a>
            <span class="gap-list__missing">${d.keyMissing.map((id) => tag(metricDef(id)?.short ?? id, 'muted'))}</span>
          </li>`)}</ul>
        </section>
      </div>

      <div class="grid grid-2">
        <section class="card" id="cov-origins">
          ${sectionHead('Who the evidence comes from', { level: 3, right: html`<span class="tiny muted">Records by original tester</span>` })}
          ${scoreBars(cov.sources.slice(0, 10).map((s) => ({ label: sourceName(s.id), href: href(`/source/${s.id}`), score: (s.records / cov.sources[0].records) * 100, text: fmtNumber(s.records) })), { stacked: true })}
          <p class="tiny muted" style="margin-top:10px">A single lab supplying most records is a concentration risk; adding more independent testers raises confidence across the board.</p>
        </section>
        <section class="card stack" id="cov-pipeline">
          ${sectionHead('Pipeline status', { level: 3 })}
          <dl class="kv">
            <div><dt>Fully extracted documents</dt><dd class="num">${extraction.complete ?? 0}</dd></div>
            <div><dt>Partly extracted</dt><dd class="num">${extraction.partial ?? 0}</dd></div>
            <div><dt>Metadata only</dt><dd class="num">${extraction['metadata-only'] ?? 0}</dd></div>
          </dl>
          <p class="small">${provBadge('database')} ${plural(cov.excerptDocuments, 'document')} rely on search excerpts and are waiting to be re-read at the source.</p>
          <p class="small">Registered sources with no data yet: ${cov.planned.map((id) => html`${sourceLink(id)} `)}</p>
          <p class="small">Spec sheets compiled from launch material and not yet re-checked: <strong>${pending.length}</strong>. Their device pages carry a “Specs compiled” label.</p>
        </section>
      </div>

      <section class="card stack" id="cov-spotted" data-spotted hidden>
        ${sectionHead('New models spotted in the news', { level: 3, right: html`<span class="tiny muted">Named by two or more sources · not in the hub yet</span>` })}
        <p class="small muted">The headline collector looks for model names that several sources mention but the hub doesn't have yet. They are added once the maker publishes specifications, so this list is also a preview of what is coming.</p>
        <ul class="spotted" data-spotted-list></ul>
        <p class="tiny muted" data-spotted-when></p>
      </section>

      <section class="card card--tint" id="cov-howto">
        <h3>How to close a gap</h3>
        <ol class="rules small">
          <li>Find a test with a documented method (a lab review, a benchmark database page, a reviewer's same-conditions test).</li>
          <li>Add it as a document in <code>data/reviews</code>, <code>data/benchmarks</code> or <code>data/videos</code>, crediting the original tester.</li>
          <li>Run <code>python tools/build.py --report</code> to validate it and see the updated coverage.</li>
        </ol>
        <p class="tiny muted" style="margin-top:8px">Build ${fmtDate(store.core.build.time.slice(0, 10))}. See <a href="${href('/methodology', { section: 'confidence' })}">how coverage affects confidence</a>.</p>
      </section>
      </div>
      </div>
    </div>`,
    mount(root) {
      fillSpotted(root);
      return bindOutline(root);
    },
  };
}

// Version 17: model names the headline collector saw in several sources that match nothing in the hub (live/spotted.json).
async function fillSpotted(root) {
  const box = root.querySelector('[data-spotted]');
  if (!box) return;
  try {
    const res = await fetch(`live/spotted.json?t=${Math.floor(Date.now() / 600000)}`, { cache: 'no-cache' });
    if (!res.ok) return;
    const data = await res.json();
    const models = (data.models ?? []).filter((m) => m.name);
    if (!models.length || !box.isConnected) return;
    const safe = (u) => /^https?:\/\//i.test(u ?? '');
    mountHtml(box.querySelector('[data-spotted-list]'), html`${models.map((m) => html`<li class="spotted__item">
      <strong>${m.name}</strong> <span class="tiny muted">${plural(m.count, 'headline')} · ${m.sources.map((id) => sourceName(id)).join(', ')}</span>
      ${(m.examples ?? []).filter((e) => safe(e.url)).slice(0, 2).map((e) => html`<div class="small">${extLink(e.url, e.title)}</div>`)}
    </li>`)}`);
    if (data.updatedAt) box.querySelector('[data-spotted-when]').textContent = `Checked ${fmtDate(data.updatedAt.slice(0, 10))}.`;
    box.hidden = false;
  } catch {
    /* no list published: the section stays hidden */
  }
}
