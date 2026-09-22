// Device page: summary, platform scores with context, spec sheet with per-field provenance,
// evidence by facet, reviewer findings, videos, news, related devices and a bibliography.

import { html, mount as mountHtml } from '../lib/html.js';
import { fmtMetric, fmtDate, fmtPrice, fmtNumber, plural, timeAgo } from '../lib/format.js';
import { store, loadDevice, deviceTitle, brandName, metricDef, sourceName, categoryDef, categoryCount } from '../core/store.js';
import { href } from '../core/router.js';
import {
  icon, provBadge, confMeter, sourceLink, extLink, statusBadge, tag, compareButton, schematic, evidenceBlock, deviceMedia, photoCredit,
  fmtSpec, provenanceFor, docCard, findingItem, sectionHead, deviceCard, emptyState, pageOutline, bindOutline, pageTrail, specValue, specPath, cardThumb, thumbLink } from '../ui/components.js';
import { loadHeadlines, isSafeUrl } from '../engine/live.js';
import { scoreBars } from '../ui/charts.js';
import { allCategoryScores, rankOf, profileScore } from '../engine/scoring.js';
import { displayPrice, priceText, priceExplanation, availabilityIn } from '../engine/money.js';

const EVIDENCE_GROUPS = [
  { id: 'performance', label: 'Performance', metrics: ['gb6_single', 'gb6_multi', 'antutu_v11', 'antutu_v10'] },
  { id: 'gaming', label: 'Gaming & thermals', metrics: ['wle', 'wle_stability', 'solar_bay', 'steel_nomad_light'] },
  { id: 'battery', label: 'Battery', metrics: ['gsma_active_use', 'gsma_web', 'gsma_video', 'gsma_gaming', 'gsma_calls', 'engadget_video', 'tg_web'] },
  { id: 'charging', label: 'Charging', metrics: ['charge_full', 'charge_30', 'charge_15', 'wireless_charge_full'] },
  { id: 'display', label: 'Display', metrics: ['nits_auto', 'nits_peak', 'nits_manual'] },
  { id: 'camera', label: 'Camera', metrics: ['dxomark_camera'] },
];

const SECTIONS = [
  ['overview', 'Overview'],
  ['scores', 'Scores'],
  ['specs', 'Specifications'],
  ['evidence', 'Test results'],
  ['findings', 'Findings'],
  ['coverage', 'Reviews & videos'],
  ['news', 'News'],
  ['sources', 'Sources'],
];

