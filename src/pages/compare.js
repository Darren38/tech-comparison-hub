// Compare page: key differences, like-for-like verdicts per category, preset or custom use-case
// weighting, size comparison, same-test results, benchmark and spec tables, reviewer findings,
// a bibliography of every source used, and an AI-ready evidence pack.

import { html, mount } from '../lib/html.js';
import { sizeView, bindSize } from '../ui/size.js';
import { autoSlot, fillAuto } from '../ui/autolinks.js';
import { fmtMetric, fmtNumber, fmtDate, plural } from '../lib/format.js';
import { selectedCurrency } from '../engine/money.js';
import { store, loadDevice, deviceTitle, metricDef, categoryDef, sourceName } from '../core/store.js';
import { href, navigate, setQuery } from '../core/router.js';
import { compareTray, MAX_COMPARE } from '../core/state.js';
import {
  icon, provBadge, confMeter, seriesMark, schematic, fmtSpec, specNumeric, provenanceFor, sectionHead,
  findingItem, tag, statusBadge, sourceLink, extLink, priceTag, pageOutline, bindOutline, pageTrail, specValue, specPath } from '../ui/components.js';

// "Jump to" bar: heading ids of the comparison's sections (absent ones are hidden automatically).
const CMP_SECTIONS = [
  ['overall-h', 'Verdict'],
  ['kd-h', 'Key differences'],
  ['cats-h', 'Categories'],
  ['size-h', 'Size'],
  ['tests-h', 'Same-test results'],
  ['bench-h', 'Benchmarks'],
  ['spec-h', 'Specifications'],
  ['find-h', 'Findings'],
  ['latest-h', 'Latest'],
  ['src-h', 'Sources'],
];
import { scoreBars, miniMeter } from '../ui/charts.js';
import { buildComparison, keyDifferences, sourcesUsed } from '../engine/compare.js';
import { customProfile, applicableScoreCategories } from '../engine/scoring.js';
import { buildEvidencePack } from '../engine/evidencePack.js';
import { search } from '../engine/search.js';
import { headToHeadTable } from './device.js';

const nameOf = (id) => store.deviceById.get(id)?.name ?? id;
const MAX_WEIGHT = 5;

// ------------------------------------------------------------------ custom weights
function parseWeights(text) {
  const out = {};
  for (const part of String(text ?? '').split(',')) {
    const [k, v] = part.split(':');
    const n = Number(v);
    if (k && Number.isFinite(n)) out[k] = Math.max(0, Math.min(MAX_WEIGHT, Math.round(n)));
  }
  return out;
}

const serializeWeights = (weights) => Object.entries(weights).map(([k, v]) => `${k}:${v}`).join(',');

/** Starting point for the sliders: the balanced profile mapped onto a 0–5 scale. */
function defaultWeights(category) {
  const balanced = store.profileById.get('balanced').weights;
  const out = {};
  for (const sc of applicableScoreCategories(category)) out[sc.id] = Math.max(0, Math.min(MAX_WEIGHT, Math.round((balanced[sc.id] ?? 0) * 20)));
  out.value = 0;
  return out;
}

function weightsPanel(weights, category) {
  const cats = [...applicableScoreCategories(category).map((sc) => [sc.id, sc.label]), ['value', 'Value for money']];
  return html`<fieldset class="card weights" data-weights>
    <legend class="weights__legend">Your weighting <span class="tiny muted">0 = ignore · ${MAX_WEIGHT} = most important. Only the overall verdict changes; category verdicts are unaffected.</span></legend>
    <div class="weights__grid">${cats.map(([id, label]) => html`<label class="weight">
      <span class="weight__label">${label}</span>
      <input type="range" min="0" max="${MAX_WEIGHT}" step="1" name="${id}" value="${weights[id] ?? 0}" aria-valuetext="${weights[id] ?? 0} of ${MAX_WEIGHT}" />
      <output class="num weight__value" for="">${weights[id] ?? 0}</output>
    </label>`)}</div>
  </fieldset>`;
}

