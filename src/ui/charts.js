// Lightweight, accessible charts. Bars are HTML (they reflow on narrow screens and the
// numbers are real text); the consensus dot plot is inline SVG with a text alternative.

import { html, raw } from '../lib/html.js';
import { fmtMetric, fmtNumber, plural } from '../lib/format.js';

const CLASS_SHAPE = { measured: 'circle', database: 'square', reviewer: 'diamond', official: 'ring', platform: 'triangle', estimated: 'ring', news: 'square', community: 'diamond' };

/**
 * Horizontal score bars (0–100).
 * rows: [{ label, series?: 0-3, score, text?, confidence?, href?, sub?, dim? }]
 */
export function scoreBars(rows, { max = 100, showScale = false, stacked = false } = {}) {
  return html`<div class="bars ${stacked ? 'bars--stacked' : ''}">
    ${rows.map((r) => {
      const pct = r.score === null || r.score === undefined ? 0 : Math.max(1.5, Math.min(100, (r.score / max) * 100));
      const series = r.series !== undefined ? `bar--s${r.series + 1}` : '';
      const label = r.href ? html`<a href="${r.href}">${r.label}</a>` : r.label;
      return html`<div class="bar ${series} ${r.dim ? 'is-dim' : ''} ${r.win ? 'is-win' : ''}">
        <div class="bar__label">${r.series !== undefined ? html`<span class="series series--${r.series + 1}" aria-hidden="true">${'ABCD'[r.series]}</span>` : ''}<span class="bar__name">${label}</span>${r.sub ? html`<span class="bar__sub tiny faint">${r.sub}</span>` : ''}</div>
        <div class="bar__track" aria-hidden="true"><div class="bar__fill" style="width:${pct.toFixed(1)}%"></div></div>
        <div class="bar__value num">${r.score === null || r.score === undefined ? html`<span class="faint">—</span>` : r.text ?? fmtNumber(r.score)}</div>
      </div>`;
    })}
    ${showScale ? html`<div class="bars__scale tiny faint" aria-hidden="true"><span>0</span><span>${max}</span></div>` : ''}
  </div>`;
}

function shape(kind, x, y, r, cls) {
  switch (kind) {
    case 'square':
      return `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" class="${cls}"/>`;
    case 'diamond':
      return `<path d="M${x} ${y - r * 1.25}L${x + r * 1.25} ${y}L${x} ${y + r * 1.25}L${x - r * 1.25} ${y}Z" class="${cls}"/>`;
    case 'triangle':
      return `<path d="M${x} ${y - r * 1.3}L${x + r * 1.2} ${y + r}L${x - r * 1.2} ${y + r}Z" class="${cls}"/>`;
    case 'ring':
      return `<circle cx="${x}" cy="${y}" r="${r}" class="${cls} is-ring"/>`;
    default:
      return `<circle cx="${x}" cy="${y}" r="${r}" class="${cls}"/>`;
  }
}

/**
 * Consensus dot plot: one mark per independent source on a shared axis, the consensus
 * (median) as a tick, and the source range as a band. This is how the platform shows
 * that a number is an agreement (or disagreement) between sources, not a single claim.
 */
export function dotPlot(summary, def, { width = 520, height = 64 } = {}) {
  const origins = summary.origins ?? [];
  if (!origins.length) return '';
  const values = origins.map((o) => o.value);
  let lo = Math.min(...values, summary.value);
  let hi = Math.max(...values, summary.value);
  const pad = (hi - lo || Math.abs(hi) * 0.1 || 1) * 0.18;
  lo -= pad;
  hi += pad;
  const left = 14;
  const right = width - 14;
  const x = (v) => left + ((v - lo) / (hi - lo)) * (right - left);
  const mid = 26;
  const marks = origins
    .map((o, i) => {
      const cls = `dp__mark dp--${o.class}`;
      const y = mid + ((i % 3) - 1) * 7;
      return `<g><title>${escapeText(o.name)}: ${escapeText(fmtMetric(def, o.value))}</title>${shape(CLASS_SHAPE[o.class] ?? 'circle', x(o.value).toFixed(1), y, 5, cls)}</g>`;
    })
    .join('');
  const [rlo, rhi] = summary.range;
  const description = `${def.name}: consensus ${fmtMetric(def, summary.value)} from ${plural(origins.length, 'source')}, ranging ${fmtMetric(def, rlo)} to ${fmtMetric(def, rhi)}.`;
  const svg = `<svg class="dotplot" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeText(description)}">
    <line x1="${left}" x2="${right}" y1="${mid}" y2="${mid}" class="dp__axis"/>
    <rect x="${x(rlo).toFixed(1)}" y="${mid - 13}" width="${Math.max(2, x(rhi) - x(rlo)).toFixed(1)}" height="26" rx="4" class="dp__range"/>
    <line x1="${x(summary.value).toFixed(1)}" x2="${x(summary.value).toFixed(1)}" y1="${mid - 17}" y2="${mid + 17}" class="dp__consensus"/>
    ${marks}
    <text x="${x(summary.value).toFixed(1)}" y="${height - 4}" text-anchor="middle" class="dp__label">consensus ${escapeText(fmtMetric(def, summary.value))}</text>
  </svg>`;
  return html`<figure class="dp">
    ${raw(svg)}
    <figcaption class="dp__legend tiny">${origins.map((o) => html`<span><i class="dp__key dp--${o.class}" aria-hidden="true"></i>${o.name} <span class="num">${fmtMetric(def, o.value)}</span></span>`)}</figcaption>
  </figure>`;
}

function escapeText(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** Tiny inline meter for tables (0–100). */
export function miniMeter(score, { series } = {}) {
  if (score === null || score === undefined) return html`<span class="faint">—</span>`;
  return html`<span class="mini ${series !== undefined ? `mini--s${series + 1}` : ''}" title="${fmtNumber(score)} / 100"><span style="width:${Math.max(3, score).toFixed(0)}%"></span></span>`;
}