function header(data, row) {
  const d = data.device;
  const cat = categoryDef(d.category);
  const dp = displayPrice(d);
  const avail = availabilityIn(d);
  const status = d.dataStatus === 'checked'
    ? html`<span class="tag tag--good" title="Key specifications cross-checked against the cited sources on ${d.provenance?.default?.checked ?? 'the last data review'}">Specs checked</span>`
    : html`<span class="tag tag--warn" title="Compiled from manufacturer launch material; not re-checked against a live source this cycle">Specs compiled: verification pending</span>`;
  const measured = Object.values(data.metrics).filter((m) => !m.inherited && m.origins?.some((o) => o.class === 'measured' || o.class === 'database')).length;
  const evidence = html`<a class="tag ${measured ? 'tag--good' : 'tag--muted'}" href="${href('/coverage')}" title="Independent measurements recorded for this device (see Evidence coverage)">${measured ? `${plural(measured, 'independent measurement')} · ${plural(data.documents.length, 'document')}` : 'No independent tests yet'}</a>`;
  return html`<header class="dhead">
    ${pageTrail([{ label: 'Home', href: href('/') }, { label: 'Devices', href: href('/devices') }, { label: cat?.name ?? 'Devices', href: href(`/devices/${d.category}`) }, { label: brandName(d.brand), href: href(`/brand/${d.brand}`) }, { label: deviceTitle(d) }])}
    <div class="dhead__grid">
      <div class="dhead__art">${deviceMedia(row, { height: 190, size: 'hero' })}${photoCredit(d.image)}</div>
      <div class="dhead__main">
        <div class="eyebrow">${brandName(d.brand)} · ${d.series ?? cat?.singular} ${statusBadge(d.status)}</div>
        <h1>${d.name}</h1>
        ${d.summary ? html`<p class="dhead__summary">${d.summary}</p>` : ''}
        ${d.highlights?.length ? html`<ul class="dhead__highlights">${d.highlights.map((h) => html`<li>${h}</li>`)}</ul>` : ''}
        <div class="dhead__facts small">
          <span><span class="muted">Announced</span> ${fmtDate(d.announced)}</span>
          ${d.released ? html`<span><span class="muted">Released</span> ${fmtDate(d.released)}</span>` : ''}
          ${data.chipset ? html`<span><span class="muted">Chipset</span> <a href="${href(`/chipset/${data.chipset.id}`)}">${data.chipset.name}</a></span>` : ''}
          ${status}
          ${evidence}
        </div>
        <div class="dhead__prices">
          ${dp && !dp.local ? html`<span class="price price--converted" title="${priceExplanation(dp)}"><span class="num">${priceText(dp)}</span> <span class="tiny muted">converted estimate</span> ${provBadge('platform')}</span>` : ''}
          ${d.prices?.length
            ? [...d.prices]
                .sort((a, b) => Number(b.currency === dp?.currency) - Number(a.currency === dp?.currency))
                .map((p) => html`<span class="price ${dp?.local && p.currency === dp.currency ? 'price--local' : ''}" title="${p.config ?? ''}${p.source ? ` · ${sourceName(p.source)}` : ''}"><span class="num">${fmtPrice(p.amount, p.currency)}</span> <span class="tiny muted">${p.region} launch${p.config ? ` · ${p.config}` : ''}</span> ${p.class && p.class !== 'official' ? provBadge(p.class) : ''}${p.url ? extLink(p.url, sourceName(p.source) ?? 'Source', 'price__src tiny') : ''}</span>`)
            : html`<span class="small muted">Launch price not recorded</span>`}
        </div>
        ${dp && !dp.local ? html`<p class="tiny muted dhead__rate">${priceExplanation(dp)}</p>` : ''}
        ${avail ? html`<p class="small dhead__avail"><strong>${avail.long}.</strong> ${avail.note ?? ''}${avail.source ? html` ${sourceLink(avail.source)}` : ''}${avail.url ? html` · ${extLink(avail.url, 'read the source')}` : ''} <span class="tiny muted">Checked ${fmtDate(avail.checked)}.</span></p>` : ''}
        <div class="row dhead__actions">
          ${compareButton(d.id)}
          ${data.related.length ? html`<a class="btn btn--ghost" href="${href(`/compare/${[d.id, ...data.related.slice(0, 2)].join(',')}`)}">${icon('swap', { size: 16 })} Compare with closest rivals</a>` : ''}
        </div>
      </div>
    </div>
  </header>`;
}

function glance(data) {
  const picks = ['gsma_active_use', 'charge_full', 'nits_auto', 'wle_stability', 'gb6_multi', 'spec_battery_mah', 'spec_battery_wh', 'spec_battery_life', 'spec_wired_w', 'spec_weight'];
  const shown = picks.map((id) => [id, data.metrics[id]]).filter(([, m]) => m).slice(0, 6);
  if (!shown.length) return '';
  return html`<div class="glance">${shown.map(([id, m]) => {
    const def = metricDef(id);
    const cls = m.inherited ? 'database' : m.classes?.includes('measured') ? 'measured' : m.classes?.[0] ?? 'official';
    return html`<div class="glance__item">
      <div class="tiny muted">${def.name}</div>
      <div class="glance__value num">${fmtMetric(def, m.value)}</div>
      <div class="row tiny">${provBadge(cls)} ${confMeter(m.confidence, { label: false, why: m.why })} ${m.inherited ? tag('chipset', 'muted') : ''}</div>
    </div>`;
  })}</div>`;
}