// ------------------------------------------------------------------ empty state / picker
function pickerPage(selected) {
  const tray = compareTray.ids.filter((id) => store.deviceById.has(id) && !selected.includes(id));
  return html`<div class="stack-lg">
    ${pageTrail([{ label: 'Home', href: href('/') }, { label: 'Compare' }])}
    <header><div class="eyebrow">Comparison engine</div><h1>Compare devices</h1>
      <p class="muted" style="margin-top:8px;max-width:64ch">Pick two to four devices. Verdicts use only evidence every device shares, and each one explains why it went the way it did.</p></header>
    <div class="card">
      ${selected.length ? html`<p class="small" style="margin-bottom:12px">Selected: ${selected.map((id, i) => html`<span class="chip">${seriesMark(i)} ${nameOf(id)}</span> `)} <span class="muted">Add at least one more.</span></p>` : ''}
      <div class="picker" data-picker>
        <label class="field__label" for="picker-input">${selected.length ? 'Add another device' : 'Add a device'}</label>
        <div class="searchbox">${icon('search', { size: 16 })}<input id="picker-input" type="search" placeholder="Type a device name…" autocomplete="off" /></div>
        <ul class="picker__list" hidden></ul>
      </div>
      ${tray.length ? html`<p class="small" style="margin-top:12px">Also in your comparison tray: ${tray.map((id) => html`<span class="chip">${nameOf(id)}</span> `)} <a class="btn btn--sm btn--accent" href="${href(`/compare/${[...selected, ...tray].slice(0, MAX_COMPARE).join(',')}`)}">Use these</a></p>` : ''}
    </div>
    <section>${sectionHead('Or start from a curated comparison', { level: 3 })}
      <div class="grid grid-4">${store.core.featured.map((f) => html`<a class="feature" href="${href(`/compare/${f.devices.join(',')}`, { profile: f.profile })}">
        <div class="feature__devices">${f.devices.map((id, i) => html`<span class="feature__dev">${seriesMark(i)}<span>${nameOf(id)}</span></span>`)}</div>
        <h3>${f.title}</h3><p class="small muted">${f.blurb}</p></a>`)}</div>
    </section>
  </div>`;
}

function bindPicker(root, currentIds, profileId) {
  const wrap = root.querySelector('[data-picker]');
  if (!wrap) return;
  const input = wrap.querySelector('input');
  const list = wrap.querySelector('.picker__list');
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) {
        list.hidden = true;
        return;
      }
      const results = (await search(q, { types: ['device'], limit: 8 })).filter((r) => !currentIds.includes(r.id));
      mount(list, results.length
        ? html`${results.map((r) => html`<li><button type="button" data-pick="${r.id}"><strong>${r.title}</strong> <span class="tiny muted">${r.sub}</span></button></li>`)}`
        : html`<li class="small muted" style="padding:8px">No matching devices</li>`);
      list.hidden = false;
    }, 100);
  });
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick]');
    if (!btn) return;
    const ids = [...currentIds, btn.dataset.pick].slice(0, MAX_COMPARE);
    compareTray.set(ids);
    // With one device the URL still changes (/compare/<id>), so the picker re-renders showing the selection.
    navigate(`/compare/${ids.join(',')}`, profileId ? { profile: profileId } : undefined);
  });
}

// ------------------------------------------------------------------ sections
function deviceHeads(entities, ids) {
  return html`<div class="cmp-heads" style="--n:${entities.length}">
    ${entities.map((e, i) => {
      const row = store.deviceById.get(e.device.id);
      return html`<div class="cmp-head">
        <div class="cmp-head__top">${seriesMark(i)}<button type="button" class="icon-btn" data-remove="${e.device.id}" aria-label="Remove ${deviceTitle(row)}">${icon('close', { size: 14 })}</button></div>
        <a class="cmp-head__name" href="${href(`/device/${row.id}`)}">${deviceTitle(row)}</a>
        <div class="tiny muted">${row.chipsetName ?? ''} ${statusBadge(row.status)}</div>
        <div class="tiny">${priceTag(row)}</div>
      </div>`;
    })}
    ${ids.length < MAX_COMPARE ? html`<div class="cmp-head cmp-head--add" data-picker>
      <label class="field__label" for="picker-input">Add device</label>
      <div class="searchbox">${icon('plus', { size: 16 })}<input id="picker-input" type="search" placeholder="Search…" autocomplete="off" /></div>
      <ul class="picker__list" hidden></ul>
    </div>` : ''}
  </div>`;
}

