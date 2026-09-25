// Chipset page: architecture, multi-source benchmark consensus, how much results vary
// between phones on the same chip, efficiency tests, devices and documents.

import { html } from '../lib/html.js';
import { fmtMetric, fmtDate, plural } from '../lib/format.js';
import { store, loadChipset, loadHeadToHead, metricDef, sourceName } from '../core/store.js';
import { href } from '../core/router.js';
import { provBadge, sourceLink, evidenceBlock, deviceCard, docCard, findingItem, sectionHead, emptyState, provenanceFor, tag, pageTrail } from '../ui/components.js';
import { scoreBars } from '../ui/charts.js';
import { headToHeadTable } from './device.js';
import { autoSlot, fillAuto } from '../ui/autolinks.js';

const ORDER = ['gb6_single', 'gb6_multi', 'antutu_v11', 'antutu_v10', 'wle', 'wle_stability', 'solar_bay', 'steel_nomad_light'];

function clusterDiagram(cpu) {
  if (!cpu?.clusters?.length) return html`<p class="small muted">${cpu?.cores ? `${cpu.cores} cores. ` : ''}${cpu?.note ?? 'Core layout not published.'}</p>`;
  const maxGhz = Math.max(...cpu.clusters.map((c) => c.ghz ?? 0), 1);
  return html`<div class="clusters">
    ${cpu.clusters.map((c) => html`<div class="cluster">
      <div class="cluster__cores" aria-hidden="true">${Array.from({ length: c.count }, () => html`<span style="height:${c.ghz ? Math.max(18, (c.ghz / maxGhz) * 48) : 24}px"></span>`)}</div>
      <div class="tiny"><strong>${c.count}×</strong> ${c.core}</div>
      <div class="tiny num muted">${c.ghz ? `${c.ghz} GHz` : 'clock n/a'}</div>
    </div>`)}
    ${cpu.note ? html`<p class="tiny muted" style="flex-basis:100%">${cpu.note}</p>` : ''}
  </div>`;
}

function specCard(chip) {
  const rows = [
    ['Process', chip.process ? [chip.process.node, chip.process.foundry, chip.process.name].filter(Boolean).join(' · ') : null, 'process'],
    ['GPU', chip.gpu?.name ? `${chip.gpu.name}${chip.gpu.note ? ` (${chip.gpu.note})` : ''}` : null, 'gpu'],
    ['NPU', chip.npu, 'npu'],
    ['Modem', chip.modem, 'modem'],
    ['Memory', chip.memory, 'memory'],
    ['Storage', chip.storage, 'storage'],
  ];
  return html`<section class="card">
    <div class="card__title"><h3>Architecture</h3><span class="tiny muted">${sourceLink(chip.provenance?.default?.source)}</span></div>
    ${clusterDiagram(chip.cpu)}
    <table class="spec-table" style="margin-top:12px"><tbody>
      ${rows.filter(([, v]) => v).map(([label, v, key]) => {
        const prov = provenanceFor(chip, key);
        return html`<tr><th scope="row">${label}</th><td>${v}</td><td class="spec-table__prov"><span title="${sourceName(prov.source)}${prov.note ? ` · ${prov.note}` : ''}">${provBadge(prov.class)}</span></td></tr>`;
      })}
    </tbody></table>
    ${chip.variants?.length ? html`<div style="margin-top:12px">${chip.variants.map((v) => html`<p class="small"><strong>${v.name}:</strong> ${v.note}</p>`)}</div>` : ''}
    ${chip.provenance?.default?.note ? html`<p class="tiny muted" style="margin-top:8px">${chip.provenance.default.note}</p>` : ''}
  </section>`;
}