function scoresSection(data) {
  const d = data.device;
  const cat = categoryDef(d.category);
  const scores = allCategoryScores(data);
  const rows = Object.entries(scores).map(([id, s]) => ({ sc: store.scoreCategoryById.get(id), s, rank: rankOf(d.id, d.category, id) }));
  if (!rows.length) return emptyState('No scores yet', 'This device has no evidence in any score category.');
  const strengths = rows.filter((r) => r.rank && r.rank.of >= 5 && r.rank.percentile <= 0.2 && r.s.coverage >= 0.5);
  const weaknesses = rows.filter((r) => r.rank && r.rank.of >= 5 && r.rank.percentile >= 0.75 && r.s.coverage >= 0.5);
  const profiles = store.core.scoring.profiles
    .filter((p) => p.id !== 'balanced')
    .map((p) => ({ p, res: profileScore(scores, p, { category: d.category }) }))
    // Skip use cases that mostly weigh categories this device type doesn't have (e.g. gaming for a watch).
    .filter((x) => x.res && x.res.coverage >= 0.6 && x.res.relevance >= 0.5);
  // The metric that best explains a strength (highest weighted score) or a weakness (lowest score).
  const leading = (r, weakest = false) => {
    const sorted = [...r.s.used].sort((a, b) => (weakest ? a.score - b.score : b.score * b.w - a.score * a.w));
    const m = sorted[0];
    return m ? `${metricDef(m.id).name}: ${fmtMetric(metricDef(m.id), m.value)}` : '';
  };
  const cohortText = (r) => `#${r.rank.position} of ${r.rank.of} ${cat.name.toLowerCase()} with the same evidence`;
  return html`<div class="grid grid-2">
    <div class="card">
      <div class="card__title"><h3>Platform scores</h3>${provBadge('platform', { long: true })}</div>
      <p class="tiny muted" style="margin-bottom:12px">0–100, relative to the best consensus value among ${categoryCount(store.devices.filter((x) => x.category === d.category).length, d.category)}. Ranks (#) count only devices with the same evidence. Hatched bars include chipset stand-ins.</p>
      ${scoreBars(rows.map((r) => ({
        label: r.sc.label,
        score: r.s.score,
        text: `${fmtNumber(r.s.score)}`,
        sub: r.rank ? `#${r.rank.position}/${r.rank.of}` : '',
        dim: r.s.anyInherited,
      })))}
      <details class="small" style="margin-top:12px"><summary>What each score is based on</summary>
        <ul class="basis">${rows.map((r) => html`<li><strong>${r.sc.label}</strong> ${confMeter(r.s.confidence)} <span class="muted">${Math.round(r.s.coverage * 100)}% of evidence available · ${r.s.used.map((u) => metricDef(u.id).short).join(', ')}${r.s.specOnly ? ' · specification-based' : ''}</span>${r.sc.note ? html`<div class="tiny faint">${r.sc.note}</div>` : ''}</li>`)}</ul>
      </details>
    </div>
    <div class="card stack">
      <div>
        <h3>Strengths</h3>
        ${strengths.length ? html`<ul class="findings" style="margin-top:8px">${strengths.map((r) => findingItem({ stance: 'positive', text: `${r.sc.label}: ${cohortText(r)}. ${leading(r)}` }))}</ul>` : html`<p class="small muted">No category where it ranks in the top 20% of comparable devices.</p>`}
      </div>
      <div>
        <h3>Weaknesses</h3>
        ${weaknesses.length ? html`<ul class="findings" style="margin-top:8px">${weaknesses.map((r) => findingItem({ stance: 'negative', text: `${r.sc.label}: ${cohortText(r)}. Weakest point: ${leading(r, true)}` }))}</ul>` : html`<p class="small muted">No category where it ranks in the bottom quarter of comparable devices.</p>`}
      </div>
      <div>
        <h3>Who should buy this?</h3>
        <div class="whofor">${profiles.sort((a, b) => b.res.score - a.res.score).slice(0, 4).map((x, i) => html`<a class="whofor__item ${i === 0 ? 'is-top' : ''}" href="${href(`/devices/${d.category}`, { rank: x.p.id })}"><span>${x.p.label}</span><span class="num">${fmtNumber(x.res.score)}</span></a>`)}</div>
        <p class="tiny faint" style="margin-top:6px">Use-case fit scores (platform analysis). Select one to see the ranking for that use case.</p>
      </div>
    </div>
  </div>`;
}

function specSheet(data) {
  const d = data.device;
  const cat = categoryDef(d.category);
  const hidden = [];
  const sheet = html`<div class="specs">${cat.specSections.map((section) => {
    const rows = section.fields.map((f) => {
      const text = fmtSpec(f, specValue(d, f.key), d);
      const prov = provenanceFor(d, specPath(f.key));
      return { f, text, prov };
    });
    // Rows without a value are listed once under the section instead of as a column of "Not recorded".
    const present = rows.filter((r) => r.text !== null);
    const missing = [...new Set(rows.filter((r) => r.text === null && !present.some((p) => p.f.label === r.f.label)).map((r) => r.f.label))];
    if (!present.length) {
      hidden.push(section.label);
      return '';
    }
    return html`<section class="spec-card" aria-labelledby="spec-${section.id}">
      <h3 id="spec-${section.id}">${section.label}</h3>
      <table class="spec-table"><tbody>
        ${present.map(({ f, text, prov }) => html`<tr>
          <th scope="row">${f.label}</th>
          <td>${text}</td>
          <td class="spec-table__prov"><span title="${sourceName(prov.source)}${prov.note ? ` · ${prov.note}` : ''}">${provBadge(prov.class)}</span></td>
        </tr>`)}
      </tbody></table>
      ${missing.length ? html`<p class="spec-card__missing tiny faint">Not stated by the sources: ${missing.join(', ')}</p>` : ''}
    </section>`;
  })}</div>`;
  return html`${sheet}
  ${hidden.length ? html`<p class="tiny faint" style="margin-top:8px">No ${hidden.join(', ').toLowerCase()} details are recorded for this device yet.</p>` : ''}
  <p class="tiny muted" style="margin-top:12px">Default source: ${sourceLink(d.provenance?.default?.source)}${d.provenance?.default?.url ? html` · ${extLink(d.provenance.default.url, 'specification page')}` : ''}${d.provenance?.default?.note ? html` · ${d.provenance.default.note.replace(/[.\s]+$/, '')}` : ''}. Rows with a different badge come from a more specific source; hover a badge for details.</p>`;
}

function claimedVsMeasured(data) {
  const claimed = data.metrics.spec_peak_nits;
  const measured = data.metrics.nits_peak;
  if (!claimed || !measured) return '';
  const diff = ((measured.value - claimed.value) / claimed.value) * 100;
  return html`<div class="cvm small">
    <strong>Claimed vs measured peak brightness:</strong>
    ${provBadge('official')} <span class="num">${fmtNumber(claimed.value)} nits</span>
    <span class="faint">→</span>
    ${provBadge('measured')} <span class="num">${fmtNumber(measured.value)} nits</span>
    <span class="${diff >= -5 ? 'good' : 'bad'}">(${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%)</span>
  </div>`;
}

function evidenceSection(data) {
  const groups = EVIDENCE_GROUPS.map((g) => ({ ...g, present: g.metrics.filter((id) => data.metrics[id]) })).filter((g) => g.present.length);
  const tests = data.headToHead ?? [];
  if (!groups.length && !tests.length) {
    return emptyState('No independent test results yet', 'This device only has specification data. Measurements appear here as soon as a lab or reviewer result is added.');
  }
  return html`
    ${claimedVsMeasured(data)}
    <div class="grid grid-2">${groups.map((g) => html`<section class="card">
      <div class="card__title"><h3>${g.label}</h3><span class="tiny muted">${plural(g.present.length, 'metric')}</span></div>
      ${g.present.map((id) => evidenceBlock(metricDef(id), data.metrics[id]))}
    </section>`)}</div>
    ${tests.length ? html`<section class="card" style="margin-top:var(--sp-4)">
      <div class="card__title"><h3>Same-test comparisons</h3><span class="tiny muted">Only comparable within each test</span></div>
      ${tests.map((t) => headToHeadTable(t, data.device.id))}
    </section>` : ''}`;
}

export function headToHeadTable(t, highlightId, highlightSet) {
  const def = metricDef(t.metric);
  const doc = store.docById.get(t.doc ?? t.docId);
  const entries = t.all ?? t.entries;
  const top = entries[0]?.value;
  return html`<div class="h2h">
    <div class="small"><strong>${def.name}</strong> · ${sourceLink(doc?.testedBy ?? doc?.source)} ${doc ? html`· ${extLink(doc.url, doc.title)}` : ''}</div>
    <ol class="board__list">${entries.map((e, i) => {
      const row = store.deviceById.get(e.subject);
      const chip = row ? null : store.chipsetById.get(e.subject);
      const on = e.subject === highlightId || highlightSet?.has(e.subject);
      const pct = def.better === 'lower' ? (top / e.value) * 100 : (e.value / top) * 100;
      return html`<li class="board__row ${on ? 'is-self' : ''}">
        <span class="board__rank num">${i + 1}</span>
        <a class="board__name" href="${href(row ? `/device/${e.subject}` : `/chipset/${e.subject}`)}">${row ? deviceTitle(row) : chip?.name ?? e.subject}</a>
        <span class="board__bar" aria-hidden="true"><span style="width:${pct.toFixed(0)}%"></span></span>
        <span class="board__value num">${fmtMetric(def, e.value)}</span>
      </li>`;
    })}</ol>
  </div>`;
}

function findingsSection(data) {
  const byFacet = new Map();
  for (const doc of data.documents) {
    for (const f of doc.findings ?? []) {
      if (!byFacet.has(f.facet)) byFacet.set(f.facet, []);
      byFacet.get(f.facet).push({ f, doc });
    }
  }
  if (!byFacet.size) return emptyState('No reviewer findings extracted yet', 'Videos and reviews linked below are recorded, but their findings have not been extracted into structured data.');
  return html`<div class="grid grid-2">${[...byFacet.entries()].map(([facet, items]) => html`<section class="card">
    <h3 style="margin-bottom:10px">${store.facetById.get(facet)?.label ?? facet}</h3>
    <ul class="findings">${items.map(({ f, doc }) => findingItem(f, doc))}</ul>
  </section>`)}</div>`;
}

function coverageSection(data) {
  const docs = data.documents.filter((d) => d.kind !== 'news' && d.kind !== 'official');
  const videos = docs.filter((d) => d.kind === 'video');
  const other = docs.filter((d) => d.kind !== 'video');
  if (!docs.length) return emptyState('No reviews or videos linked yet');
  return html`
    ${videos.length ? html`<h3 class="subhead">YouTube analysis <span class="tiny muted">${plural(videos.length, 'video')}</span></h3><div class="grid grid-3">${videos.map((doc) => docCard(doc, { showSubjects: false }))}</div>` : ''}
    ${other.length ? html`<h3 class="subhead">Lab reviews & technical analysis <span class="tiny muted">${plural(other.length, 'document')}</span></h3><div class="grid grid-3">${other.map((doc) => docCard(doc, { showSubjects: false }))}</div>` : ''}
    ${data.chipsetDocuments?.length ? html`<p class="small muted" style="margin-top:12px">${plural(data.chipsetDocuments.length, 'more document')} about the ${data.chipset.name} are on the <a href="${href(`/chipset/${data.chipset.id}`)}">chipset page</a>.</p>` : ''}`;
}

// Recent headlines that name this device (collected automatically), filled in after the page renders.
const headlineStrip = () => html`<div class="dev-headlines" data-dev-headlines hidden>
  <h3 class="subhead">In the headlines <span class="tiny muted">collected automatically · not checked by hand</span></h3>
  <ol class="fresh__list" data-dev-headlines-list></ol>
</div>`;

async function fillHeadlines(root, id) {
  const box = root.querySelector('[data-dev-headlines]');
  if (!box) return;
  try {
    const items = (await loadHeadlines()).items.filter((i) => isSafeUrl(i.url) && (i.devices ?? []).includes(id)).slice(0, 4);
    if (!items.length || !box.isConnected) return;
    mountHtml(box.querySelector('[data-dev-headlines-list]'), html`${items.map((i) => html`<li class="fresh__item">
      ${thumbLink(cardThumb({ image: isSafeUrl(i.image) ? i.image : null, url: i.url }, { allowDevice: false }), { url: i.url, title: i.title })}
      <div class="tiny muted"><a href="${href(`/source/${i.source}`)}">${sourceName(i.source)}</a>${i.published ? ` · ${timeAgo(i.published)}` : ''}</div>
      ${extLink(i.url, i.title, 'fresh__link')}
    </li>`)}`);
    box.hidden = false;
  } catch {
    /* no collection available: nothing to add */
  }
}

function newsSection(data) {
  const news = data.documents.filter((d) => d.kind === 'news' || d.kind === 'official');
  if (!news.length) return html`${headlineStrip()}${emptyState('No checked news linked to this device yet')}`;
  return html`${headlineStrip()}<ol class="timeline">${news.map((doc) => html`<li class="timeline__item">
    <div class="timeline__date tiny num">${doc.published ? `${doc.publishedApprox ? 'c. ' : ''}${fmtDate(doc.published)}` : '—'}</div>
    <div class="timeline__body">
      <div class="row tiny">${provBadge(doc.class)} ${tag(store.core.taxonomy.newsTypes.find((t) => t.id === doc.type)?.label ?? 'News')} ${doc.region ? tag(doc.region, 'muted') : ''} ${sourceLink(doc.testedBy ?? doc.source)}</div>
      <h3 class="small" style="margin-top:4px">${extLink(doc.url, doc.title)}</h3>
      ${doc.summary ? html`<p class="small muted">${doc.summary}</p>` : ''}
    </div>
  </li>`)}</ol>`;
}

function sourcesSection(data) {
  const d = data.device;
  const specSources = new Map();
  const add = (p) => p?.source && !specSources.has(p.source + (p.url ?? '')) && specSources.set(p.source + (p.url ?? ''), p);
  add(d.provenance?.default);
  Object.values(d.provenance?.fields ?? {}).forEach(add);
  (d.prices ?? []).forEach((p) => add({ source: p.source, url: p.url, class: p.class ?? 'official', note: `Price (${p.region})` }));
  return html`<div class="table-wrap"><table class="data-table">
    <thead><tr><th scope="col">Type</th><th scope="col">Source</th><th scope="col">Document</th><th scope="col">Date</th><th scope="col" class="num">Records</th></tr></thead>
    <tbody>
      ${[...specSources.values()].map((p) => html`<tr><td>${provBadge(p.class ?? 'official')}</td><td>${sourceLink(p.source)}</td><td class="small">${p.url ? extLink(p.url, p.note ?? 'Specification') : p.note ?? 'Specification'}</td><td class="small">${p.checked ? `Checked ${fmtDate(p.checked)}` : '—'}</td><td class="num">—</td></tr>`)}
      ${data.documents.map((doc) => html`<tr><td>${provBadge(doc.class)}</td><td>${sourceLink(doc.testedBy ?? doc.source)}${doc.testedBy ? html`<div class="tiny muted">via ${sourceName(doc.source)}</div>` : ''}</td><td class="small">${extLink(doc.url, doc.title)}</td><td class="small nowrap">${doc.published ? `${doc.publishedApprox ? 'c. ' : ''}${fmtDate(doc.published)}` : '—'}</td><td class="num">${doc.records?.length || '—'}</td></tr>`)}
      ${d.image ? html`<tr><td>${tag(d.image.kind === 'drawing' ? 'drawing' : 'photo', 'muted')}</td><td>${extLink('https://commons.wikimedia.org', 'Wikimedia Commons')}</td><td class="small">${extLink(d.image.page, d.image.title ?? 'Device photo')}<div class="tiny muted">${[d.image.author, d.image.license].filter(Boolean).join(' · ')}</div></td><td class="small">${d.image.checked ? `Checked ${fmtDate(d.image.checked)}` : '—'}</td><td class="num">—</td></tr>` : ''}
    </tbody></table></div>`;
}

function related(data) {
  const rows = data.related.map((id) => store.deviceById.get(id)).filter(Boolean);
  if (!rows.length) return '';
  return html`<section>${sectionHead('Similar devices', { eyebrow: 'Same category, price and generation' })}<div class="grid grid-3">${rows.map((r) => deviceCard(r))}</div></section>`;
}

/** Invitation to the built-in assistant with questions about this device (they open the "Ask the hub" panel). */
function askCard(row) {
  const wear = row.category === 'smartwatch' || row.category === 'band';
  const qs = wear
    ? ['How long does its battery last?', 'Is it water resistant?', 'What does it cost in Malaysia?', 'Compare it with its rivals']
    : ['What are its battery and charging?', 'What does it cost in Malaysia?', 'How good is its camera hardware?', 'Compare it with its rivals'];
  return html`<section class="askcard" aria-labelledby="askcard-h">
    <div><h2 id="askcard-h" class="askcard__title">${icon('chat', { size: 18 })} Ask about the ${deviceTitle(row)}</h2>
    <p class="small muted">Quick answers from this page's data, with sources. Not an AI chatbot: it won't guess.</p></div>
    <div class="askcard__qs">${qs.map((q) => html`<button type="button" class="ask__chip" data-ask-question="${q}">${q}</button>`)}</div>
  </section>`;
}

export default async function render({ params }) {
  const [id] = params;
  const row = store.deviceById.get(id);
  if (!row) {
    const err = new Error(`No device with the id "${id}" is in the database.`);
    err.status = 404;
    throw err;
  }
  const data = await loadDevice(id);
  const d = data.device;
  const sec = (sid, title, body, extra = '') => html`<section class="dsec" id="${sid}" aria-labelledby="${sid}-h">${sectionHead(title, { id: `${sid}-h`, right: extra })}${body}</section>`;
  return {
    title: deviceTitle(row),
    html: html`<article class="device">
      ${header(data, row)}
      <div class="with-outline dbody">
      ${pageOutline(SECTIONS)}
      <div class="with-outline__main stack-lg">
        ${sec('overview', 'At a glance', glance(data) || html`<p class="muted">No evidence recorded yet.</p>`, html`<a class="small" href="${href('/methodology', { section: 'confidence' })}">Reading the badges →</a>`)}
        ${sec('scores', 'How it scores', scoresSection(data))}
        ${sec('specs', 'Specifications', specSheet(data))}
        ${sec('evidence', 'Test results & benchmarks', evidenceSection(data))}
        ${sec('findings', 'Reviewer findings', findingsSection(data))}
        ${sec('coverage', 'Reviews & YouTube analysis', coverageSection(data))}
        ${sec('news', 'Technology news', newsSection(data))}
        ${related(data)}
        ${askCard(row)}
        ${sec('sources', 'Sources', sourcesSection(data), html`<span class="tiny muted">${plural(data.documents.length, 'document')}</span>`)}
      </div>
      </div>
    </article>`,
    mount(root) {
      fillHeadlines(root, d.id);
      return bindOutline(root);
    },
  };
}

