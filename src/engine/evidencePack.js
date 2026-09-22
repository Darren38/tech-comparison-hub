// Evidence pack: the structured, cited input a future AI assistant would reason over.
// Every value and finding points to a citation id, so an answer generated from the pack
// can be checked claim by claim. See docs/ARCHITECTURE.md ("AI-ready evidence layer").

import { store, deviceTitle, sourceName, metricDef } from '../core/store.js';

const FACETS_FOR_PROFILE = {
  photography: ['camera', 'display'],
  gaming: ['gaming', 'performance', 'thermals', 'battery', 'display'],
  battery: ['battery', 'charging', 'efficiency'],
  performance: ['performance', 'gaming', 'thermals', 'efficiency'],
  longterm: ['software', 'durability', 'build', 'battery'],
  student: ['value', 'battery', 'software'],
  balanced: null, // everything
};

export function buildEvidencePack({ question, entities, comparison }) {
  const profileId = comparison?.profile?.id ?? 'balanced';
  const facets = FACETS_FOR_PROFILE[profileId];
  const wanted = (facet) => !facets || facets.includes(facet);
  const citations = new Map();

  const cite = (key, data) => {
    if (!citations.has(key)) citations.set(key, { id: `C${citations.size + 1}`, ...data });
    return citations.get(key).id;
  };
  const citeDoc = (docId) => {
    const doc = store.docById.get(docId);
    if (!doc) return null;
    return cite(docId, {
      title: doc.title,
      url: doc.url,
      publisher: sourceName(doc.source),
      testedBy: doc.testedBy ? sourceName(doc.testedBy) : undefined,
      published: doc.published ?? null,
      kind: doc.kind,
    });
  };

  const devices = entities.map((e) => {
    const dev = e.device;
    const specCitation = cite(`spec:${dev.id}`, {
      title: `${deviceTitle(dev)} specifications`,
      url: dev.provenance?.default?.url ?? null,
      publisher: sourceName(dev.provenance?.default?.source),
      kind: 'specification',
      note: dev.provenance?.default?.note,
    });
    const metrics = Object.entries(e.metrics ?? {})
      .filter(([id]) => wanted(metricDef(id)?.facet))
      .map(([id, m]) => ({
        metric: id,
        name: metricDef(id)?.name,
        unit: metricDef(id)?.unit,
        consensus: m.value,
        range: m.range,
        confidence: m.confidence,
        basis: m.why,
        inheritedFromChipset: m.inherited || undefined,
        evidence: m.inherited
          ? []
          : (m.origins ?? []).flatMap((o) =>
              o.records.map((r) => ({
                value: r.value,
                class: r.class,
                source: o.name,
                citation: r.spec ? specCitation : citeDoc(r.doc),
                note: r.note,
                variant: r.variant,
                flags: r.flags,
              })),
            ),
      }));
    const findings = (e.documents ?? []).flatMap((d) =>
      (d.findings ?? [])
        .filter((f) => wanted(f.facet))
        .map((f) => ({ facet: f.facet, stance: f.stance, text: f.text, class: d.class, citation: citeDoc(d.id) })),
    );
    const news = (e.documents ?? [])
      .filter((d) => d.kind === 'news' || d.kind === 'official')
      .slice(0, 6)
      .map((d) => ({ title: d.title, summary: d.summary, type: d.type, published: d.published, citation: citeDoc(d.id) }));
    return {
      id: dev.id,
      name: deviceTitle(dev),
      category: dev.category,
      status: dev.status,
      announced: dev.announced,
      chipset: e.chipset?.name,
      specs: dev.specs,
      specCitation,
      metrics,
      findings,
      news,
    };
  });

  const analysis = comparison
    ? {
        method: 'Platform analysis: like-for-like category scores (0–100, relative to the best consensus value in the category), using only metrics every device has evidence for.',
        profile: comparison.profile.label,
        verdicts: comparison.verdicts.map((v) => ({
          category: v.label,
          verdict: v.verdict,
          winner: v.winner ?? null,
          margin: v.margin !== undefined ? Number(v.margin.toFixed(1)) : null,
          confidence: v.confidence ?? null,
          reasons: (v.reasons ?? []).map((r) => r.text),
          missingEvidence: v.missing,
        })),
        overall: comparison.overall,
      }
    : null;

  return {
    schema: 'tch.evidence-pack/1',
    generated: new Date().toISOString(),
    question,
    instructions:
      'Answer only from this evidence. Cite citation ids for every claim. Distinguish official specifications, independent measurements, reviewer opinions and platform analysis. State when evidence is missing or of low confidence.',
    evidenceClasses: store.core.taxonomy.evidenceClasses.map(({ id, label, description }) => ({ id, label, description })),
    devices,
    platformAnalysis: analysis,
    citations: [...citations.values()],
  };
}
