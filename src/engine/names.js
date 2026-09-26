// How visitors actually type device names: squashed ("s26ultra"), spaced out ("S26   ULTRA"), without the brand
// ("Find X9 Ultra") or in short form ("S26U", "ip17pm", "RN14 Pro+", "ZFold7", "Tab S11U", "P80 Ultra").
// Shared by the site search and the chat, and built from the device names themselves, so every brand and every
// model added later (including the automatic ones) gets the same short forms without a hand-made list.

import { store, brandName } from '../core/store.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// end of the model name: nothing, " 5G", " 4G" or a year in brackets
const END = String.raw`(?=(?:\s+[45]G)?(?:\s*\(\d{4}\))?$)`;

// [pattern, replacement]: each rule can apply on top of the others ("Redmi Note 14 Pro Plus" -> "RN14 P+")
const RULES = [
  [new RegExp(String.raw`\s*Pro\s*Max${END}`, 'i'), ' PM'],
  [new RegExp(String.raw`\s*Pro\s*(?:Plus|\+)${END}`, 'i'), ' P+'],
  [new RegExp(String.raw`\s*Ultra${END}`, 'i'), ' U'],
  [/^iPhone\s*/i, 'IP '],
  [/^iPhone\s*/i, 'i'],
  [/^Redmi Note\s*/i, 'RN '],
  [/^Redmi Note\s*/i, 'Note '],
  [/^Galaxy Z (Fold|Flip)\s*/i, 'Z $1 '],
  [/^Galaxy Z (Fold|Flip)\s*/i, '$1 '],
  [/^Galaxy (Tab|Watch|Buds|Ring)\s*/i, '$1 '],
  [/^Galaxy\s+/i, ''],
  [/^ROG Phone\s*/i, 'ROG '],
  [/^Pura\s*/i, 'P'],
  [/^Find\s*/i, ''],
  [/\s+[45]G$/i, ''],
];

/** Every short form of one name (the name itself included). */
export function shortForms(name) {
  const out = new Set([name]);
  for (const [re, rep] of RULES) {
    for (const f of [...out]) if (re.test(f)) out.add(f.replace(re, rep).replace(/\s+/g, ' ').trim());
  }
  return [...out].filter(Boolean);
}

const stripBrand = (name, brand) => name.replace(new RegExp(`^(?:${esc(brand)}|Apple|Samsung)\\s+`, 'i'), '');

/** The device's names, whole and without the brand ("Redmi Note 14", "OPPO Find X9 Ultra" -> "Find X9 Ultra"). */
export function brandlessNames(row) {
  const brand = brandName(row.brand) ?? '';
  const out = new Set();
  for (const n of [row.name, ...(row.aliases ?? [])]) { out.add(n); out.add(stripBrand(n, brand)); }
  return [...out];
}

const squash = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\+/g, 'plus').replace(/[^a-z0-9]+/g, '');

let owners = null;
let shared = null;
let ownersFor = null;
/**
 * Squashed typed form -> device id. When several models share a form, the strongest claim wins: the model's own
 * name (3), then a hand-made alias on its record (2: "17PM" is listed for the iPhone 17 Pro Max), then a made-up
 * short form (1). A tie among models of one brand where one name starts all the others ("Redmi Note 14" /
 * "Redmi Note 14 5G", "ROG Phone 9" / "ROG Phone 9 Pro") goes to that base model; any other tie ("Band 10":
 * Xiaomi and HONOR) stays ambiguous and is left out. Every shared form is also kept in `shared`, so the search box
 * can list the other models too.
 */
export function typedForms() {
  if (owners && ownersFor === store.devices) return owners;
  const all = new Map(); // form -> Map(id -> strongest claim)
  for (const row of store.devices) {
    const brand = brandName(row.brand) ?? '';
    const forms = new Map();
    const claim = (g, tier) => forms.set(g, Math.max(forms.get(g) ?? 0, tier));
    for (const [n, whole] of [[row.name, 3], ...(row.aliases ?? []).map((a) => [a, 2])]) {
      // the whole name ("Redmi Note 14" -> "RN 14") and the name without the brand ("Find X9 Ultra" -> "X9U")
      for (const m of new Set([n, stripBrand(n, brand)])) {
        for (const f of shortForms(m)) {
          const tier = f === m ? whole : 1;
          claim(f, tier);
          claim(`${brand} ${f}`, tier);
        }
      }
    }
    for (const [f, tier] of forms) {
      const c = squash(f);
      // a form must say which model it is: letters and a number, or a long enough name ("ipair", "airpodspro")
      if (c.length < 3 || (!/\d/.test(c) && c.length < 5)) continue;
      // "17 5G" alone reads as a weight ("175g"), not the Redmi 17 5G
      if (!/[a-z]/.test(c.replace(/[45]g$/, ''))) continue;
      if (!all.has(c)) all.set(c, new Map());
      all.get(c).set(row.id, Math.max(all.get(c).get(row.id) ?? 0, tier));
    }
  }
  owners = new Map();
  shared = new Map();
  const bare = (r) => squash(stripBrand(r.name, brandName(r.brand) ?? ''));
  for (const [c, byId] of all) {
    if (byId.size === 1) { owners.set(c, [...byId.keys()][0]); continue; }
    shared.set(c, [...byId.keys()]);
    const top = Math.max(...byId.values());
    const best = [...byId].filter(([, t]) => t === top).map(([id]) => id);
    if (best.length === 1) { owners.set(c, best[0]); continue; }
    const rows = best.map((id) => store.deviceById.get(id)).sort((a, b) => bare(a).length - bare(b).length);
    const base = rows[0];
    if (new Set(rows.map((r) => r.brand)).size === 1 && rows.slice(1).every((r) => bare(r).startsWith(bare(base)))) owners.set(c, base.id);
  }
  ownersFor = store.devices;
  return owners;
}

/** Forms that fit several models -> all of them, the chosen one included ("watchultra2": Galaxy and Apple; "17pm"). */
export function sharedForms() {
  typedForms();
  return shared;
}

/** Forms per device id (inverse of typedForms), including the shared ones. */
export function formsById() {
  const byId = new Map();
  const add = (c, id) => { if (!byId.has(id)) byId.set(id, []); byId.get(id).push(c); };
  for (const [c, id] of typedForms()) add(c, id);
  for (const [c, ids] of sharedForms()) for (const id of ids) add(c, id);
  return byId;
}

export { squash };