function profileControls(profileId) {
  return html`<div class="cmp-controls">
    <span class="small muted">Weight the overall verdict for</span>
    <div class="seg" role="group" aria-label="Use case">
      ${store.core.scoring.profiles.map((p) => html`<button type="button" data-profile="${p.id}" aria-pressed="${p.id === profileId}" title="${p.description}">${p.label}</button>`)}
      <button type="button" data-profile="custom" aria-pressed="${profileId === 'custom'}" title="Set your own weights">Custom…</button>
    </div>
  </div>`;
}

function overallPanel(cmp, entities) {
  const ids = entities.map((e) => e.device.id);
  const series = (id) => ids.indexOf(id);
  const o = cmp.overall;
  const catLabel = (id) => (id === 'value' ? 'Value' : store.scoreCategoryById.get(id)?.label ?? id);
  // "better pick for gaming", "for most buyers" (not "for balanced"), "for your weighting".
  const label = { custom: 'your weighting', balanced: 'most buyers' }[cmp.profile.id] ?? cmp.profile.label.toLowerCase();
  return html`<section class="card verdict-main" aria-labelledby="overall-h" aria-live="polite">
    <div class="verdict-main__grid">
      <div>
        <div class="row">${provBadge('platform', { long: true })}<span class="tiny muted">${cmp.profile.label} weighting · ${cmp.profile.description}</span></div>
        <h2 id="overall-h" style="margin-top:10px">${o
          ? o.verdict === 'tie'
            ? html`Too close to call for ${label}`
            : html`${seriesMark(series(o.winner))} ${nameOf(o.winner)} is the better pick for ${label}`
          : 'Not enough shared evidence for an overall verdict'}</h2>
        ${o ? html`<p class="muted" style="margin-top:8px">${o.verdict === 'tie' ? `${nameOf(o.winner)} and ${nameOf(o.runnerUp)} are within ${store.core.scoring.verdict.tieMargin} points of each other.` :`Leads ${nameOf(o.runnerUp)} by ${o.margin.toFixed(0)} points${o.decisive.length ? `, driven mostly by ${o.decisive.map((d) => catLabel(d.id).toLowerCase()).join(', ')}` : ''}.`} ${confMeter(o.confidence)}</p>` : ''}
        ${cmp.value.currency ? html`<p class="tiny muted" style="margin-top:6px">Value uses the ${cmp.value.currency} launch prices recorded for every device here. Converted prices are never used for value.</p>` : html`<p class="tiny muted" style="margin-top:6px">Value isn't scored: these devices have no launch price in a common currency, and converted prices would ignore regional pricing.</p>`}
        ${cmp.notes.map((n) => html`<p class="note small">${icon('info', { size: 14 })} ${n}</p>`)}
      </div>
      <div>${scoreBars(cmp.profileResults.map((r) => ({ label: nameOf(r.id), series: series(r.id), score: r.result.score, win: o && o.verdict === 'winner' && r.id === o.winner, sub: r.result.coverage < 0.8 ? `${Math.round(r.result.coverage * 100)}% evidence` : '' })))}</div>
    </div>
  </section>`;
}

function keyDiffSection(diffs, entities) {
  if (!diffs.length) return '';
  const ids = entities.map((e) => e.device.id);
  return html`<section class="card keydiffs" aria-labelledby="kd-h">
    ${sectionHead('Key differences', { id: 'kd-h', level: 3, right: html`<span class="tiny muted">Biggest real gaps · ${provBadge('measured')} independent test · ${provBadge('official')} specification</span>` })}
    <ul class="keydiffs__list">${diffs.map((d) => {
      const pct = Math.round(d.gap * 100);
      const direction = d.def.better === 'lower' ? 'lower' : 'higher';
      return html`<li class="keydiff">
        <span class="keydiff__who">${seriesMark(ids.indexOf(d.best))}</span>
        <div>
          <p><strong>${nameOf(d.best)}</strong> leads on <strong>${d.def.name}</strong>: <span class="num">${fmtMetric(d.def, d.bestValue)}</span> vs <span class="num">${fmtMetric(d.def, d.nextValue)}</span> for ${nameOf(d.next)}${d.def.unit === 'years' ? '' : ` (${pct}% ${direction})`}.</p>
          <p class="tiny muted">${provBadge(d.measured ? 'measured' : 'official')} ${d.sources.length ? d.sources.join(', ') : d.measured ? '' : 'Manufacturer specification'} ${confMeter(d.confidence, { label: false })}${d.missing ? ` · no data for ${plural(d.missing, 'device')}` : ''}</p>
        </div>
      </li>`;
    })}</ul>
  </section>`;
}

function verdictCard(v, entities) {
  const ids = entities.map((e) => e.device.id);
  const series = (id) => ids.indexOf(id);
  const head = v.verdict === 'winner'
    ? html`<div class="vcard__winner">${seriesMark(series(v.winner))}<strong>${nameOf(v.winner)}</strong><span class="tiny muted">+${v.margin.toFixed(0)} pts</span></div>`
    : v.verdict === 'tie'
      ? html`<div class="vcard__winner vcard__winner--tie"><strong>Too close to call</strong></div>`
      : html`<div class="vcard__winner vcard__winner--none"><strong>Insufficient shared evidence</strong></div>`;
  return html`<article class="vcard vcard--${v.verdict}">
    <header class="vcard__head">
      <div><h3>${v.label}</h3><p class="tiny muted">${v.question}</p></div>
      ${v.confidence ? confMeter(v.confidence) : ''}
    </header>
    ${head}
    ${v.verdict !== 'insufficient'
      ? scoreBars(v.results.map((r) => ({ label: nameOf(r.id), series: series(r.id), score: r.result?.score ?? null, win: v.winner === r.id, dim: r.result?.anyInherited })), { stacked: true })
      : html`<p class="small muted">${v.why}</p>`}
    ${v.reasons?.length ? html`<div class="vcard__why"><div class="eyebrow">${v.verdict === 'tie' ? `${nameOf(v.leader)} ahead on` : 'Why'}</div><ul>${v.reasons.map((r) => html`<li>${r.text}${r.inherited ? html` ${tag('chipset data', 'muted')}` : ''}${r.spec ? html` ${provBadge('official')}` : r.sources.length ? html` <span class="tiny muted">(${r.sources.join(', ')})</span>` : ''}</li>`)}</ul></div>` : ''}
    ${v.counter?.length ? html`<div class="vcard__counter"><div class="eyebrow">${v.verdict === 'tie' ? `${nameOf(v.runnerUp)} ahead on` : `But ${nameOf(v.runnerUp)} leads on`}</div><ul>${v.counter.map((r) => html`<li>${r.text}</li>`)}</ul></div>` : ''}
    ${v.verdict === 'tie' && v.why ? html`<p class="tiny muted">${v.why}</p>` : ''}
    <details class="tiny vcard__basis"><summary>Evidence used</summary>
      <p>${v.sharedIds.length ? `Shared metrics: ${v.sharedIds.map((id) => metricDef(id)?.short).join(', ')}.` : 'No shared metrics.'}${v.missing.length ? ` Not available for every device: ${v.missing.map((id) => metricDef(id)?.short).join(', ')}.` : ''}</p>
      ${v.note ? html`<p class="muted">${v.note}</p>` : ''}
    </details>
  </article>`;
}

function sizeComparison(entities) {
  // Version 17: real outlines at one scale with each device's picture, dimension lines, weight and an optional bank card
  const view = sizeView(entities.map((e, i) => ({ row: store.deviceById.get(e.device.id), device: e.device, mark: seriesMark(i) })));
  if (!view) return '';
  return html`<section class="card" aria-labelledby="size-h">
    ${sectionHead('Size, to scale', { id: 'size-h', level: 3, right: html`<span class="tiny muted">Makers’ published sizes, drawn at one scale</span>` })}
    ${view}
  </section>`;
}

function testsSection(cmp, entities) {
  if (!cmp.tests.length) return '';
  const ids = new Set(entities.map((e) => e.device.id));
  return html`<section class="card" aria-labelledby="tests-h">
    ${sectionHead('Head-to-head in the same test', { id: 'tests-h', level: 3, right: html`<span class="tiny muted">Same conditions, same day, same tester</span>` })}
    ${cmp.tests.map((t) => headToHeadTable(t, null, ids))}
  </section>`;
}

/** Short source label for a table cell: "GSMArena", "GSMArena +2" or "chipset". */
function cellSources(m) {
  if (m.inherited) return 'chipset stand-in';
  const origins = m.summary?.origins ?? [];
  if (!origins.length) return '';
  return `${origins[0].name}${origins.length > 1 ? ` +${origins.length - 1}` : ''}`;
}

function metricsTable(cmp, entities) {
  if (!cmp.metrics.length) return '';
  const category = cmp.category;
  return html`<section aria-labelledby="bench-h">
    ${sectionHead('Benchmarks & measurements', { id: 'bench-h', right: html`<span class="tiny muted">Consensus values · ▲ best · source under each value</span>` })}
    <div class="table-wrap cmp-table"><table class="data-table">
      <thead><tr><th scope="col">Metric</th>${entities.map((e, i) => html`<th scope="col">${seriesMark(i)} ${e.device.name}</th>`)}</tr></thead>
      <tbody>${cmp.metrics.map((row) => {
        const stats = store.core.stats?.[category]?.[row.id];
        return html`<tr>
          <th scope="row"><span class="cmp-metric">${row.def.name}</span><span class="tiny muted">${store.facetById.get(row.def.facet)?.label ?? ''}${row.def.better === 'lower' ? ' · lower is better' : ''}</span></th>
          ${row.values.map((v, i) => {
            if (!v.m) return html`<td class="muted small">No data</td>`;
            const score = stats ? (row.def.better === 'lower' ? (stats.min / v.m.value) * 100 : (v.m.value / stats.max) * 100) : null;
            return html`<td class="${row.best === v.id ? 'is-best' : ''}">
              <div class="num cmp-val">${fmtMetric(row.def, v.m.value)}${row.best === v.id ? html` <span class="best-mark" aria-label="best">▲</span>` : ''}</div>
              <div class="row tiny">${miniMeter(score, { series: i })} ${confMeter(v.m.confidence, { label: false, why: v.m.summary?.why })}</div>
              <div class="cmp-src tiny ${v.m.inherited ? 'is-standin' : ''}">${cellSources(v.m)}</div>
            </td>`;
          })}
        </tr>`;
      })}</tbody>
    </table></div>
  </section>`;
}

function specTable(entities) {
  const cat = categoryDef(entities[0].device.category);
  return html`<section aria-labelledby="spec-h">
    ${sectionHead('Specifications side by side', { id: 'spec-h', right: html`<label class="check small"><input type="checkbox" data-diff-only /> Differences only</label>` })}
    <div class="table-wrap cmp-table"><table class="data-table spec-compare">
      <thead><tr><th scope="col">Spec</th>${entities.map((e, i) => html`<th scope="col">${seriesMark(i)} ${e.device.name}</th>`)}</tr></thead>
      ${cat.specSections.map((section) => {
        const rows = section.fields.map((f) => {
          const values = entities.map((e) => specValue(e.device, f.key));
          const texts = values.map((v, i) => fmtSpec(f, v, entities[i].device));
          if (texts.every((t) => t === null)) return null;
          const nums = values.map((v) => specNumeric(f, v));
          let best = null;
          if (f.better && nums.filter((n) => n !== null).length > 1) {
            const valid = nums.filter((n) => n !== null);
            const target = f.better === 'lower' ? Math.min(...valid) : Math.max(...valid);
            if (valid.some((n) => n !== target)) best = target;
          }
          const same = new Set(texts.map((t) => String(t ?? ''))).size === 1;
          return html`<tr data-same="${same}">
            <th scope="row">${f.label}</th>
            ${texts.map((t, i) => {
              const prov = provenanceFor(entities[i].device, specPath(f.key));
              return html`<td class="${best !== null && nums[i] === best ? 'is-best' : ''}">${t === null ? html`<span class="muted">—</span>` : t}${t !== null && prov.class !== 'official' ? html` <span title="${sourceName(prov.source)}${prov.note ? ` · ${prov.note}` : ''}">${provBadge(prov.class)}</span>` : ''}</td>`;
            })}
          </tr>`;
        }).filter(Boolean);
        return rows.length ? html`<tbody><tr class="spec-compare__section"><th colspan="${entities.length + 1}" scope="colgroup">${section.label}</th></tr>${rows}</tbody>` : '';
      })}
    </table></div>
    <p class="tiny muted" style="margin-top:8px">Unbadged values are official specifications. Badged values come from other evidence classes (hover for the source). Highlighted cells are the better value where “better” is well defined.</p>
  </section>`;
}

function findingsCompare(entities) {
  const cols = entities.map((e) => {
    const items = [];
    for (const doc of e.documents) for (const f of doc.findings ?? []) items.push({ f, doc });
    return items;
  });
  if (cols.every((c) => !c.length)) return '';
  return html`<section aria-labelledby="find-h">
    ${sectionHead('What reviewers found', { id: 'find-h', right: html`<span class="tiny muted">Summaries in our own words, linked to each source</span>` })}
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))">${entities.map((e, i) => html`<div class="card">
      <h3 class="row" style="margin-bottom:10px">${seriesMark(i)} ${e.device.name}</h3>
      ${cols[i].length ? html`<ul class="findings">${cols[i].slice(0, 6).map(({ f, doc }) => findingItem(f, doc))}</ul>` : html`<p class="small muted">No extracted findings yet.</p>`}
      <a class="tiny" href="${href(`/device/${e.device.id}`, { section: 'findings' })}">All evidence for ${e.device.name} →</a>
    </div>`)}</div>
  </section>`;
}