function implementations(data) {
  const blocks = ORDER.filter((id) => (data.implementations[id] ?? []).length >= 2).map((id) => {
    const def = metricDef(id);
    const rows = [...data.implementations[id]].sort((a, b) => (def.better === 'lower' ? a.value - b.value : b.value - a.value));
    const values = rows.map((r) => r.value);
    const spread = (Math.max(...values) - Math.min(...values)) / Math.max(...values);
    return html`<div class="impl">
      <div class="spread small"><strong>${def.name}</strong><span class="muted">Spread between phones: ${(spread * 100).toFixed(0)}%</span></div>
      ${scoreBars(rows.map((r) => ({
        label: store.deviceById.get(r.device)?.name ?? r.device,
        href: href(`/device/${r.device}`),
        score: (r.value / Math.max(...values)) * 100,
        text: fmtMetric(def, r.value),
        sub: sourceName(r.origin),
      })))}
    </div>`;
  });
  if (!blocks.length) return '';
  return html`<section class="card">
    ${sectionHead('Same chip, different phones', { level: 3, right: html`<span class="tiny muted">Device-level results · cooling and tuning matter</span>` })}
    <div class="stack">${blocks}</div>
  </section>`;
}

export default async function render({ params }) {
  const [id] = params;
  const row = store.chipsetById.get(id);
  if (!row) {
    const err = new Error(`No chipset with the id "${id}" is in the database.`);
    err.status = 404;
    throw err;
  }
  const [data, h2h] = await Promise.all([loadChipset(id), loadHeadToHead()]);
  const chip = data.chipset;
  const metrics = ORDER.filter((m) => data.metrics[m]);
  const tests = h2h.filter((t) => t.entries.some((e) => e.subject === id));
  const devices = data.devices.map((d) => store.deviceById.get(d)).filter(Boolean);
  const findings = data.documents.flatMap((doc) => (doc.findings ?? []).map((f) => ({ f, doc })));

  return {
    title: chip.name,
    html: html`<div class="stack-lg chipset">
      <header>
        ${pageTrail([{ label: 'Home', href: href('/') }, { label: 'Chipsets', href: href('/chipsets') }, { label: sourceName(chip.vendor) }, { label: chip.name }])}
        <div class="eyebrow" style="margin-top:10px">${sourceName(chip.vendor)} · ${chip.family ?? ''} · announced ${fmtDate(chip.announced)}</div>
        <h1>${chip.name}</h1>
        ${chip.summary ? html`<p class="dhead__summary">${chip.summary}</p>` : ''}
        <div class="row small" style="margin-top:10px">${chip.aliases?.map((a) => tag(a, 'muted'))}<span class="muted">${plural(devices.length, 'device')} in the database</span></div>
      </header>
      <div class="grid grid-2">
        ${specCard(chip)}
        <section class="card">
          ${sectionHead('Benchmark consensus', { level: 3, right: html`<span class="tiny muted">Median of independent sources</span>` })}
          ${metrics.length ? metrics.slice(0, 3).map((m) => evidenceBlock(metricDef(m), data.metrics[m])) : emptyState('No benchmark data yet', 'Registered sources such as NanoReview and SoCPK can be added once data is entered with attribution.')}
        </section>
      </div>
      ${metrics.length > 3 ? html`<section class="card">${sectionHead('More benchmarks', { level: 3 })}<div class="grid grid-2">${metrics.slice(3).map((m) => html`<div>${evidenceBlock(metricDef(m), data.metrics[m])}</div>`)}</div></section>` : ''}
      ${implementations(data)}
      ${tests.length ? html`<section class="card">${sectionHead('Efficiency & lab measurements', { level: 3, right: html`<span class="tiny muted">Only comparable within each test</span>` })}${tests.map((t) => headToHeadTable(t, id))}</section>` : ''}
      ${findings.length ? html`<section class="card">${sectionHead('Technical findings', { level: 3 })}<ul class="findings">${findings.map(({ f, doc }) => findingItem(f, doc))}</ul></section>` : ''}
      ${devices.length ? html`<section>${sectionHead(`Devices with the ${chip.name}`, { eyebrow: plural(devices.length, 'device') })}<div class="grid grid-3">${devices.map((d) => deviceCard(d))}</div></section>` : ''}
      ${data.documents.length ? html`<section>${sectionHead('Sources & coverage', { eyebrow: plural(data.documents.length, 'document') })}<div class="grid grid-3">${data.documents.map((d) => docCard(d))}</div></section>` : ''}
      <section>${autoSlot('all', `The ${chip.name} and its phones in the headlines`, { limit: 8 })}</section>
    </div>`,
    mount(root) {
      // headlines that name the chip, or any phone built on it
      fillAuto(root, { chipsets: [id], devices: devices.map((d) => d.id), showDevices: true });
    },
  };
}
