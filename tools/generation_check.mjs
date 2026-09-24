// Generation check (Version 14), run in the browser console of a local copy:
//   const m = await import('/tools/generation_check.mjs'); console.table(await m.run());
// For each flagship line, compares every model with its direct predecessor in each ranking profile and each score
// category, using the site's own scoring. It reports where the newer model ranks lower, with the per-category scores,
// so a data gap or error can be looked up. It changes nothing.
import { store, loadCore } from '../src/core/store.js';
import { allCategoryScores, profileScore, isOnSale } from '../src/engine/scoring.js';

import { LINES as SHARED } from '../src/engine/lines.js';

export const LINES = SHARED.map(([name, , ids]) => [name, ids]);

export async function run({ profiles = ['balanced', 'performance', 'gaming', 'photography', 'battery'] } = {}) {
  await loadCore();
  const rows = [];
  let pairs = 0, ok = 0;
  const byProfile = {};
  for (const [line, ids] of LINES) {
    const present = ids.filter((id) => store.deviceById.has(id) && isOnSale(store.deviceById.get(id)));
    for (let i = 1; i < present.length; i++) {
      const [oldId, newId] = [present[i - 1], present[i]];
      const [o, n] = [store.deviceById.get(oldId), store.deviceById.get(newId)];
      const [oc, nc] = [allCategoryScores(o), allCategoryScores(n)];
      for (const p of profiles) {
        const prof = store.profileById.get(p);
        const so = profileScore(oc, prof, { category: 'smartphone', id: oldId })?.score;
        const sn = profileScore(nc, prof, { category: 'smartphone', id: newId })?.score;
        if (so == null || sn == null) continue;
        pairs++;
        byProfile[p] = byProfile[p] ?? { pairs: 0, newerLeads: 0 };
        byProfile[p].pairs++;
        if (sn >= so) { ok++; byProfile[p].newerLeads++; continue; }
        const cats = Object.keys(nc).filter((c) => nc[c]?.score != null && oc[c]?.score != null && nc[c].score < oc[c].score)
          .map((c) => `${c} ${oc[c].score.toFixed(0)}→${nc[c].score.toFixed(0)}`);
        rows.push({ line, older: oldId, newer: newId, profile: p, older_score: +so.toFixed(1), newer_score: +sn.toFixed(1), lower_categories: cats.join(', ') });
      }
    }
  }
  return { pairs, newerLeads: ok, byProfile, exceptions: rows };
}