function sourcesSection(used, entities) {
  const ids = entities.map((e) => e.device.id);
  const who = (set) => html`${[...set].map((id) => seriesMark(ids.indexOf(id)))}`;
  const date = (d) => (d.published ? `${d.publishedApprox ? 'c. ' : ''}${fmtDate(d.published)}` : '—');
  return html`<section aria-labelledby="src-h">
    ${sectionHead('Sources used in this comparison', { id: 'src-h', right: html`<span class="tiny muted">${plural(used.documents.length + used.chipset.length, 'document')} · ${plural(used.specs.length, 'specification source')}</span>` })}
    <div class="table-wrap"><table class="data-table biblio">
      <thead><tr><th scope="col">Type</th><th scope="col">Source</th><th scope="col">Document</th><th scope="col">Devices</th><th scope="col">Date</th><th scope="col" class="num">Records</th></tr></thead>
      <tbody>
        ${used.documents.map((u) => html`<tr>
          <td>${provBadge(u.doc.class)}</td>
          <td>${sourceLink(u.doc.testedBy ?? u.doc.source)}${u.doc.testedBy ? html`<div class="tiny muted">via ${sourceName(u.doc.source)}</div>` : ''}</td>
          <td class="small">${extLink(u.doc.url, u.doc.title)}</td>
          <td class="nowrap">${who(u.devices)}</td>
          <td class="small nowrap">${date(u.doc)}</td>
          <td class="num">${u.records || (u.findings ? plural(u.findings, 'finding') : '—')}</td>
        </tr>`)}
        ${used.chipset.map((u) => html`<tr class="biblio__standin">
          <td>${provBadge(u.doc.class)}</td>
          <td>${sourceLink(u.doc.testedBy ?? u.doc.source)}</td>
          <td class="small">${extLink(u.doc.url, u.doc.title)} <span class="tag tag--muted">chipset stand-in</span></td>
          <td class="nowrap">${who(u.devices)}</td>
          <td class="small nowrap">${date(u.doc)}</td>
          <td class="num">${u.doc.recordCount}</td>
        </tr>`)}
        ${used.specs.map((p) => html`<tr>
          <td>${provBadge(p.class ?? 'official')}</td>
          <td>${sourceLink(p.source)}</td>
          <td class="small">${p.url ? extLink(p.url, p.note ?? 'Specification page') : p.note ?? 'Specification'}</td>
          <td class="nowrap">${who(p.devices)}</td>
          <td class="small nowrap">${p.checked ? `checked ${fmtDate(p.checked)}` : '—'}</td>
          <td class="num">—</td>
        </tr>`)}
      </tbody>
    </table></div>
  </section>`;
}

function packDialog() {
  return html`<dialog class="modal" data-pack-dialog aria-labelledby="pack-title">
    <div class="modal__head"><h2 id="pack-title" style="font-size:18px">Evidence pack (AI-ready)</h2><button type="button" class="icon-btn" data-pack-close aria-label="Close">${icon('close')}</button></div>
    <div class="modal__body stack">
      <p class="small muted">This is the structured, cited evidence an AI assistant would receive to answer this comparison. Every value and finding carries a citation id, and platform analysis is labelled separately so a generated answer can be checked claim by claim.</p>
      <div class="row"><button type="button" class="btn btn--sm" data-pack-copy>${icon('copy', { size: 14 })} Copy JSON</button><button type="button" class="btn btn--sm" data-pack-download>${icon('download', { size: 14 })} Download</button><span class="tiny muted" data-pack-size></span></div>
      <pre class="code" data-pack-json></pre>
    </div>
  </dialog>`;
}

// ------------------------------------------------------------------ page
export default async function render({ params, query }) {
  const rawIds = (params[0] ?? '').split(',').filter(Boolean);
  const ids = [...new Set(rawIds)].filter((id) => store.deviceById.has(id)).slice(0, MAX_COMPARE);
  const unknown = rawIds.filter((id) => !store.deviceById.has(id));
  const isCustom = query.profile === 'custom';
  const profileId = isCustom || store.profileById.has(query.profile) ? query.profile : 'balanced';
  if (ids.length < 2) {
    return { title: 'Compare devices', html: html`${unknown.length ? html`<p class="note small">Unknown device id(s) ignored: ${unknown.join(', ')}</p>` : ''}${pickerPage(ids)}`, mount: (root) => bindPicker(root, ids, profileId) };
  }
  const entities = await Promise.all(ids.map((id) => loadDevice(id)));
  const category = entities[0].device.category;
  let weights = isCustom ? { ...defaultWeights(category), ...parseWeights(query.w) } : defaultWeights(category);
  const cmp = buildComparison(entities, isCustom ? customProfile(weights) : profileId, { currency: selectedCurrency() });
  const diffs = keyDifferences(entities);
  const used = sourcesUsed(entities);
  const title = ids.map(nameOf).join(' vs ');

  return {
    title,
    html: html`<div class="stack-lg compare">
      ${pageTrail([{ label: 'Home', href: href('/') }, { label: 'Compare', href: href('/compare') }, { label: title }])}
      <header>
        <div class="eyebrow">Comparison · ${plural(ids.length, 'device')} · ${categoryDef(cmp.category)?.name}</div>
        <h1 class="cmp-title">${ids.map((id, i) => html`${i ? html`<span class="vs">vs</span>` : ''}<span>${nameOf(id)}</span>`)}</h1>
        ${unknown.length ? html`<p class="note small">Unknown device id(s) ignored: ${unknown.join(', ')}</p>` : ''}
      </header>
      ${pageOutline(CMP_SECTIONS, { title: 'Jump to', variant: 'bar' })}
      <div class="cmp-sticky">${deviceHeads(entities, ids)}</div>
      <div class="stack">
        ${profileControls(profileId)}
        ${isCustom ? weightsPanel(weights, category) : ''}
      </div>
      <div data-overall>${overallPanel(cmp, entities)}</div>
      ${keyDiffSection(diffs, entities)}
      <section aria-labelledby="cats-h">
        ${sectionHead('Category verdicts', { id: 'cats-h', right: html`<span class="tiny muted">Like-for-like: only evidence every device shares</span>` })}
        <div class="vgrid">${cmp.verdicts.map((v) => verdictCard(v, entities))}</div>
      </section>
      ${sizeComparison(entities)}
      ${testsSection(cmp, entities)}
      ${metricsTable(cmp, entities)}
      ${specTable(entities)}
      ${findingsCompare(entities)}
      <section aria-labelledby="latest-h">${sectionHead('Latest about these devices', { id: 'latest-h' })}${autoSlot('all', 'News, tests, reviews and videos', { limit: 8 })}<p class="small muted" data-latest-empty>Nothing recent names these devices yet.</p></section>
      ${sourcesSection(used, entities)}
      <section class="card card--tint pack-cta">
        <div><div class="eyebrow">Built for AI-assisted research</div><h3 style="margin-top:6px">Export this comparison as a cited evidence pack</h3>
        <p class="small muted" style="margin-top:6px">Structured JSON with every value, finding and news item linked to its source. It is the input a future “ask the hub” assistant would reason over.</p></div>
        <button type="button" class="btn btn--primary" data-pack-open>${icon('download', { size: 16 })} View evidence pack</button>
      </section>
      ${packDialog()}
    </div>`,
    mount(root) {
      let current = cmp;
      bindPicker(root, ids, profileId);
      root.querySelectorAll('[data-profile]').forEach((b) =>
        b.addEventListener('click', () => {
          const id = b.dataset.profile;
          navigate(`/compare/${ids.join(',')}`, id === 'custom' ? { profile: 'custom', w: serializeWeights(weights) } : { profile: id });
        }),
      );
      // Custom weights: recompute only the overall verdict while the sliders move.
      const panel = root.querySelector('[data-weights]');
      panel?.addEventListener('input', (e) => {
        if (e.target.type !== 'range') return;
        weights = { ...weights, [e.target.name]: Number(e.target.value) };
        e.target.nextElementSibling.textContent = e.target.value;
        e.target.setAttribute('aria-valuetext', `${e.target.value} of ${MAX_WEIGHT}`);
        current = buildComparison(entities, customProfile(weights), { currency: selectedCurrency() });
        mount(root.querySelector('[data-overall]'), overallPanel(current, entities));
        setQuery({ profile: 'custom', w: serializeWeights(weights) });
      });
      root.querySelectorAll('[data-remove]').forEach((b) =>
        b.addEventListener('click', () => {
          const next = ids.filter((x) => x !== b.dataset.remove);
          compareTray.set(next);
          navigate(next.length ? `/compare/${next.join(',')}` : '/compare', isCustom ? { profile: 'custom', w: serializeWeights(weights) } : { profile: profileId });
        }),
      );
      compareTray.set(ids);
      root.querySelector('[data-diff-only]')?.addEventListener('change', (e) => root.querySelector('.spec-compare').classList.toggle('diff-only', e.target.checked));
      const dialog = root.querySelector('[data-pack-dialog]');
      let json = '';
      root.querySelector('[data-pack-open]')?.addEventListener('click', () => {
        const label = { custom: 'a custom weighting', balanced: 'most buyers' }[current.profile.id] ?? current.profile.label.toLowerCase();
        const pack = buildEvidencePack({ question: `Compare ${title} for ${label}`, entities, comparison: current });
        json = JSON.stringify(pack, null, 2);
        dialog.querySelector('[data-pack-json]').textContent = json;
        dialog.querySelector('[data-pack-size]').textContent = `${pack.citations.length} citations · ${(json.length / 1024).toFixed(0)} KB`;
        dialog.showModal();
      });
      root.querySelector('[data-pack-close]')?.addEventListener('click', () => dialog.close());
      root.querySelector('[data-pack-copy]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        try {
          await navigator.clipboard.writeText(json);
          btn.textContent = 'Copied';
        } catch {
          btn.textContent = 'Copy failed: select the text instead';
        }
      });
      root.querySelector('[data-pack-download]')?.addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: `evidence-pack-${ids.join('-vs-')}.json` });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      fillAuto(root, { devices: ids, showDevices: true }).then(() => { if (!root.querySelector('[data-auto]')?.hidden) root.querySelector('[data-latest-empty]')?.remove(); });
      const unSize = bindSize(root);
      const unOutline = bindOutline(root, { stickySelector: '.cmp-sticky' });
      return () => { unSize(); unOutline?.(); };
    },
  };
}
