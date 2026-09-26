// Built-in assistant: answers questions about devices from this site's own data. It is not an AI model:
// it recognises devices, the attribute asked about and a few question shapes (compare, rank, list, explain,
// "is it good?", yes/no feature checks, "what is IP68?"), then reads the recorded values. Every value names its
// source; anything not recorded is said to be missing. General explanations are labelled as such.

import { store, loadDevice, deviceTitle, brandName, sourceName, metricDef } from '../core/store.js';
import { href } from '../core/router.js';
import { html } from '../lib/html.js';
import { fmtDate, fmtNumber, fmtPrice, fmtMetric, plural, timeAgo } from '../lib/format.js';
import { displayPrice, priceText, availabilityIn, selectedCurrency, ratesLabel } from './money.js';
import { normalizeText, search } from './search.js';
import { detectProfile } from './intent.js';
import { profileLeaderboard, allCategoryScores, getMetric, applicableScoreCategories, rankOf, profileScore } from './scoring.js';
import { provenanceFor, specValue, fmtSpec, extLink } from '../ui/components.js';

const CATEGORY_WORDS = [
  [/\b(earbuds?|ear ?buds?|tws|earphones?|in-ear|airpods|freebuds|galaxy buds|pixel buds|headphones?)\b/, 'earbuds'],
  [/\b(fitness bands?|smart bands?|bands?|trackers?)\b/, 'band'],
  [/\b(tablets?|ipads?|pads?)\b/, 'tablet'],
  [/\b(watch(es)?|smartwatch(es)?|wearables?)\b/, 'smartwatch'],
  [/\b(phones?|smartphones?|mobiles?|handsets?|foldables?)\b/, 'smartphone'],
];

// ------------------------------------------------------------------ attributes a question can ask about
const A = (id, re, label, opts = {}) => ({ id, re, label, ...opts });
const ATTRS = [
  A('price', /\b(price|prices|cost|costs|how much|ringgit|rm\s?\d|cheap(er|est)?|expensive|afford)/, 'Price', { rank: 'price', better: 'lower' }),
  A('battery', /\b(battery|batteries|mah|endurance|lasts?|battery life|stamina)\b/, 'Battery', { rank: 'battery', better: 'higher' }),
  A('wireless', /\bwireless(ly)?\b/, 'Wireless charging', { rank: 'wirelessW', better: 'higher' }),
  A('charging', /\b(charg(e|es|ed|ing|er)|watts?|fast ?charg\w*|\d{2,3}\s?w)\b/, 'Charging', { rank: 'wiredW', better: 'higher' }),
  A('refresh', /\b(refresh|hz|smooth)\b/, 'Refresh rate', { rank: 'refreshHz', better: 'higher' }),
  A('brightness', /\b(bright(ness|est)?|nits|sunlight|outdoor)\b/, 'Brightness', { rank: 'nits', better: 'higher' }),
  A('display', /\b(screens?|displays?|inch(es)?|panel|amoled|oled|lcd|resolution)\b/, 'Display', { rank: 'displayIn', better: 'higher' }),
  A('chip', /\b(chip(set)?s?|processors?|cpu|soc|snapdragon|dimensity|exynos|helio|kirin|tensor|bionic)\b/, 'Chip'),
  A('performance', /\b(performance|fast(er|est)?|speed|benchmark\w*|geekbench|antutu|gaming|games?|powerful)\b/, 'Performance', { rank: 'performance', better: 'higher' }),
  A('ram', /\b(ram|memory)\b/, 'RAM', { rank: 'ramMax', better: 'higher' }),
  A('storage', /\b(storage|rom|\d{3}\s?gb|\d\s?tb|space)\b/, 'Storage', { rank: 'storageMax', better: 'higher' }),
  A('camera', /\b(cameras?|mp|megapixels?|photos?|photography|zoom|telephoto|periscope|ultra ?wide|selfie|lens(es)?|video)\b/, 'Cameras', { rank: 'mainMp', better: 'higher' }),
  A('weight', /\b(weight|weighs?|heav(y|ier|iest)|light(er|est)?|grams?)\b/, 'Weight', { rank: 'weightG', better: 'lower' }),
  A('size', /\b(dimensions?|thick(ness)?|thin(ner|nest)?|slim(mer|mest)?|tall|height|width|compact|small(er|est)?|big(ger|gest)? phone)\b/, 'Size'),
  A('water', /\b(water(proof| resistant| resistance)?|ip\d{2}k?|ip rating|dust(proof)?|rain|swim(ming)?|shower)\b/, 'Water and dust resistance', { rank: 'water', better: 'higher' }),
  A('release', /\b(release[sd]?|launch(ed|es)?|announced|come out|came out|when (was|did|is)|how old|new(er|est)?|latest)\b/, 'Release'),
  A('software', /\b(os|android|ios|updates?|software|support(ed)?|one ui|hyperos|coloros|funtouch|originos|magicos|harmonyos|emui|wear os|watchos)\b/, 'Software and updates', { rank: 'updates', better: 'higher' }),
  A('jack', /\b(headphone jack|3\.5 ?mm|audio jack|earphone jack|headset jack|jack)\b/, 'Headphone jack'),
  A('card', /\b(micro ?sd|memory card|sd card|expandable storage|card slot|expandable)\b/, 'Memory card slot'),
  A('sim', /\b(e-?sim|dual sim|sim cards?|sim tray|sims?)\b/, 'SIM'),
  A('wifi', /\b(wi-?fi|wlan|wifi ?[67]e?)\b/, 'Wi-Fi'),
  A('bluetooth', /\bbluetooth\b/, 'Bluetooth'),
  A('gps', /\b(gps|gnss|navigation|positioning|galileo|beidou)\b/, 'Positioning'),
  A('sensors', /\b(sensors?|gyro(scope)?|compass|barometer|ir blaster|infrared|accelerometer)\b/, 'Sensors'),
  A('colors', /\b(colou?rs?|colou?rways?|finish(es)?)\b/, 'Colours'),
  A('speakers', /\b(speakers?|stereo|loudspeakers?|dolby atmos)\b/, 'Speakers'),
  A('biometrics', /\b(fingerprint|face unlock|face id|face recognition|biometric\w*|unlock)\b/, 'Biometrics'),
  A('bands', /\b(network bands?|lte bands?|5g bands?|frequency bands?|frequenc(y|ies)|band support)\b/, 'Network bands'),
  A('usb', /\b(usb|type-?c|charging port|port)\b/, 'USB'),
  A('network', /\b(5g|4g|lte|nfc|cellular|uwb)\b/, 'Connectivity'),
];

// ------------------------------------------------------------------ test results (Version 20)
// A question naming a test gets the recorded result and who measured it, a ranking by that test, or the tests side by
// side, instead of the specification sheet. Checked in order: the most specific wording first.
const TESTS = [
  [/\bdxo ?mark\b.*\b(display|screen)\b|\b(display|screen)\b.*\bdxo ?mark\b/, ['dxomark_display']],
  [/\bdxo ?mark\b.*\bbattery\b|\bbattery\b.*\bdxo ?mark\b/, ['dxomark_battery']],
  [/\bdxo ?mark\b.*\b(audio|sound|speakers?)\b|\b(audio|sound|speakers?)\b.*\bdxo ?mark\b/, ['dxomark_audio']],
  [/\bdxo ?mark\b/, ['dxomark_camera', 'dxomark_camera_v5']],
  [/\bgeekbench\b.*\bsingle|\bsingle[- ]?core\b/, ['gb6_single']],
  [/\bgeekbench\b.*\bmulti|\bmulti[- ]?core\b/, ['gb6_multi']],
  [/\bgeekbench\b|\bgb ?6\b/, ['gb6_multi', 'gb6_single']],
  [/\bantutu\b/, ['antutu_v11', 'antutu_v10']],
  [/\bsteel nomad\b/, ['steel_nomad_light']],
  [/\bsolar bay\b|\bray ?tracing\b/, ['solar_bay']],
  [/\b3d ?mark\b|\bwild life\b|\bwle\b/, ['wle', 'steel_nomad_light', 'wle_stability']],
  [/\b(video (test|drain|playback test|rundown)|netflix)\b/, ['tr_video_drain', 'engadget_video']],
  [/\btoms? guide\b|\bweb (surfing|browsing) (test|battery)\b/, ['tg_web']],
  [/\b(battery (test|tests|rundown|runtime)|screen[- ]?on time|how long does (the |its |it'?s )?battery last|battery .{0,12}tested)\b/, ['tg_web', 'tr_video_drain', 'battery_rundown', 'engadget_video', 'dxomark_battery']],
  [/\b(fastest|quickest|slowest) (charging|to charge)\b.{0,30}\b(tests?|tested|measured)\b|\bcharging (tests?|times?)\b|\bhow long\b.{0,30}\b(to )?(fully )?charge|\bcharg(e|ing) (time|speed test)|\btime to (full|charge)|\bfull charge|\b0 ?(-|to) ?100\b/, ['charge_full', 'charge_30', 'charge_15']],
  [/\b(measured|tested) (peak )?brightness|\bbrightness (test|measured)/, ['nits_peak', 'nits_manual', 'nits_auto']],
];
// the specification shown when a device has no result for the test asked about
const TEST_FALLBACK = { charge_full: 'charging', tg_web: 'battery', tr_video_drain: 'battery', nits_peak: 'brightness', gb6_multi: 'chip',
  gb6_single: 'chip', antutu_v11: 'chip', wle: 'chip', steel_nomad_light: 'chip', solar_bay: 'chip', dxomark_camera: 'camera' };

function detectTests(norm) {
  for (const [re, ids] of TESTS) if (re.test(norm)) return ids.filter((id) => metricDef(id));
  return [];
}

const originNames = (m) => [...new Set((m?.origins ?? []).map((o) => o.name ?? sourceName(o.origin)))].join(', ');

async function answerTests(id, mids) {
  const data = await loadDevice(id).catch(() => null);
  const ms = data?.metrics ?? {};
  const got = mids.map((mid) => ({ mid, def: metricDef(mid), m: ms[mid] })).filter((x) => x.m && x.m.value != null);
  if (!got.length) {
    const attr = TEST_FALLBACK[mids[0]];
    const fact = attr ? facts(await full(id), attr).find((f) => f.text) : null;
    const others = Object.keys(ms).filter((k) => !k.startsWith('spec_') && metricDef(k) && !ms[k].inherited).slice(0, 6).map((k) => metricDef(k).name);
    return {
      html: html`<p>No ${metricDef(mids[0]).name} result is recorded for the ${link(id)} yet.${fact ? html` The maker's figure: ${fact.label.toLowerCase()} ${fact.text}.` : ''}</p>
        ${others.length ? html`<p>Tests recorded for it: ${others.join(', ')}.</p>` : html`<p>No independent test of it is recorded yet.</p>`}`,
      devices: [id],
    };
  }
  return {
    html: html`<p>${link(id)}, test results:</p>
      <ul class="ask__list">${got.map(({ def, m }) => html`<li>${def.name}: <strong>${fmtMetric(def, m.value)}</strong> <span class="ask__val">${m.inherited
        ? `the ${data.chipset?.name ?? 'chip'}'s result from other phones with it (no test of this phone yet)`
        : `measured by ${originNames(m)}${(m.n ?? 1) > 1 ? ` (${m.n} results agree to within ${Math.round((m.spread ?? 0) * 100)}%)` : ''}`}</span></li>`)}</ul>
      <p class="ask__src">${metricDef(got[0].mid).better === 'lower' ? 'Lower is better for ' + got.filter((x) => x.def.better === 'lower').map((x) => x.def.name).join(', ') + '. ' : ''}Each result is compared only with the same test. <a href="${href(`/device/${id}`, { section: 'evidence' })}">All its test results and sources</a>.</p>`,
    devices: [id],
  };
}

function answerTestRank(mid, norm, text, category) {
  const def = metricDef(mid);
  const f = filterRows(norm, text, { category });
  const ranked = f.rows.map((r) => ({ r, v: r.m?.[mid]?.[0], inh: r.m?.[mid]?.[2] })).filter((x) => x.v != null && !x.inh)
    .sort((a, b) => (def.better === 'lower' ? a.v - b.v : b.v - a.v)).slice(0, 5);
  if (!ranked.length) return { html: html`<p>No ${filterWords(f, category)} have a ${def.name} result recorded yet.</p>` };
  return {
    html: html`<p>Top ${ranked.length} ${filterWords(f, category)} in ${def.name} (${def.better === 'lower' ? 'lower is better' : 'higher is better'}), from the phones with a result:</p>
      <ol class="ask__rank">${ranked.map((x) => html`<li>${link(x.r.id)} <span class="ask__val">${fmtMetric(def, x.v)}${x.r.ms?.[mid]?.length ? ` · ${x.r.ms[mid].map((o) => sourceName(o)).join(', ')}` : ''}</span></li>`)}</ol>
      <p class="ask__src">Only this phone's own results count here; a chip's result from other phones is left out. <a href="${href('/charts')}">All charts</a>.</p>`,
    devices: ranked.map((x) => x.r.id),
  };
}

function answerTestCompare(ids, mids) {
  const lines = mids.map((mid) => {
    const def = metricDef(mid);
    const vals = ids.map((id) => ({ id, v: row(id)?.m?.[mid]?.[0], inh: row(id)?.m?.[mid]?.[2] }));
    const own = vals.filter((x) => x.v != null && !x.inh);
    if (!own.length) return null;
    const best = [...own].sort((a, b) => (def.better === 'lower' ? a.v - b.v : b.v - a.v))[0];
    return html`<li>${def.name}: ${vals.map((x, i) => html`${i ? ' · ' : ''}${deviceTitle(row(x.id))} <strong>${x.v != null && !x.inh ? fmtMetric(def, x.v) : 'not tested'}</strong>`)}${own.length > 1 ? html` <span class="ask__val">(${deviceTitle(row(best.id))} leads)</span>` : ''}</li>`;
  }).filter(Boolean);
  if (!lines.length) return { html: html`<p>None of these has a ${metricDef(mids[0]).name} result recorded yet.</p>`, devices: ids };
  return {
    html: html`<p>Test results side by side:</p><ul class="ask__list">${lines}</ul>
      <p class="ask__src">Each device's own results only, from the sources on its page. <a href="${href(`/compare/${ids.join(',')}`)}">Open the full comparison</a>.</p>`,
    devices: ids,
  };
}

const SUPER_HIGH = /\b(biggest|largest|most|longest|highest|best|fastest|brightest|max(imum)?|top|greatest|more|bigger|larger|longer|higher|better|faster)\b/;
const SUPER_LOW = /\b(smallest|lightest|cheapest|lowest|thinnest|least|lighter|cheaper|lower|thinner|smaller)\b/;

function detectAttrs(norm) {
  const hits = ATTRS.filter((a) => a.re.test(norm));
  // "wireless charging" is its own attribute, not general charging
  if (hits.some((a) => a.id === 'wireless')) return hits.filter((a) => a.id !== 'charging');
  // "battery capacity" / "screen size" are not storage or phone size
  return hits.filter((a) => !(a.id === 'storage' && /battery|mah/.test(norm)) && !(a.id === 'size' && /\bscreen size|display size\b/.test(norm)));
}

function detectCategory(norm) {
  for (const [re, id] of CATEGORY_WORDS) if (re.test(norm)) return id;
  return null;
}

function detectBrands(norm) {
  return (store.core.brands ?? []).filter((b) => new RegExp(`\\b${normalizeText(b.name)}\\b`).test(norm)).map((b) => b.id);
}

let chipNames = null;
/** Chipsets named in the question, longest name first, so "Snapdragon 8 Elite Gen 5" isn't also read as "Snapdragon 8 Elite". */
function detectChipsets(norm) {
  chipNames ??= store.chipsets.flatMap((c) => [c.name, ...(c.aliases ?? [])].map((n) => ({ id: c.id, n: normalizeText(n).replace(/\s+/g, ' ').trim() })))
    .filter((x) => x.n.length >= 4 && /\d/.test(x.n)).sort((a, b) => b.n.length - a.n.length);
  let rest = ` ${norm} `;
  const found = [];
  for (const { id, n } of chipNames) {
    const i = rest.indexOf(` ${n} `);
    if (i < 0) continue;
    rest = rest.slice(0, i) + ' '.repeat(n.length + 1) + rest.slice(i + n.length + 1);
    if (!found.includes(id)) found.push(id);
  }
  return found;
}

function detectMaxPrice(text) {
  // English, plus the common Malay forms ("bawah RM1000", "kurang daripada RM1,500", "bajet RM2k")
  const m = /(?:under|below|less than|cheaper than|within|max(?:imum)?|up to|budget(?: of)?|di ?bawah|bawah|kurang dari(?:pada)?|bajet|<)\s*(rm|myr|\$|usd|s\$|sgd|€|£)?\s*([\d][\d,]*(?:\.\d+)?)\s*(k)?/i.exec(text);
  if (!m) return null;
  let amount = Number(m[2].replace(/,/g, '')) * (m[3] ? 1000 : 1);
  if (!Number.isFinite(amount) || amount < 50) return null;
  const sym = (m[1] ?? '').toLowerCase();
  const currency = { rm: 'MYR', myr: 'MYR', $: 'USD', usd: 'USD', 's$': 'SGD', sgd: 'SGD', '€': 'EUR', '£': 'GBP' }[sym] ?? selectedCurrency();
  return { amount, currency };
}

// ------------------------------------------------------------------ device recognition
const compact = (s) => normalizeText(s).replace(/\s+/g, '');

// short forms visitors type instead of the full word
const ABBREVIATIONS = [
  [/\s*Ultra$/i, 'U'],
  [/\s*Pro Max$/i, 'PM'],
  [/\s*Pro Plus$/i, 'P+'],
];

let shortCache = null;
/** Brand-less names ("Galaxy S24" -> "S24", "OPPO Reno14 5G" -> "Reno14 5G", "Reno14"), kept only when unique and letter+digit. */
function shortNames() {
  if (shortCache) return shortCache;
  const owners = new Map();
  for (const r of store.devices) {
    const brand = brandName(r.brand);
    const forms = new Set();
    for (const n of [r.name, ...(r.aliases ?? [])]) {
      let s = n.replace(new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i'), '').replace(/^(Galaxy|Apple)\s+/i, '');
      if (s === n && !/^Galaxy\s/i.test(n)) continue;
      forms.add(s); forms.add(s.replace(/\s*5G$/i, ''));
    }
    // how people actually type them: "S24U" and "24U" for the S24 Ultra, "16PM" for the iPhone 16 Pro Max
    for (const f of [...forms]) {
      for (const [re, short] of ABBREVIATIONS) if (re.test(f)) forms.add(f.replace(re, short));
    }
    for (const f of [...forms]) {
      const rest = /^[A-Za-z](\d.*)$/.exec(f)?.[1];
      if (rest && /[A-Za-z]/.test(rest)) forms.add(rest); // "S24U" -> "24U" (never a bare number)
    }
    for (const f of forms) {
      const c = compact(f);
      if (c.length < 3 || !/[a-z]/.test(c) || !/\d/.test(c)) continue;
      owners.set(c, [...(owners.get(c) ?? []), [r.id, f]]);
    }
  }
  shortCache = new Map();
  for (const list of owners.values()) {
    const ids = [...new Set(list.map(([id]) => id))];
    let [id, f] = list[0];
    if (ids.length !== 1) {
      // Shared by several devices. "Band 10" (Xiaomi and HONOR) stays ambiguous, but when they are the same
      // brand and one name starts the others ("vivo Y27", "vivo Y27 5G"), the short form means the base model.
      const rows = ids.map((x) => row(x)).sort((a, b) => compact(a.name).length - compact(b.name).length);
      const base = rows[0];
      const sameBrand = new Set(rows.map((r) => r.brand)).size === 1;
      if (!sameBrand || !rows.slice(1).every((r) => compact(r.name).startsWith(compact(base.name)))) continue;
      [id, f] = list.find(([x]) => x === base.id) ?? [base.id, base.name];
    }
    shortCache.set(id, [...(shortCache.get(id) ?? []), f]);
  }
  return shortCache;
}

/** Devices named in the question, longest names first, without overlaps ("Galaxy S24 Ultra" wins over "Galaxy S24"). */
async function devicesIn(text, { fuzzy = true } = {}) {
  const q = ` ${normalizeText(text)} `;
  const qc = compact(text);
  // which word each character of the compacted text came from, so "s24u" can be told from "s24 u…"
  const wordOf = [];
  normalizeText(text).split(' ').forEach((w, i) => { for (let k = 0; k < w.length; k += 1) wordOf.push(i); });
  const cands = [];
  const known = new Set(store.devices.map((r) => compact(r.name)));
  const shorts = shortNames();
  for (const row of store.devices) {
    const base = [row.name, deviceTitle(row), ...(row.aliases ?? [])];
    // Short forms without "5G" rank below exact names, so "Galaxy A16" is the A16 when both exist;
    // brand-less forms ("S24", "Reno14") rank lower still and are only used when no other device shares them.
    const names = [...base.map((n) => [n, 0]), ...base.filter((n) => /\s5G$/i.test(n)).map((n) => [n.replace(/\s*5G$/i, ''), 0.5]),
      ...(shorts.get(row.id) ?? []).map((n) => [n, 1])];
    for (const [n, penalty] of names) {
      const c = compact(n);
      if (c.length < 3) continue;
      let hit = null;
      for (let i = qc.indexOf(c); i >= 0 && !hit; i = qc.indexOf(c, i + 1)) {
        // the next characters must not continue the model name ("s24" must not match "s24ultra" or "s245")
        // nor start inside a model number ("9pro" is not in "a19pro")
        if (i > 0 && wordOf[i] === wordOf[i - 1] && /[a-z0-9]/.test(qc[i - 1]) && (/\d/.test(qc[i]) || /\d/.test(qc[i - 1]))) continue;
        const after = qc.slice(i + c.length, i + c.length + 5);
        // "Is the vivo Y04 5G?" still means the Y04 when no "Y04 5G" exists; "Galaxy A16 5G" is its own model
        const netSuffix = /^[45]g/.test(after) && !known.has(c + after.slice(0, 2));
        // the rest of the same word only ("s24u" -> "u"; in "s24 ultra" the next word isn't part of it)
        let rest = '';
        for (let k = i + c.length; k < qc.length && wordOf[k] === wordOf[i + c.length - 1]; k += 1) rest += qc[k];
        // "s24" must not match inside "s24u" or "s24pm": those are the Ultra and the Pro Max
        if ((/^\d/.test(after) && !netSuffix) || /^(ultra|plus|pro|max|mini|lite|fe|edge|classic|active|s(?![a-z])|e(?![a-z]))/.test(after) || /^(pm|u|pplus)$/.test(rest)) continue;
        hit = { id: row.id, start: i, end: i + c.length, len: c.length - penalty };
      }
      if (hit) { cands.push(hit); break; }
    }
  }
  cands.sort((a, b) => b.len - a.len);
  const picked = [];
  for (const c of cands) if (!picked.some((p) => c.start < p.end && p.start < c.end)) picked.push(c);
  if (picked.length) return picked.sort((a, b) => a.start - b.start).map((p) => p.id);
  // Fall back to fuzzy search for a single device phrase ("s24u", small typos)
  if (fuzzy && q.trim().split(' ').length <= 6) {
    const [best] = await search(text, { limit: 1, types: ['device'] });
    if (best && best.score >= 62) return [best.id];
  }
  return [];
}

// ------------------------------------------------------------------ values
const row = (id) => store.deviceById.get(id);
const link = (id) => html`<a href="${href(`/device/${id}`)}">${deviceTitle(row(id))}</a>`;

function sourceOf(dev, path) {
  const p = provenanceFor(dev, path);
  if (!p?.source) return null;
  return { name: sourceName(p.source), url: p.url, cls: p.class, id: p.source };
}

function fmtList(v, unit) {
  if (!Array.isArray(v)) return v == null ? null : `${fmtNumber(v)}${unit ? ` ${unit}` : ''}`;
  return v.map((x) => (unit === 'GB' && x >= 1024 ? `${x / 1024} TB` : `${fmtNumber(x)}${unit ? ` ${unit}` : ''}`)).join(' / ');
}

/** What the record says about one attribute: [{label, text, path}] (text null = not recorded). */
function facts(dev, attr) {
  const s = dev.specs ?? {};
  const wearable = dev.category === 'smartwatch' || dev.category === 'band';
  const F = (label, text, path) => ({ label, text: text ?? null, path });
  switch (attr) {
    case 'battery':
      if (dev.category === 'earbuds') {
        return [F('Earbuds alone (claimed)', s.battery?.life_h ? `${s.battery.life_h} hours${s.battery.life_anc_h ? ` (${s.battery.life_anc_h} h with noise cancelling)` : ''}` : null, 'specs.battery.life_h'),
                F('With the charging case (claimed)', s.battery?.total_h ? `${s.battery.total_h} hours` : null, 'specs.battery.total_h')];
      }
      return wearable
        ? [F('Battery life (claimed)', s.battery?.life_h ? `${s.battery.life_h >= 48 ? `${Math.round(s.battery.life_h / 24)} days` : `${s.battery.life_h} hours`}` : null, 'specs.battery.life_h'),
           ...(s.battery?.capacity_mah ? [F('Capacity', `${fmtNumber(s.battery.capacity_mah)} mAh`, 'specs.battery.capacity_mah')] : [])]
        : [F('Capacity', s.battery?.capacity_mah ? `${fmtNumber(s.battery.capacity_mah)} mAh` : s.battery?.capacity_wh ? `${s.battery.capacity_wh} Wh` : null, 'specs.battery'),
           ...(s.battery?.video_h ? [F('Video playback (claimed)', `up to ${s.battery.video_h} hours`, 'specs.battery.video_h')] : [])];
    case 'charging':
      return [F('Wired charging', s.charging?.wired_w ? `${s.charging.wired_w} W` : null, 'specs.charging.wired_w'),
              F('Wireless charging', s.charging?.wireless_w === 0 ? 'Not supported' : s.charging?.wireless_w ? `${s.charging.wireless_w} W` : null, 'specs.charging.wireless_w')];
    case 'wireless':
      return [F('Wireless charging', s.charging?.wireless_w === 0 ? 'Not supported' : s.charging?.wireless_w ? `${s.charging.wireless_w} W` : null, 'specs.charging.wireless_w')];
    case 'display':
      return [F('Screen', [s.display?.size_in && `${s.display.size_in}-inch`, s.display?.type, s.display?.resolution, s.display?.refresh_hz && `${s.display.refresh_hz} Hz`].filter(Boolean).join(', ') || null, 'specs.display'),
              ...(s.display?.secondary ? [F('Cover screen', s.display.secondary, 'specs.display.secondary')] : [])];
    case 'refresh':
      return [F('Refresh rate', s.display?.refresh_hz ? `up to ${s.display.refresh_hz} Hz` : null, 'specs.display.refresh_hz')];
    case 'brightness':
      return [F('Peak brightness (claimed)', s.display?.peak_nits ? `${fmtNumber(s.display.peak_nits)} nits` : null, 'specs.display.peak_nits')];
    case 'chip': {
      const chip = store.chipsetById.get(s.platform?.chipset);
      return [F('Chip', chip ? chip.name : null, 'specs.platform.chipset'),
              ...(s.platform?.cpu ? [F('CPU', s.platform.cpu, 'specs.platform.cpu')] : []),
              ...(s.platform?.gpu ? [F('GPU', s.platform.gpu, 'specs.platform.gpu')] : [])];
    }
    case 'jack':
      return [F('3.5 mm headphone jack', s.audio?.jack === true ? 'Yes' : s.audio?.jack === false ? 'No (use USB-C or Bluetooth headphones)' : null, 'specs.audio.jack')];
    case 'card': {
      const c = s.memory?.card ?? (s.memory?.expandable === true ? 'Yes' : s.memory?.expandable === false ? 'No' : null);
      return [F('Memory card slot', c, s.memory?.card ? 'specs.memory.card' : 'specs.memory.expandable')];
    }
    case 'sim':
      return [F('SIM', s.connectivity?.sim ?? null, 'specs.connectivity.sim')];
    case 'wifi':
      return [F('Wi-Fi', s.connectivity?.wifi ?? null, 'specs.connectivity.wifi')];
    case 'bluetooth':
      return [F('Bluetooth', s.connectivity?.bluetooth ?? null, 'specs.connectivity.bluetooth')];
    case 'gps':
      return [F('Positioning', s.connectivity?.positioning ?? null, 'specs.connectivity.positioning')];
    case 'sensors':
      return [F('Sensors', s.sensors ?? null, 'specs.sensors')];
    case 'colors':
      return [F('Colours', s.misc?.colors ?? null, 'specs.misc.colors')];
    case 'speakers':
      return [F('Speakers', s.audio?.speakers ?? null, 'specs.audio.speakers')];
    case 'biometrics':
      return [F('Fingerprint', s.biometrics?.fingerprint ?? null, 'specs.biometrics.fingerprint'),
              ...(s.biometrics?.face ? [F('Face unlock', s.biometrics.face, 'specs.biometrics.face')] : [])];
    case 'bands': {
      const c = s.connectivity ?? {};
      return [F('Technology', c.technology ?? c.cellular ?? null, 'specs.connectivity.technology'),
              ...[['2G', c.bands_2g], ['3G', c.bands_3g], ['4G', c.bands_4g], ['5G', c.bands_5g]].filter(([, v]) => v).map(([g, v]) => F(`${g} bands`, v, `specs.connectivity.bands_${g.toLowerCase()}`))];
    }
    case 'usb':
      return [F('USB', s.connectivity?.usb ?? null, 'specs.connectivity.usb')];
    case 'ram':
      return [F('RAM', fmtList(s.memory?.ram_gb, 'GB'), 'specs.memory.ram_gb')];
    case 'storage':
      return [F('Storage', fmtList(s.memory?.storage_gb, 'GB'), 'specs.memory.storage_gb')];
    case 'camera': {
      const rear = s.camera?.rear ?? [];
      const names = { main: 'main', ultrawide: 'ultra-wide', telephoto: 'telephoto', periscope: 'periscope telephoto', macro: 'macro', depth: 'depth', monochrome: 'monochrome' };
      return [F('Rear cameras', rear.length ? rear.map((c) => `${c.mp} MP ${names[c.role] ?? c.role}${c.zoom_x ? ` (${c.zoom_x}x)` : ''}`).join(', ') : s.camera?.rear_text ?? null, 'specs.camera.rear'),
              F('Front camera', s.camera?.front ?? null, 'specs.camera.front'),
              ...(s.camera?.zoom_optical_x > 1 ? [F('Optical zoom', `${s.camera.zoom_optical_x}x`, 'specs.camera.zoom_optical_x')] : [])];
    }
    case 'weight':
      return [F('Weight', s.build?.weight_g ? `${fmtNumber(s.build.weight_g)} g` : null, 'specs.build.weight_g')];
    case 'size': {
      const d = s.build?.dimensions;
      return [F('Dimensions', d ? `${d.height_mm} × ${d.width_mm} × ${d.depth_mm} mm` : null, 'specs.build.dimensions'),
              F('Weight', s.build?.weight_g ? `${fmtNumber(s.build.weight_g)} g` : null, 'specs.build.weight_g')];
    }
    case 'water':
      return [F('Rating', [s.build?.ip, s.build?.water].filter(Boolean).join(', ') || null, 'specs.build.ip')];
    case 'software':
      return [F('Software at launch', s.software?.launch_os ?? null, 'specs.software.launch_os'),
              F('Update commitment', s.software?.os_updates_years ? `${s.software.os_updates_years} years of OS upgrades${s.software.security_updates_years ? `, ${s.software.security_updates_years} years of security updates` : ''}` : s.software?.policy_note ?? null, 'specs.software')];
    case 'network': {
      const c = s.connectivity ?? {};
      return [F('Network', c.cellular ?? c.technology ?? null, 'specs.connectivity.cellular'), F('NFC', c.nfc === true ? 'Yes' : c.nfc === false ? 'No' : null, 'specs.connectivity.nfc'),
              ...(c.uwb !== undefined ? [F('Ultra-wideband (UWB)', c.uwb ? 'Yes' : 'No', 'specs.connectivity.uwb')] : [])];
    }
    default:
      return [];
  }
}

function priceFact(dev) {
  const my = (dev.prices ?? []).filter((p) => p.region === 'MY').sort((a, b) => a.amount - b.amount);
  if (my.length) {
    return html`${my.map((p, i) => html`${i ? '; ' : ''}<strong>${fmtPrice(p.amount, 'MYR')}</strong>${p.config ? ` (${p.config})` : ''}`)} at the Malaysian launch${my[0].date ? `, ${fmtDate(my[0].date)}` : ''}. Source: ${my[0].url ? html`<a href="${my[0].url}" target="_blank" rel="noopener noreferrer">${sourceName(my[0].source)}</a>` : sourceName(my[0].source)}.`;
  }
  const av = availabilityIn(dev, 'MYR');
  // the remark on why there is no Malaysian price ("expected towards the end of October"), with its source
  const why = av ? html`${av.long}${av.note ? `: ${av.note.replace(/\.$/, '')}` : ''}${av.source ? html` (${av.url ? html`<a href="${av.url}" target="_blank" rel="noopener noreferrer">${sourceName(av.source)}</a>` : sourceName(av.source)})` : ''}. ` : '';
  const dp = displayPrice(dev, selectedCurrency());
  if (dp) {
    const b = dp.basis ?? {};
    const own = b.amount && b.currency && b.currency !== dp.currency;
    return html`${why}Launch price elsewhere: <strong>${own ? fmtPrice(b.amount, b.currency) : priceText(dp)}</strong>${b.config ? ` (${b.config})` : ''}${b.region ? ` in ${b.region}` : ''}${own ? html`, about <strong>${fmtPrice(dp.amount, dp.currency)}</strong> at today's exchange rate` : ''}.`;
  }
  return html`${why}No launch price is recorded.`;
}

function releaseFact(dev) {
  const parts = [];
  if (dev.announced) parts.push(`announced ${fmtDate(dev.announced)}`);
  if (dev.released) parts.push(`on sale ${fmtDate(dev.released)}`);
  return parts.length ? `${parts.join(', ')}.` : 'The launch date is not recorded.';
}

async function full(id) {
  try {
    return (await loadDevice(id)).device;
  } catch {
    return row(id);
  }
}

function sourcesLine(dev, paths) {
  const seen = new Map();
  for (const p of paths) {
    const s = sourceOf(dev, p);
    if (s && !seen.has(s.name)) seen.set(s.name, s);
  }
  if (!seen.size) return '';
  return html`<p class="ask__src">Source${seen.size > 1 ? 's' : ''}: ${[...seen.values()].map((s, i) => html`${i ? ', ' : ''}${s.url ? html`<a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.name}</a>` : s.name}${s.cls && s.cls !== 'official' ? html` <span class="ask__cls">(${store.classById.get(s.cls)?.label?.toLowerCase() ?? s.cls})</span>` : ''}`)}</p>`;
}

// ------------------------------------------------------------------ answer shapes
async function answerDevice(id, attrs) {
  const dev = await full(id);
  const title = link(id);
  if (!attrs.length) {
    const s = dev.specs ?? {};
    const lines = ['display', 'chip', 'battery', 'charging', 'camera', 'weight'].flatMap((a) => facts(dev, a)).filter((f) => f.text);
    return {
      html: html`<p>${title}${dev.announced ? ` (${String(dev.announced).slice(0, 4)})` : ''}: ${dev.summary ?? `${brandName(dev.brand)} ${store.categoryById.get(dev.category)?.singular.toLowerCase() ?? 'device'}`}</p>
        <ul class="ask__facts">${lines.slice(0, 7).map((f) => html`<li><span>${f.label}</span> ${f.text}</li>`)}<li><span>Price</span> ${priceFact(dev)}</li></ul>
        ${sourcesLine(dev, lines.map((f) => f.path))}
        <p class="ask__more"><a href="${href(`/device/${id}`)}">Full specifications, tests and sources</a></p>`,
      devices: [id],
    };
  }
  const parts = [];
  const paths = [];
  for (const a of attrs) {
    if (a.id === 'price') { parts.push(html`<li><span>Price</span> ${priceFact(dev)}</li>`); continue; }
    if (a.id === 'release') { parts.push(html`<li><span>Release</span> ${releaseFact(dev)}</li>`); continue; }
    if (a.id === 'performance') {
      const cats = allCategoryScores(row(id));
      const chip = store.chipsetById.get(dev.specs?.platform?.chipset);
      const gb = getMetric(row(id), 'gb6_multi');
      parts.push(html`<li><span>Performance</span> ${cats.performance ? html`platform performance score <strong>${Math.round(cats.performance.score)}</strong>/100` : gb ? 'no platform score yet' : 'no benchmark results recorded'}${gb ? html`; Geekbench 6 multi-core ${fmtMetric(metricDef('gb6_multi'), gb.value)}${gb.inherited ? ' (chipset stand-in)' : ''}` : ''}${chip ? html`; chip: <a href="${href(`/chipset/${chip.id}`)}">${chip.name}</a>` : ''}.</li>`);
      continue;
    }
    for (const f of facts(dev, a.id)) {
      parts.push(html`<li><span>${f.label}</span> ${f.text ?? html`<em class="ask__none">not recorded</em>`}</li>`);
      if (f.text) paths.push(f.path);
    }
  }
  return {
    html: html`<p>${title}:</p><ul class="ask__facts">${parts}</ul>${sourcesLine(dev, paths)}<p class="ask__more"><a href="${href(`/device/${id}`)}">See all its specifications</a></p>`,
    devices: [id],
  };
}

const RANKERS = {
  price: (r) => { const p = displayPrice(r, 'MYR'); return p ? p.amount : null; },
  battery: (r) => (r.category === 'earbuds' ? r.f?.totalLifeH ?? r.f?.batteryLifeH : r.category === 'smartwatch' || r.category === 'band' ? r.f?.batteryLifeH : r.f?.batteryMah) ?? null,
  wiredW: (r) => r.f?.wiredW ?? null,
  wirelessW: (r) => r.m?.spec_wireless_w?.[0] ?? null,
  refreshHz: (r) => r.f?.refreshHz ?? null,
  nits: (r) => r.m?.spec_peak_nits?.[0] ?? null,
  displayIn: (r) => r.f?.displayIn ?? null,
  performance: (r) => allCategoryScores(r).performance?.score ?? null,
  ramMax: (r) => r.f?.ramMax ?? null,
  storageMax: (r) => r.f?.storageMax ?? null,
  mainMp: (r) => r.f?.mainMp ?? null,
  weightG: (r) => r.f?.weightG ?? null,
  water: (r) => r.m?.spec_ip?.[0] ?? r.f?.waterM ?? null,
  updates: (r) => r.m?.spec_os_years?.[0] ?? null,
};
// "Redmi Note 14 charges faster (wired): 33 W vs 30 W" reads better than "has the higher figure" (Version 10)
const HIGHER_TEXT = {
  battery: 'has the bigger battery',
  wiredW: 'charges faster (wired)',
  wirelessW: 'charges faster wirelessly',
  refreshHz: 'has the higher refresh rate',
  nits: 'is brighter (claimed peak)',
  displayIn: 'has the bigger screen',
  performance: 'has the higher performance score',
  ramMax: 'has more RAM',
  storageMax: 'has more storage',
  mainMp: 'has the higher-resolution main camera',
  water: 'has the better water rating',
  updates: 'has the longer update promise',
};
const RANK_TEXT = {
  price: (v) => fmtPrice(v, 'MYR'), battery: (v, r) => (r.category === 'earbuds' ? `${fmtNumber(v, v % 1 ? 1 : 0)} h with the case` : r.category === 'smartwatch' || r.category === 'band' ? `${Math.round(v / 24)} days` : `${fmtNumber(v)} mAh`),
  wiredW: (v) => `${v} W`, wirelessW: (v) => (v ? `${v} W` : 'none'), refreshHz: (v) => `${v} Hz`, nits: (v) => `${fmtNumber(v)} nits`, displayIn: (v) => `${v}-inch`,
  performance: (v) => `score ${Math.round(v)}`, ramMax: (v) => `${v} GB`, storageMax: (v) => (v >= 1024 ? `${v / 1024} TB` : `${v} GB`), mainMp: (v) => `${v} MP`,
  weightG: (v) => `${fmtNumber(v)} g`, water: (v, r) => (r.f?.ip?.join(', ') || (r.f?.waterM ? `${r.f.waterM} m` : '')), updates: (v) => `${v} years of OS upgrades`,
};

function compareAttr(ids, attr) {
  const key = attr.rank;
  const vals = ids.map((id) => ({ id, v: key ? RANKERS[key](row(id)) : null }));
  const known = vals.filter((x) => x.v != null);
  let verdict = '';
  if (key && known.length >= 2) {
    const sorted = [...known].sort((a, b) => (attr.better === 'lower' ? a.v - b.v : b.v - a.v));
    const [a, b] = sorted;
    verdict = a.v === b.v ? html`They are level on ${attr.label.toLowerCase()}.` : html`${link(a.id)} ${attr.better === 'lower' ? (key === 'price' ? 'is cheaper' : key === 'weightG' ? 'is lighter' : 'has the lower figure') : HIGHER_TEXT[key] ?? 'has the higher figure'}: ${RANK_TEXT[key](a.v, row(a.id))} vs ${RANK_TEXT[key](b.v, row(b.id))}.`;
  }
  return verdict;
}

/** "Which is better?": each device's overall (or use-case) score, and who leads, with the site's tie margin. */
function overallCompare(ids, profileId) {
  const cats = row(ids[0]).category;
  const prof = store.profileById.get(profileId);
  if (!prof || ids.some((id) => row(id).category !== cats)) return null;
  const scored = ids.map((id) => ({ id, res: profileScore(allCategoryScores(row(id)), prof, { category: cats, id }) }));
  const ok = scored.filter((x) => x.res && x.res.coverage >= (store.core.scoring?.verdict?.minCoverage ?? 0.34));
  const phrase = profileId === 'balanced' ? 'overall' : `for ${prof.label.toLowerCase()}`;
  const cell = (x) => (ok.includes(x) ? Math.round(x.res.score) : null);
  let line;
  if (ok.length < 2) {
    line = html`There isn't enough shared evidence to say which is better ${phrase}.`;
  } else {
    const sorted = [...ok].sort((a, b) => b.res.score - a.res.score);
    const margin = store.core.scoring?.verdict?.tieMargin ?? 3;
    line = sorted[0].res.score - sorted[1].res.score < margin
      ? html`<strong>${phrase === 'overall' ? 'Overall' : `For ${prof.label.toLowerCase()}`}, it's too close to call</strong>: ${sorted.map((x, i) => html`${i ? ', ' : ''}${row(x.id).name} ${cell(x)}`)} (the site treats a lead under ${margin} points as a tie).`
      : html`<strong>${link(sorted[0].id)} comes out ahead ${phrase}</strong>: ${sorted.map((x, i) => html`${i ? ', ' : ''}${row(x.id).name} ${cell(x)}`)} out of 100.`;
    const untested = ok.filter((x) => Object.values(allCategoryScores(row(x.id))).every((c) => c.specOnly)).map((x) => row(x.id).name);
    if (untested.length) line = html`${line} <span class="ask__src">(${untested.length === ok.length ? 'All of these scores come' : `The score for ${untested.join(' and ')} comes`} from specification sheets only, with no independent tests recorded, so treat the gap as a rough guide.)</span>`;
  }
  return { phrase, line, cells: scored.map(cell) };
}

async function answerCompare(ids, attrs, norm = '', text = '') {
  const devs = await Promise.all(ids.map(full));
  const use = attrs.length ? attrs : [ATTRS.find((a) => a.id === 'display'), ATTRS.find((a) => a.id === 'chip'), ATTRS.find((a) => a.id === 'battery'), ATTRS.find((a) => a.id === 'charging'), ATTRS.find((a) => a.id === 'weight'), ATTRS.find((a) => a.id === 'price')];
  const rows = [];
  const verdicts = [];
  const wantsWinner = !attrs.length || /\b(better|best|recommend\w*|should i|worth|winner|win|good|overall)\b/.test(norm);
  const overall = wantsWinner ? overallCompare(ids, /\bfor\b/.test(norm) ? detectProfile(text) ?? 'balanced' : 'balanced') : null;
  if (overall) rows.push(html`<tr><th scope="row">Score ${overall.phrase}</th>${overall.cells.map((c) => html`<td>${c ?? html`<em class="ask__none">not enough evidence</em>`}</td>`)}</tr>`);
  for (const a of use) {
    if (a.id === 'price') {
      rows.push(html`<tr><th scope="row">Price (MY launch)</th>${devs.map((d) => { const p = (d.prices ?? []).filter((x) => x.region === 'MY').sort((x, y) => x.amount - y.amount)[0]; return html`<td>${p ? fmtPrice(p.amount, 'MYR') : html`<em class="ask__none">${availabilityIn(d, 'MYR')?.short ?? 'not recorded'}</em>`}</td>`; })}</tr>`);
    } else if (a.id === 'release') {
      rows.push(html`<tr><th scope="row">Announced</th>${devs.map((d) => html`<td>${d.announced ? fmtDate(d.announced) : html`<em class="ask__none">not recorded</em>`}</td>`)}</tr>`);
    } else if (a.id === 'performance') {
      rows.push(html`<tr><th scope="row">Performance score</th>${devs.map((d) => { const s = allCategoryScores(row(d.id)).performance; return html`<td>${s ? Math.round(s.score) : html`<em class="ask__none">no tests</em>`}</td>`; })}</tr>`);
    } else {
      const per = devs.map((d) => facts(d, a.id));
      (per[0] ?? []).forEach((f, k) => rows.push(html`<tr><th scope="row">${f.label}</th>${per.map((fs) => html`<td>${fs[k]?.text ?? html`<em class="ask__none">not recorded</em>`}</td>`)}</tr>`));
    }
    const v = compareAttr(ids, a);
    if (v) verdicts.push(v);
  }
  return {
    html: html`<p>${ids.map((id, i) => html`${i ? ' vs ' : ''}${link(id)}`)}${attrs.length ? `, ${attrs.map((a) => a.label.toLowerCase()).join(' and ')}` : ''}:</p>
      <div class="ask__table"><table><thead><tr><th></th>${ids.map((id) => html`<th scope="col">${row(id).name}</th>`)}</tr></thead><tbody>${rows}</tbody></table></div>
      ${overall ? html`<p>${overall.line}</p>` : ''}
      ${verdicts.length ? html`<p>${verdicts.map((v, i) => html`${i ? ' ' : ''}${v}`)}</p>` : ''}
      <p class="ask__src">Values are the makers' specifications or the sources shown on each device page.${overall ? ' Scores are platform analysis of recorded specifications and tests.' : ''}</p>
      <p class="ask__more"><a href="${href(`/compare/${ids.join(',')}`)}">Open the full comparison, with verdicts and sources</a></p>`,
    devices: ids,
  };
}

function filterRows(norm, text, { category }) {
  const brands = detectBrands(norm);
  const year = /\b(20[12]\d)\b/.exec(norm)?.[1];
  const maxPrice = detectMaxPrice(text);
  let rows = store.devices.filter((r) => r.category === category);
  if (brands.length) rows = rows.filter((r) => brands.includes(r.brand) || brands.includes(store.brandById.get(r.brand)?.parent));
  if (year) rows = rows.filter((r) => r.f?.year === Number(year));
  if (maxPrice) rows = rows.filter((r) => { const p = displayPrice(r, maxPrice.currency); return p && p.amount <= maxPrice.amount; });
  if (/\b5g\b/.test(norm)) rows = rows.filter((r) => r.f?.g5);
  if (/\b(foldables?|fold(ing)?|flip)\b/.test(norm)) rows = rows.filter((r) => r.form === 'foldable');
  if (/\b(sold|available|buy) in malaysia\b|\bmalaysia\b/.test(norm)) rows = rows.filter((r) => r.f?.soldMY);
  const chips = detectChipsets(norm);
  const chip = chips.length === 1 ? chips[0] : null;
  if (chip) rows = rows.filter((r) => (r.chipset ?? r.f?.chipset) === chip);
  const wireless = /\bwireless(ly)?\b|\bqi2?\b/.test(norm) && !/\b(without|no) wireless/.test(norm);
  if (wireless) rows = rows.filter((r) => r.f?.wireless);
  const tele = /\btelephoto|\bperiscope|\boptical zoom/.test(norm);
  if (tele) rows = rows.filter((r) => r.f?.telephoto);
  const flagship = /\bflagships?\b/.test(norm);
  if (flagship) rows = rows.filter((r) => r.flagship);
  return { rows, brands, year, maxPrice, chip, wireless, tele, flagship };
}

function filterWords({ brands, year, maxPrice, chip, wireless, tele, flagship }, category, extra = '') {
  const cat = `${flagship ? 'flagship ' : ''}${store.categoryById.get(category)?.name.toLowerCase() ?? 'devices'}`;
  const withs = [chip && `the ${store.chipsetById.get(chip)?.name}`, wireless && 'wireless charging', tele && 'a telephoto camera'].filter(Boolean);
  extra = `${withs.length ? ` with ${withs.join(' and ')}` : ''}${extra}`;
  return `${brands.length ? brands.map(brandName).join(' / ') + ' ' : ''}${cat}${extra}${year ? ` from ${year}` : ''}${maxPrice ? ` under ${fmtPrice(maxPrice.amount, maxPrice.currency)}` : ''}`;
}

function answerRank(norm, text, attr, category) {
  const f = filterRows(norm, text, { category });
  const low = SUPER_LOW.test(norm) && !SUPER_HIGH.test(norm.replace(/\blight(er|est)?\b/, ''));
  const better = attr.better === 'lower' ? !/(most expensive|heaviest|priciest|highest price)/.test(norm) : !low;
  const key = attr.rank;
  const ranked = f.rows.map((r) => ({ r, v: RANKERS[key](r) })).filter((x) => x.v != null && !(key === 'wirelessW' && x.v === 0))
    .sort((a, b) => ((attr.better === 'lower') === better ? a.v - b.v : b.v - a.v)).slice(0, 5);
  if (!ranked.length) return { html: html`<p>I couldn't find any ${filterWords(f, category)} with a recorded ${attr.label.toLowerCase()}.</p>` };
  const asc = (attr.better === 'lower') === better;
  const heading = `${filterWords(f, category)} by ${attr.label.toLowerCase()}, ${asc ? 'lowest' : 'highest'} first`;
  return {
    html: html`<p>Top ${ranked.length} ${heading}, from ${plural(f.rows.length, 'device')} in the database:</p>
      <ol class="ask__rank">${ranked.map((x) => html`<li>${link(x.r.id)} <span class="ask__val">${RANK_TEXT[key](x.v, x.r)}</span></li>`)}</ol>
      <p class="ask__src">From each maker's specifications${key === 'performance' ? ' and benchmark sources (platform scores)' : ''}${key === 'price' ? '; Malaysian launch prices, or conversions marked on the device pages' : ''}. Devices without a recorded value are left out.</p>`,
    devices: ranked.map((x) => x.r.id),
  };
}

function answerBest(norm, text, category) {
  const profile = detectProfile(text) ?? 'balanced';
  const maxPrice = detectMaxPrice(text);
  // "best Samsung phone", "best phone with a telephoto": the same filters as lists and rankings
  const f = filterRows(norm, text, { category });
  const narrowed = f.brands.length || f.year || f.chip || f.wireless || f.tele || f.flagship || /\b5g\b|\b(foldables?|fold(ing)?|flip)\b|\bmalaysia\b/.test(norm);
  const keep = narrowed ? new Set(f.rows.map((r) => r.id)) : null;
  const list = profileLeaderboard(category, profile, { maxPrice, limit: keep ? 1000 : 5 }).filter((x) => !keep || keep.has(x.id)).slice(0, 5);
  const cat = keep ? filterWords({ ...f, maxPrice: null }, category) : store.categoryById.get(category)?.name.toLowerCase() ?? 'devices';
  const prof = store.profileById.get(profile);
  if (!list.length) {
    // nothing has enough evidence to score (earbuds, bands): list what matches the filters instead, newest first
    const anc = /\b(anc|noise[- ]?cancel\w*)\b/.test(norm);
    const rows = f.rows.filter((r) => (!maxPrice || (displayPrice(r, maxPrice.currency)?.amount ?? Infinity) <= maxPrice.amount) && (!anc || r.f?.anc))
      .sort((a, b) => String(b.announced ?? '').localeCompare(String(a.announced ?? ''))).slice(0, 8);
    if (!rows.length) return { html: html`<p>No ${cat}${maxPrice ? ` under ${fmtPrice(maxPrice.amount, maxPrice.currency)}` : ''}${anc ? ' with noise cancelling' : ''} are recorded yet.</p>` };
    return {
      html: html`<p>There isn't enough independent evidence to rank ${cat} yet, so here are the ${anc ? 'ones with noise cancelling' : 'matching ones'}${maxPrice ? ` under ${fmtPrice(maxPrice.amount, maxPrice.currency)}` : ''}, newest first:</p>
        <ul class="ask__list">${rows.map((r) => html`<li>${link(r.id)} <span class="ask__val">${displayPrice(r, 'MYR') ? priceText(displayPrice(r, 'MYR')) : 'price not recorded'}</span></li>`)}</ul>
        <p class="ask__src">From the makers' specifications and Malaysian launch prices. Compare them to see the details side by side.</p>`,
      devices: rows.map((r) => r.id),
    };
  }
  return {
    html: html`<p>Top ${cat}${profile !== 'balanced' ? ` for ${prof.label.toLowerCase()}` : ''}${maxPrice ? ` under ${fmtPrice(maxPrice.amount, maxPrice.currency)}` : ''}, by this site's scores:</p>
      <ol class="ask__rank">${list.map((x) => html`<li>${link(x.id)} <span class="ask__val">${Math.round(x.result.score)}/100</span></li>`)}</ol>
      <p class="ask__src">Scores are platform analysis built from the recorded specifications and independent tests, not a reviewer's opinion. <a href="${href('/methodology')}">How scoring works</a>.</p>
      <p class="ask__more"><a href="${href(`/devices/${category}`, { rank: profile, priceMax: maxPrice?.amount, cur: maxPrice?.currency, brand: f.brands[0], chipset: f.chip, wireless: f.wireless ? 1 : '', telephoto: f.tele ? 1 : '', flagship: f.flagship ? 1 : '' })}">See the full ranking</a></p>`,
    devices: list.map((x) => x.id),
  };
}

function answerList(norm, text, category) {
  const f = filterRows(norm, text, { category });
  if (!f.rows.length) return null;
  const rows = [...f.rows].sort((a, b) => String(b.announced ?? '').localeCompare(String(a.announced ?? '')));
  return {
    html: html`<p>${plural(rows.length, store.categoryById.get(category)?.singular.toLowerCase() ?? 'device')} in the database match ${filterWords(f, category)}:</p>
      <ul class="ask__list">${rows.slice(0, 12).map((r) => html`<li>${link(r.id)} <span class="ask__val">${r.announced ? String(r.announced).slice(0, 7) : ''}${displayPrice(r, 'MYR')?.local ? ` · ${fmtPrice(displayPrice(r, 'MYR').amount, 'MYR')}` : ''}</span></li>`)}</ul>
      ${rows.length > 12 ? html`<p class="ask__more"><a href="${href(`/devices/${category}`, { brand: f.brands[0], year: f.year, chipset: f.chip, wireless: f.wireless ? 1 : '', telephoto: f.tele ? 1 : '', flagship: f.flagship ? 1 : '' })}">See all ${rows.length} in the browser</a></p>` : ''}`,
    devices: rows.slice(0, 12).map((r) => r.id),
  };
}

const PRICE_HELP = /\b(where|how)\b.{0,40}\bprices?\b|\bprices?\b.{0,30}\b(come from|sourced?|from where|accurate|up to date|updated|current|live|reliable)\b/;
const priceHelp = () => html`<p>Prices are Malaysian launch prices: the recommended retail price reported at launch by SoyaCincau, Lowyat.NET or Nasi Lemak Tech, with early-bird or promotional prices noted beside them. Each price links to its report on the device page. Prices are not tracked after launch, so shop prices are often lower now. When no Malaysian price was found the page says so, and prices in other currencies are converted and marked ≈. <a href="${href('/methodology')}">How prices are handled</a>.</p>`;

const HELP = [
  [/\b(how|why).{0,30}\b(score|scores|scoring|rank|ranking|rated|calculated|verdict)/, () => html`<p>Scores compare each device with the best recorded value in its category (for example battery capacity or a lab's battery test), then weight the results by use case. Comparisons only use evidence every compared device has. Everything is labelled as platform analysis. <a href="${href('/methodology')}">Read the full method</a>.</p>`],
  [/\b(live|real ?time|up to date|current|how old|data as of|last updated|fresh)\b/, () => { const d = store.core.build.data ?? {}; return html`<p>The specifications, tests and prices are a dated snapshot: the newest check is ${fmtDate(d.asOf)}, covering devices announced from ${fmtDate(d.announcedFrom, 'month')} to ${fmtDate(d.announcedTo, 'month')}. Exchange rates and the latest headlines update automatically. <a href="${href('/methodology')}">How current the data is</a>.</p>`; }],
  [/\b(exchange|currency|convert|conversion|ringgit|usd rate)\b/, () => html`<p>Exchange rates in use: ${ratesLabel()}. Converted prices are marked ≈ and are estimates; recorded Malaysian launch prices are always shown first.</p>`],
  [/\b(badge|lab|off\b|confidence|evidence class|what does .{0,20}mean)/, () => html`<p>Every value carries its evidence type: OFF is the maker's own specification, LAB an independent measurement, DB a benchmark database, NEWS a news report, and CALC or EST values the platform calculated or estimated. Confidence (the bars) reflects how many independent sources agree. <a href="${href('/methodology')}">More on evidence</a>.</p>`],
  [/\b(sources?|where .{0,20}(data|information) come|trust|reliable)\b/, () => html`<p>Specifications come from each maker's official pages (or Malaysian launch coverage when a page is gone), prices from Malaysian launch articles, and tests from registered labs and reviewers. Every device page lists its sources with links, and the <a href="${href('/methodology')}">source registry</a> explains each one.</p>`],
  [/\b(who are you|what (can|do) you|help|how do i use|what can i ask)\b/, () => html`<p>I answer from this site's data only and won't guess (switch on AI answers above for a conversational summary from a small model on your device). Try:</p><ul class="ask__list"><li>a device and a detail: "Galaxy S26 battery"</li><li>an opinion from the scores: "Is the Redmi Note 17 worth it?", "Is it good for gaming?"</li><li>a yes/no check: "Does the iPhone 17 have eSIM?"</li><li>two devices: "Galaxy S26 vs iPhone 17"</li><li>a ranking or list: "lightest phone under RM2,000", "Huawei watches 2025"</li><li>a term: "What is LTPO?"</li></ul>`],
];

// ------------------------------------------------------------------ "is it good?": a verdict from the site's own scores
const EVAL = /\b(good|great|bad|decent|worth\w*|recommend\w*|solid|pros|cons|strengths?|weakness(es)?|downsides?|drawbacks?|disadvantages?|advantages?|verdict|review|should i (buy|get|choose)|how good)\b|\b(is|are|was)\b.{0,30}\b(ok(ay)?|fine)\b/;
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
const share = (p) => (p <= 0.1 ? 'top 10%' : p <= 0.25 ? 'top quarter' : p >= 0.9 ? 'bottom 10%' : p >= 0.75 ? 'bottom quarter' : 'middle');

// attribute asked about -> score category it is judged in ("is the display good?")
const FOCUS = { display: 'display', refresh: 'display', brightness: 'display', charging: 'charging', wireless: 'charging', battery: 'battery',
  camera: 'camera', performance: 'performance', chip: 'performance', software: 'software', weight: 'build', size: 'build', water: 'durability' };
// score category -> the spec shown beside it
const CAT_FACT = { performance: 'chip', gaming: 'chip', battery: 'battery', charging: 'charging', display: 'display', camera: 'camera', software: 'software', build: 'weight', durability: 'water' };

const boards = new Map();
function board(category, profileId) {
  const key = `${category}:${profileId}`;
  if (!boards.has(key)) boards.set(key, profileLeaderboard(category, profileId, { limit: 100000 }));
  return boards.get(key);
}

function shortFact(dev, scId) {
  const f = facts(dev, CAT_FACT[scId]).find((x) => x.text);
  if (!f) return '';
  return f.text.length > 70 ? `${f.text.slice(0, 68)}…` : f.text;
}

/** Strong and weak areas: like-for-like ranks in each score category the device has evidence for. */
function standings(dev) {
  const r = row(dev.id);
  const cats = allCategoryScores(r);
  return applicableScoreCategories(r.category)
    .map((sc) => ({ sc, s: cats[sc.id], rank: rankOf(dev.id, r.category, sc.id) }))
    .filter((x) => x.s && x.rank);
}

function supportLine(dev) {
  const years = dev.specs?.software?.os_updates_years;
  const start = Number(String(dev.released ?? dev.announced ?? '').slice(0, 4));
  if (!years || !start) return '';
  const until = start + years;
  const now = new Date().getFullYear();
  return html`<p><strong>Updates:</strong> ${years} years of OS upgrades promised${until ? `, to about ${until}` : ''}${until <= now ? ' (that promise has run out or is ending)' : ''}.</p>`;
}

async function answerVerdict(id, norm, text, attrs) {
  const dev = await full(id);
  const r = row(id);
  const catDef = store.categoryById.get(r.category);
  const plural_ = catDef?.name.toLowerCase() ?? 'devices';
  const title = link(id);
  const caveat = html`<p class="ask__src">This is platform analysis of the recorded specifications and independent tests, not a hands-on review: things this site doesn't score (how the software feels, service and repairs) matter too. <a href="${href('/methodology')}">How scoring works</a>.</p>`;
  const more = html`<p class="ask__more"><a href="${href(`/device/${id}`, { section: 'scores' })}">See its scores and evidence</a>${dev.related?.length ? html` · <a href="${href(`/compare/${[id, ...dev.related.slice(0, 2)].join(',')}`)}">Compare with its rivals</a>` : ''}</p>`;

  // "is the display good?" -> judge that one area
  const usedFor = /\bfor (gaming|games|photos?|photography|pictures|students?|school|study|value|the money|battery|long ?term|years|performance|work)\b/.test(norm);
  const focusAttr = !usedFor && attrs.find((a) => FOCUS[a.id] && applicableScoreCategories(r.category).some((c) => c.id === FOCUS[a.id]));
  if (focusAttr) {
    const scId = FOCUS[focusAttr.id];
    const sc = store.scoreCategoryById.get(scId);
    const s = allCategoryScores(r)[scId];
    const rank = rankOf(id, r.category, scId);
    const fs = facts(dev, CAT_FACT[scId]).filter((f) => f.text);
    const judged = rank ? (rank.percentile <= 0.25 ? 'one of its strong points' : rank.percentile >= 0.75 ? 'one of its weaker points' : 'about average') : null;
    return {
      html: html`<p>${title}: ${sc.label.toLowerCase()} is ${judged
        ? html`<strong>${judged}</strong>. It ranks ${ordinal(rank.position)} of ${rank.of} ${plural_} that have the same kind of evidence (${share(rank.percentile)}), with a score of ${Math.round(s.score)}/100.`
        : s ? html`scored ${Math.round(s.score)}/100, but too few ${plural_} share its evidence for a fair ranking.` : 'not scored yet: there is not enough recorded evidence.'}</p>
        ${fs.length ? html`<ul class="ask__facts">${fs.map((f) => html`<li><span>${f.label}</span> ${f.text}</li>`)}</ul>` : ''}
        ${sourcesLine(dev, fs.map((f) => f.path))}${caveat}${more}`,
      devices: [id],
    };
  }

  // overall, or for a use case ("good for gaming?", "worth the money?")
  let profileId = detectProfile(text) ?? 'balanced';
  let note = '';
  let list = board(r.category, profileId);
  let pos = list.findIndex((x) => x.id === id);
  if (pos < 0 && profileId !== 'balanced') {
    const wanted = store.profileById.get(profileId);
    const fit = profileScore(allCategoryScores(r), wanted, { category: r.category, id: r.id });
    note = fit && fit.relevance < 0.5
      ? html` ${wanted?.label ?? 'That use'} doesn't really apply to ${plural_}, so this is the overall score.`
      : html` There isn't enough recorded evidence to score it for ${wanted?.label.toLowerCase() ?? 'that use'} (${profileId === 'gaming' || profileId === 'performance' ? 'no benchmark or gaming test results for it or its chip' : 'too few of the relevant values are recorded'}), so this is the overall score.`;
    profileId = 'balanced';
    list = board(r.category, profileId);
    pos = list.findIndex((x) => x.id === id);
  }
  const prof = store.profileById.get(profileId);
  const phrase = profileId === 'balanced' ? 'overall' : `for ${prof.label.toLowerCase()}`;
  // How much evidence stands behind the score: which weighted areas are missing, and whether any of it is a real test.
  const cats = allCategoryScores(r);
  const applicable = new Set(applicableScoreCategories(r.category).map((c) => c.id));
  const missingAreas = Object.keys(prof.weights).filter((c) => applicable.has(c) && !cats[c]).map((c) => store.scoreCategoryById.get(c)?.label).filter(Boolean);
  const specOnly = Object.values(cats).every((c) => c.specOnly);
  const partial = specOnly || missingAreas.length > 0;
  let lead;
  if (pos < 0) {
    lead = html`<p>${title}: there isn't enough recorded evidence to score it ${phrase} yet, so I can't give a fair verdict. Here is what the record shows.</p>`;
  } else {
    const p = list.length > 1 ? pos / (list.length - 1) : 0;
    const word = partial
      ? (p <= 0.1 ? 'near the top' : p <= 0.33 ? 'in the upper third' : p <= 0.66 ? 'around the middle' : 'in the lower third')
      : (p <= 0.1 ? `one of the strongest ${plural_} in this database` : p <= 0.33 ? 'a strong choice' : p <= 0.66 ? 'a mid-pack choice' : `behind most ${plural_} here`);
    lead = partial
      ? html`<p><strong>Short answer:</strong> on the evidence recorded so far, ${title} ranks ${word} ${phrase}: ${ordinal(pos + 1)} of ${list.length} ${plural_} with enough evidence (${Math.round(list[pos].result.score)}/100).${note}</p>`
      : html`<p><strong>Short answer:</strong> ${title} is ${word} ${phrase}, by this site's scores: ${ordinal(pos + 1)} of ${list.length} ${plural_} with enough evidence (${Math.round(list[pos].result.score)}/100).${note}</p>`;
  }
  const limits = pos >= 0 && partial
    ? html`<p class="ask__src"><strong>Read this as partial.</strong> ${specOnly ? 'No independent test of this device is recorded yet, so the score comes from its specification sheet only. Spec-sheet scores favour big batteries, fast charging and low weight; lab tests of camera quality, speed and battery life would be needed to judge those. ' : ''}${missingAreas.length ? `Not scored for it yet: ${missingAreas.join(', ')}.` : ''}</p>`
    : '';
  // against devices launched at a similar Malaysian price
  let peers = '';
  const mine = displayPrice(r, 'MYR');
  if (mine?.local && pos >= 0) {
    const lo = mine.amount * 0.8;
    const hi = mine.amount * 1.2;
    const near = list.filter((x) => { const q = displayPrice(row(x.id), 'MYR'); return q?.local && q.amount >= lo && q.amount <= hi; });
    const at = near.findIndex((x) => x.id === id);
    if (near.length >= 3 && at >= 0) {
      const ahead = near.slice(0, Math.min(at, 2));
      peers = html`<p><strong>At its price</strong> (Malaysian launch prices ${fmtPrice(Math.round(lo), 'MYR')}–${fmtPrice(Math.round(hi), 'MYR')}): ${ordinal(at + 1)} of ${near.length}.${ahead.length ? html` Top ${ahead.length > 1 ? 'scorers' : 'scorer'} in that range: ${ahead.map((x, i) => html`${i ? ', ' : ''}${link(x.id)}`)}.` : html` Nothing in that price range scores higher.`}</p>`;
    }
  }
  const st = standings(dev);
  const strong = st.filter((x) => x.rank.percentile <= 0.25).sort((a, b) => a.rank.percentile - b.rank.percentile).slice(0, 3);
  const weak = st.filter((x) => x.rank.percentile >= 0.75).sort((a, b) => b.rank.percentile - a.rank.percentile).slice(0, 3);
  const item = (x) => html`<li><span>${x.sc.label}</span> ${ordinal(x.rank.position)} of ${x.rank.of} (${share(x.rank.percentile)})${shortFact(dev, x.sc.id) ? `: ${shortFact(dev, x.sc.id)}` : ''}</li>`;
  const age = dev.announced ? html`<p class="small">Announced ${fmtDate(dev.announced)}. Newer models are scored in the same database, so an older device ranks lower as they arrive.</p>` : '';
  return {
    html: html`${lead}${peers}
      ${strong.length ? html`<p><strong>Strengths</strong></p><ul class="ask__facts">${strong.map(item)}</ul>` : ''}
      ${weak.length ? html`<p><strong>Weaker points</strong></p><ul class="ask__facts">${weak.map(item)}</ul>` : ''}
      ${!strong.length && !weak.length ? html`<p>No area stands out as far ahead or behind the ${plural_} it can be compared with fairly.</p>` : ''}
      ${supportLine(dev)}${age}${limits}${caveat}${more}`,
    devices: [id],
  };
}

// ------------------------------------------------------------------ yes/no feature questions ("does it have NFC?")
const YESNO = /^(does|do|is|are|has|have|can|will|got|any|did)\b|\b(support(s|ed)?|come with|comes with|equipped with|have|has|got)\b/;
const has = (text, re) => (text == null ? null : re.test(String(text)));
const FEATURES = [
  { id: 'esim', re: /\be ?sim\b/, label: 'eSIM', attr: 'sim', test: (s) => has(s.connectivity?.sim, /e-?sim|embedded/i), unsure: 'no eSIM is mentioned on its specification sheet' },
  { id: 'dualsim', re: /\bdual ?sim|two sims?|2 sims?\b/, label: 'Dual SIM', attr: 'sim', test: (s) => has(s.connectivity?.sim, /dual|two|2 ?x|sim 1 \+ sim 2|\+ ?e-?sim/i), unsure: 'the SIM section doesn’t list two SIMs' },
  { id: 'wireless', re: /\bwireless(ly)?\b|\bqi2?\b/, label: 'Wireless charging', attr: 'wireless', test: (s) => (s.charging?.wireless_w > 0 ? true : s.charging?.wireless_w === 0 ? false : null), detail: (s) => (s.charging?.wireless_w > 0 ? `${s.charging.wireless_w} W` : '') },
  { id: 'reverse', re: /\breverse (wireless )?charg\w*|charge (other|my) (phone|earbuds|devices)/, label: 'Reverse charging', attr: 'charging', test: (s) => (s.charging?.reverse_w > 0 ? true : s.charging?.reverse_w === 0 ? false : null), detail: (s) => (s.charging?.reverse_w > 0 ? `${s.charging.reverse_w} W` : '') },
  { id: 'fast', re: /\b(fast|quick|super ?fast|flash|turbo|super ?v?ooc|hyper) ?charg\w*/, label: 'Fast charging', attr: 'charging', test: (s) => (s.charging?.wired_w ? s.charging.wired_w >= 25 : null), detail: (s) => (s.charging?.wired_w ? `${s.charging.wired_w} W wired` : '') },
  { id: 'jack', re: /\b(headphone|audio|earphone|headset) jack\b|\b3 5 ?mm\b|\bjack\b/, label: '3.5 mm headphone jack', attr: 'jack', test: (s) => (typeof s.audio?.jack === 'boolean' ? s.audio.jack : null) },
  { id: 'card', re: /\bmicro ?sd\b|memory card|\bsd card|expandable|card slot/, label: 'Memory card slot', attr: 'card', test: (s) => (s.memory?.card ? !/^no\b/i.test(s.memory.card) : typeof s.memory?.expandable === 'boolean' ? s.memory.expandable : null), detail: (s) => (s.memory?.card && !/^(yes|no)$/i.test(s.memory.card) ? s.memory.card : '') },
  { id: 'ir', re: /\bir blaster|\binfrared\b|\bir (remote|sensor)\b|remote control/, label: 'IR blaster', attr: 'sensors', test: (s) => has(s.sensors, /infrared|ir blaster|\bir\b/i), unsure: 'no infrared (IR) emitter is listed among its sensors' },
  { id: 'stereo', re: /\bstereo\b|dual speakers?/, label: 'Stereo speakers', attr: 'speakers', test: (s) => (s.audio?.speakers ? /stereo|dual|two|symmetric/i.test(s.audio.speakers) : null) },
  { id: 'uwb', re: /\buwb\b|ultra ?wide ?band/, label: 'Ultra-wideband (UWB)', attr: 'network', test: (s) => (typeof s.connectivity?.uwb === 'boolean' ? s.connectivity.uwb : null) },
  { id: 'nfc', re: /\bnfc\b|contactless|tap to pay|google (pay|wallet)|samsung (pay|wallet)|apple pay/, label: 'NFC', attr: 'network', test: (s) => (typeof s.connectivity?.nfc === 'boolean' ? s.connectivity.nfc : null) },
  { id: '5g', re: /\b5g\b/, label: '5G', attr: 'network', test: (s, r) => (r?.f?.g5 ? true : s.connectivity?.cellular || s.connectivity?.technology ? /5g|nr\b/i.test(`${s.connectivity.cellular ?? ''} ${s.connectivity.technology ?? ''}`) : null) },
  { id: 'wifi7', re: /\bwi ?fi ?7\b|802 11 ?be\b/, label: 'Wi-Fi 7', attr: 'wifi', test: (s) => has(s.connectivity?.wifi, /\bbe\b|wi-?fi ?7|802\.11 ?be/i) },
  { id: 'wifi6', re: /\bwi ?fi ?6e?\b|802 11 ?ax\b/, label: 'Wi-Fi 6', attr: 'wifi', test: (s) => has(s.connectivity?.wifi, /\bax\b|\bbe\b|wi-?fi ?[67]|802\.11 ?(ax|be)/i) },
  { id: 'ois', re: /\bois\b|optical (image )?stabili[sz]\w*|stabili[sz]ation/, label: 'Optical image stabilisation (OIS)', attr: 'camera', test: (s) => { const t = [...(s.camera?.rear_detail ?? []), s.camera?.features ?? ''].join(' '); return /\bois\b|optical image stabili/i.test(t) ? true : s.camera?.rear_detail?.length ? false : null; }, unsure: 'OIS is not mentioned in its camera specifications' },
  { id: 'tele', re: /telephoto|optical zoom|periscope|zoom (lens|camera)/, label: 'Telephoto (optical zoom) camera', attr: 'camera', test: (s) => (s.camera?.rear?.length ? s.camera.rear.some((c) => /tele|periscope/.test(c.role)) || s.camera?.zoom_optical_x > 1 : null), detail: (s) => (s.camera?.zoom_optical_x > 1 ? `${s.camera.zoom_optical_x}x optical` : '') },
  { id: 'fingerprint', re: /fingerprint/, label: 'Fingerprint reader', attr: 'biometrics', test: (s) => (s.biometrics?.fingerprint ? !/^no\b/i.test(s.biometrics.fingerprint) : has(s.sensors, /fingerprint/i) || null), detail: (s) => (s.biometrics?.fingerprint && !/^yes$/i.test(s.biometrics.fingerprint) ? s.biometrics.fingerprint : '') },
  { id: 'face', re: /face (unlock|id|recognition)/, label: 'Face unlock', attr: 'biometrics', test: (s) => (s.biometrics?.face ? !/^no\b/i.test(s.biometrics.face) : null), detail: (s) => (s.biometrics?.face && !/^yes$/i.test(s.biometrics.face) ? s.biometrics.face : '') },
  { id: 'ecg', re: /\becg\b|\bekg\b|electrocardiogram/, label: 'ECG', attr: null, test: (s) => has([s.health?.sensors, s.health?.features].flat().filter(Boolean).join(' ') || null, /ecg|electrocardio|electrical heart/i), unsure: 'ECG is not listed among its health sensors or features' },
  { id: 'spo2', re: /\bspo2\b|blood oxygen/, label: 'Blood-oxygen (SpO2) reading', attr: null, test: (s) => has([s.health?.sensors, s.health?.features].flat().filter(Boolean).join(' ') || null, /spo2|blood oxygen|oxygen saturation/i), unsure: 'SpO2 is not listed among its health sensors or features' },
  { id: 'gps', re: /\bgps\b|\bgnss\b/, label: 'GPS', attr: 'gps', test: (s) => (typeof s.connectivity?.gps === 'boolean' ? s.connectivity.gps : s.connectivity?.gps ? !/^no\b|connected|phone/i.test(s.connectivity.gps) : s.connectivity?.positioning ? /gps/i.test(s.connectivity.positioning) : null), detail: (s) => (typeof s.connectivity?.gps === 'string' ? s.connectivity.gps : '') },
  { id: 'anc', re: /noise ?cancel\w*|\banc\b|block (out )?noise/, label: 'Active noise cancelling', attr: null, test: (s) => (s.audio?.anc ? !/^no\b/i.test(s.audio.anc) : null), detail: (s) => (s.audio?.anc && !/^(yes|no)$/i.test(s.audio.anc) ? s.audio.anc : ''), unsure: 'noise cancelling is not mentioned on its specification sheet' },
  { id: 'wcase', re: /wireless(ly)? charg\w* case|case .*wireless/, label: 'Wireless charging case', attr: null, test: (s) => (s.charging?.port || s.battery?.case_mah ? Boolean(s.charging?.wireless) : null) },
  { id: 'water', re: /water ?proof|water ?resist\w*|\bip ?\d{2}k?\b|\bipx\d\b|\bswim\w*|\bshower\b|\brain\b|\bsplash\w*/, label: 'Water resistance', attr: 'water', test: (s) => (s.build?.ip || s.build?.water || s.build?.water_m ? true : s.build?.dimensions ? false : null), detail: (s) => [s.build?.ip, s.build?.water].filter(Boolean).join(', '), unsure: 'no water-resistance rating is recorded' },
];

function detectFeatures(norm) {
  const hits = FEATURES.filter((f) => f.re.test(norm));
  // "Wi-Fi 6" also matches Wi-Fi 7 phones, but asking about 7 shouldn't also ask about 6
  return hits.filter((f) => !(f.id === 'wifi6' && hits.some((h) => h.id === 'wifi7')) && !(f.id === 'dualsim' && hits.some((h) => h.id === 'esim') && !/dual/.test(norm)));
}

async function answerFeatures(ids, feats) {
  const devs = await Promise.all(ids.map(full));
  const paths = [];
  const lines = [];
  for (const dev of devs) {
    for (const f of feats) {
      const s = dev.specs ?? {};
      const v = f.test(s, row(dev.id));
      const d = v !== null && f.detail ? f.detail(s) : '';
      const fact = f.attr ? facts(dev, f.attr).find((x) => x.text) : null;
      if (fact) paths.push([dev, fact.path]);
      const who = ids.length > 1 ? html`<span>${row(dev.id).name}${feats.length > 1 ? `, ${f.label}` : ''}</span> ` : feats.length > 1 ? html`<span>${f.label}</span> ` : '';
      if (v === true) lines.push(html`<li>${who}<strong>Yes</strong>${d ? `, ${d}` : ''}.</li>`);
      else if (v === false && f.unsure) lines.push(html`<li>${who}<strong>Not listed</strong>: ${f.unsure}.${fact ? html` The record says: ${fact.label.toLowerCase()} ${fact.text}.` : ''}</li>`);
      else if (v === false) lines.push(html`<li>${who}<strong>No</strong>${f.id === 'fast' && d ? html` (${d}; this site counts 25 W or more as fast)` : f.id === 'jack' ? ' (use USB-C or Bluetooth headphones)' : ''}.</li>`);
      else lines.push(html`<li>${who}<em class="ask__none">Not recorded</em>: the specifications collected for it don't say.${fact ? html` Recorded ${fact.label.toLowerCase()}: ${fact.text}.` : ''}</li>`);
    }
  }
  const head = ids.length === 1 ? html`<p>${link(ids[0])}, ${feats.map((f) => f.label).join(' and ')}:</p>` : html`<p>${feats.map((f) => f.label).join(' and ')}:</p>`;
  const src = new Map();
  for (const [dev, p] of paths) { const s = sourceOf(dev, p); if (s && !src.has(s.name)) src.set(s.name, s); }
  return {
    html: html`${head}<ul class="ask__facts">${lines}</ul>
      ${src.size ? html`<p class="ask__src">Source${src.size > 1 ? 's' : ''}: ${[...src.values()].map((s, i) => html`${i ? ', ' : ''}${s.url ? html`<a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.name}</a>` : s.name}`)}</p>` : ''}
      <p class="ask__more">${ids.map((id, i) => html`${i ? ' · ' : ''}<a href="${href(`/device/${id}`)}">${ids.length > 1 ? row(id).name : 'See all its specifications'}</a>`)}</p>`,
    devices: ids,
  };
}

// ------------------------------------------------------------------ general explanations ("what is IP68?")
const DUST = { 0: 'not protected against dust', 1: 'protected against large objects', 2: 'protected against fingers', 3: 'protected against tools and thick wires', 4: 'protected against small wires', 5: 'dust-protected (some dust can get in, not enough to cause harm)', 6: 'dust-tight', x: 'not tested for dust' };
const WET = { 0: 'not protected against water', 1: 'protected against dripping water', 2: 'protected against dripping water when tilted', 3: 'protected against spraying water', 4: 'protected against splashes from any direction', 5: 'protected against water jets', 6: 'protected against powerful water jets', 7: 'protected against immersion up to 1 m for 30 minutes', 8: 'protected against continuous immersion beyond 1 m, under conditions the maker specifies (often 1.5 m for 30 minutes)', 9: 'protected against close-range, high-pressure, high-temperature water jets' };
const GLOSSARY = [
  [/\bip ?([0-6x])([0-9])(k)?\b/, (m) => html`<p><strong>IP${m[1].toUpperCase()}${m[2]}${m[3] ? 'K' : ''}</strong> is an ingress-protection rating (IEC 60529). The first digit is dust: ${DUST[m[1]] ?? '—'}. The second is water: ${WET[m[2]] ?? '—'}.</p><p>It is tested in a lab with fresh water, seals weaken with age and drops, and makers usually exclude liquid damage from warranty, so it protects against accidents rather than making a device safe for swimming or the sea.</p>`, 'water'],
  [/\b(\d{1,2}) ?atm\b|\batm rating\b|\bwr ?\d{2,3}\b/, (m) => html`<p><strong>${m[1] ? `${m[1]} ATM` : 'ATM ratings'}</strong> describe water pressure a watch withstands: ${m[1] ? `${m[1]} ATM is about the pressure at ${m[1] * 10} m` : '5 ATM is about the pressure at 50 m'} (ISO 22810). 5 ATM watches are fine for swimming in a pool or shallow sea but not for diving or high-speed water sports; 10 ATM gives more margin.</p>`, 'water'],
  [/\bmah\b|\bmilliamp/, () => html`<p><strong>mAh</strong> (milliampere-hours) is how much charge a battery holds. More mAh usually means longer battery life, but the chip, screen and software matter as much, so two phones with the same capacity can last very differently. Where available, measured battery tests on the device pages compare endurance directly.</p>`, 'battery'],
  [/\bsilicon ?carbon\b|\bsi ?c\b/, () => html`<p><strong>Silicon-carbon batteries</strong> use silicon in the anode instead of pure graphite, packing more energy into the same space. That is why many 2025 phones fit 6,000 mAh or more into slim bodies.</p>`, 'battery'],
  [/\bltpo\b/, () => html`<p><strong>LTPO</strong> is an OLED display backplane that lets the refresh rate drop very low (down to 1–10 Hz) for still content, saving battery, while still running at 120 Hz for scrolling and games.</p>`, 'display'],
  [/\b(a?m?oled|super retina|dynamic amoled)\b/, () => html`<p><strong>OLED</strong> screens (AMOLED is a common name for the same idea) light every pixel individually. That gives true blacks, high contrast and good power use on dark content. <strong>LCD</strong> screens use a backlight: usually cheaper, with greyer blacks.</p>`, 'display'],
  [/\b(lcd|ips)\b/, () => html`<p><strong>LCD</strong> (often IPS LCD) screens light the picture with a backlight. They are cheaper to make and avoid low-brightness flicker, but blacks look greyer and contrast is lower than on OLED.</p>`, 'display'],
  [/\brefresh rate|\b\d{2,3} ?hz\b|\bhz\b/, () => html`<p><strong>Refresh rate</strong> is how many times per second the screen redraws. 90–144 Hz makes scrolling and animation look smoother than 60 Hz. It uses more power, which is why many phones drop the rate automatically on still content.</p>`, 'refresh'],
  [/\bnits?\b|\bbrightness\b/, () => html`<p><strong>Nits</strong> (candela per square metre) measure screen brightness. Makers usually quote peak brightness on a small, bright HDR patch, so full-screen brightness in sunlight is lower. Independent lab measurements, where recorded, compare better.</p>`, 'brightness'],
  [/\bpwm\b|\bflicker\b/, () => html`<p><strong>PWM dimming</strong> dims an OLED screen by switching it on and off very fast. Some people notice eye strain at low brightness. A higher PWM frequency (for example 2,160 Hz or more) or DC-like dimming reduces this.</p>`, null],
  [/\bhdr ?10\+?|\bdolby vision\b|\bhdr\b/, () => html`<p><strong>HDR</strong> (HDR10, HDR10+, Dolby Vision) video carries extra brightness and colour information, so highlights look brighter and more detailed on screens that support it.</p>`, null],
  [/\be ?sim\b/, () => html`<p>An <strong>eSIM</strong> is a SIM built into the device: you download your mobile plan instead of inserting a card. Many phones take one physical SIM plus an eSIM. Check that your carrier and plan support eSIM before relying on it.</p>`, 'sim'],
  [/\bnfc\b/, () => html`<p><strong>NFC</strong> (near-field communication) is short-range radio used for contactless payment with a phone wallet, reading or topping up contactless cards, and quick pairing with accessories.</p>`, 'network'],
  [/\buwb\b|ultra ?wide ?band/, () => html`<p><strong>Ultra-wideband (UWB)</strong> is short-range radio that measures distance and direction precisely. It is used for item trackers, digital car keys and pointing your phone at another to share files.</p>`, 'network'],
  [/\b5g\b/, () => html`<p><strong>5G</strong> is the current generation of mobile networks: faster data and lower delay than 4G where there is coverage. A 5G phone still uses 4G elsewhere, and it only matters if your plan and area have 5G.</p>`, 'network'],
  [/\b4g\b|\blte\b/, () => html`<p><strong>4G (LTE)</strong> is the previous mobile-network generation. It is still widely used and fast enough for most tasks. A 4G-only phone can't connect to 5G networks.</p>`, 'network'],
  [/\bwi ?fi ?(6e?|7)\b|\b802 11 ?(ax|be)\b|\bwifi\b|\bwi fi\b/, () => html`<p><strong>Wi-Fi 6</strong> (802.11ax) handles busy networks better than Wi-Fi 5. <strong>6E</strong> adds the less crowded 6 GHz band. <strong>Wi-Fi 7</strong> (802.11be) adds wider channels and multi-link. The gains only show with a matching router.</p>`, 'wifi'],
  [/\bbluetooth\b/, () => html`<p><strong>Bluetooth</strong> connects earbuds, watches and accessories. Newer versions (5.3, 5.4, 6.0) improve efficiency and connection stability, and LE Audio adds better sound sharing. Audio quality also depends on the codecs both devices support.</p>`, 'bluetooth'],
  [/\busb ?(c|type ?c|3|2)\b|\busb\b/, () => html`<p><strong>USB-C</strong> is the connector; the version behind it matters too. USB 2.0 moves data at up to 480 Mbit/s, while USB 3.x reaches 5–20 Gbit/s and may output video to a monitor. Charging speed depends on the charger and protocol, not the port.</p>`, 'usb'],
  [/\bufs\b|\bemmc\b/, () => html`<p><strong>UFS</strong> is the fast storage standard in most phones; UFS 4.x reads and writes much faster than UFS 3.1 or 2.2. <strong>eMMC</strong> is slower storage found in budget phones. It affects app loading, file copying and burst photos.</p>`, 'storage'],
  [/\blpddr\d?x?\b/, () => html`<p><strong>LPDDR</strong> is the low-power RAM standard in phones. Higher generations (LPDDR5X over LPDDR4X) are faster and more efficient. How much RAM you have mainly decides how many apps stay open.</p>`, 'ram'],
  [/\bsoc\b|\bsystem on (a )?chip\b|\bchipset\b|\bprocessor\b/, () => html`<p>The <strong>chipset (SoC)</strong> combines the CPU, graphics, modem, AI engine and image processor on one chip. It decides most of the performance and much of the battery efficiency. The <a href="${href('/chipsets')}">chipset database</a> compares them.</p>`, 'chip'],
  [/\bnpu\b|\btops\b/, () => html`<p>An <strong>NPU</strong> is the part of the chip built for AI tasks such as photo processing, translation and on-device assistants. TOPS figures are the maker's peak numbers and aren't comparable across brands.</p>`, 'chip'],
  [/\bois\b|\beis\b|stabili[sz]ation/, () => html`<p><strong>OIS</strong> (optical image stabilisation) physically moves the lens or sensor to cancel hand shake, giving sharper low-light photos and steadier video. <strong>EIS</strong> is software stabilisation that crops the frame.</p>`, 'camera'],
  [/\bperiscope\b|\btelephoto\b|\boptical zoom\b/, () => html`<p>A <strong>telephoto</strong> camera zooms optically (for example 3x) without losing detail the way digital zoom does. A <strong>periscope</strong> telephoto folds the light sideways so longer zoom (5x and up) fits in a thin phone.</p>`, 'camera'],
  [/\baperture\b|\bf ?\d \d\b/, () => html`<p>The <strong>aperture</strong> (f-number) is the size of the lens opening. A lower number (f/1.6) lets in more light than a higher one (f/2.4), which helps in low light and gives more natural background blur.</p>`, 'camera'],
  [/\bmegapixels?\b|\bmp\b/, () => html`<p><strong>Megapixels</strong> count the pixels in a photo. More megapixels allow cropping, but sensor size, lens quality and processing affect photo quality more than the number alone.</p>`, 'camera'],
  [/\bgorilla (glass|armor)\b|\bvictus\b|\bceramic shield\b|\bkunlun\b|\bdragontrail\b/, () => html`<p><strong>Gorilla Glass, Ceramic Shield, Kunlun Glass</strong> and similar names are strengthened cover glass. Newer generations resist drops and scratches better, but none are unbreakable, so a case still helps.</p>`, null],
  [/\bgeekbench\b|\bantutu\b|\bbenchmarks?\b/, () => html`<p><strong>Benchmarks</strong> are standard test apps: Geekbench measures CPU speed (single- and multi-core), and AnTuTu adds graphics, memory and storage into one total. This site records results with their source and uses them for the performance scores.</p>`, 'performance'],
  [/\bwireless charg\w*|\bqi2?\b/, () => html`<p><strong>Wireless charging</strong> uses a pad (the Qi standard) instead of a cable. It is usually slower and warmer than wired charging. <strong>Qi2</strong> adds magnets that line the phone up with the charger.</p>`, 'wireless'],
  [/\breverse (wireless )?charg\w*/, () => html`<p><strong>Reverse charging</strong> lets a phone charge earbuds, a watch or another phone, wirelessly on its back or through a USB-C cable. It is slow and meant for top-ups.</p>`, 'charging'],
  [/\b(fast|quick|super ?v?ooc|flash|hyper|turbo) ?charg\w*|\bwatts?\b|\b\d{2,3} ?w\b/, () => html`<p><strong>Charging watts (W)</strong> measure charging power: higher usually means a faster charge, but only with a compatible charger (USB Power Delivery / PPS or the maker's own). Speed also drops as the battery fills, so compare "0–50%" or "full charge" times where makers or tests give them.</p>`, 'charging'],
  [/\b(gps|gnss|dual ?frequency|l1 ?l5|l5)\b/, () => html`<p><strong>GPS</strong> is one of several satellite positioning systems (with GLONASS, Galileo, BeiDou and QZSS). Using more systems, and <strong>dual-frequency</strong> (L1 + L5) reception, improves accuracy in cities and under trees.</p>`, 'gps'],
  [/\bir blaster\b|\binfrared\b/, () => html`<p>An <strong>IR blaster</strong> is an infrared emitter that lets a phone work as a remote for TVs, air-conditioners and other appliances.</p>`, 'sensors'],
  [/\bspo2\b|blood oxygen/, () => html`<p><strong>SpO2</strong> is blood-oxygen saturation, estimated by the watch's light sensors. It is a wellness reading, not a medical diagnosis, and can be thrown off by movement or a loose strap.</p>`, null],
  [/\becg\b|\bekg\b/, () => html`<p>An <strong>ECG</strong> app records your heart's electrical signal from a finger on the watch and can flag irregular rhythm. Availability depends on regulatory approval in each country, so check it is enabled in Malaysia for that model.</p>`, null],
  [/\bheart rate\b|\bhrv\b/, () => html`<p>Watches estimate <strong>heart rate</strong> with green-light (optical) sensors. They are good at rest and steady exercise, and less accurate during fast changes such as interval training. HRV (heart-rate variability) is used for stress and recovery estimates.</p>`, null],
  [/\bstereo speakers?\b/, () => html`<p><strong>Stereo speakers</strong> use two speakers (often the earpiece doubles as the second), giving fuller, wider sound for videos and games than a single bottom speaker.</p>`, 'speakers'],
  [/\b(one ui|hyperos|coloros|funtouch|originos|magicos|harmonyos|emui|miui|oxygenos)\b/, (m) => html`<p><strong>${m[1].replace(/\b\w/g, (c) => c.toUpperCase()).replace(/os$/i, 'OS')}</strong> is a maker's own software on top of Android${/harmony/.test(m[1]) ? ' (HarmonyOS on Huawei devices sold in Malaysia is based on the Android Open Source Project and runs without Google services)' : ''}. It decides the look, features and how quickly updates arrive.</p>`, 'software'],
];
const GLOSS_Q = /\b(what( s| is| are| does| do)|whats|meaning|mean|means|explain|define|stand for|stands for|difference between|tell me about)\b/;

function glossary(norm) {
  for (const [re, fn, attr] of GLOSSARY) {
    const m = re.exec(norm);
    if (m) return { body: fn(m), attr };
  }
  return null;
}

// ------------------------------------------------------------------ small talk
const SMALL_TALK = [
  [/^(hi|hello|hey|hiya|helo|hai|yo|good (morning|afternoon|evening)|greetings|salam|assalamualaikum)( there| hub)?$/, () => html`<p>Hi! Ask me about any phone, watch or band in this database. For example: "Is the Galaxy S26 good for gaming?", "Does the iPhone 17 have eSIM?", "Redmi Note 17 vs Galaxy A27" or "best phone under RM1,500".</p>`],
  [/^(thanks?|thank you( very much| so much)?|thx|ty|tq|tqvm|cheers|terima kasih|great thanks|ok thanks|okay thanks)$/, () => html`<p>You're welcome. Ask another question any time.</p>`],
  [/^(bye|goodbye|see you|see ya|ok bye|that s all)$/, () => html`<p>Bye! The conversation is cleared each time the panel opens.</p>`],
  [/^(ok(ay)?|cool|nice|great|good|alright|i see|noted|got it|wow|hmm+)$/, () => html`<p>Anything else you'd like to check? You can ask about a device, compare two, or ask for a ranking.</p>`],
  [/^how are you( doing)?$/, () => html`<p>Ready to look things up. What would you like to know?</p>`],
  [/\b(are you (an? )?(ai|bot|robot|human|real|chat ?gpt|gpt|claude|gemini)|which (ai|model)|do you use (ai|chat ?gpt|an api)|who (made|built|created) you)\b/, () => html`<p>I'm this site's built-in assistant: a set of rules that reads the site's own data, so I only answer what the recorded specifications, prices and tests can support, and I say when something isn't recorded. If you switch on <strong>AI answers</strong> at the top of this panel, a small open model (Qwen3.5) running on your own device works out what you mean, I look it up here as usual, and it explains the result in your own language. No online AI service is used either way.</p>`],
];

// ------------------------------------------------------------------ entry point
/**
 * @param {string} question
 * @param {{ deviceIds?: string[], lastIds?: string[] }} context  devices on the current page / from the previous answer
 * @returns {Promise<{html, devices?: string[], understood?: string}>}
 */
// ------------------------------------------------------------------ latest news (Version 12)
// "Any news about the Galaxy S26?", "Red Magic 12 Pro+ rumours", "when will the Galaxy S27 launch?": the latest
// collected headlines, collected live when this copy of the site can (local server or relay). Devices the site
// doesn't list yet are found by the words of the question in the headline titles.
const NEWS_Q = /\b(news|headlines?|rumou?rs?|leaks?|leaked|berita|terkini)\b|\b(latest|recent|any)\b.{0,30}\b(reviews?|tests?|videos?|updates?|problems?|bugs?|issues?)\b|\b(bugs?|problems?|issues?|recall)\b.{0,20}\b(with|on|in|of)\b|\b(launch|release)(ing)? date\b|\bwhen\b.{0,50}\b(launch\w*|release\w*|come out|coming|announc\w*|available)\b|\bwhat s new\b/;
const GENERIC_NAME_WORDS = new Set(['5g', 'phone', 'edition']);
const NEWS_STOP = new Set(('news headline headlines rumour rumours rumor rumors leak leaks leaked berita terkini latest recent newest new today this week any anything there is are was were what whats s when will would does do did it its the a an about on for of in to and or with from me tell show give get got hear heard please update updates launch launching launched release releasing released date come out coming announce announced announcement available availability malaysia my i you going happening lately tech technology gadget gadgets mobile phone phones smartphone smartphones world industry').split(' '));

/** Named devices whose every model-name word is in the question ("Galaxy S27 Ultra" is not the POCO F7 Ultra). */
async function namedForNews(ids, text) {
  const { normalize } = await import('./collect.js');
  const asked = new Set(normalize(text).split(' '));
  return ids.filter((id) => {
    const d = store.deviceById.get(id);
    return !d || normalize(d.name).split(' ').every((w) => asked.has(w) || GENERIC_NAME_WORDS.has(w));
  });
}

async function answerNews(ids, text) {
  const [{ latestHeadlines, isSafeUrl }, { normalize }] = await Promise.all([import('./live.js'), import('./collect.js')]);
  let got;
  try {
    got = await latestHeadlines();
  } catch (error) {
    return { html: html`<p>The latest headlines could not be loaded (${error.message}). Try the <a href="${href('/news')}">News page</a>.</p>` };
  }
  const { data, live } = got;
  // Version 17: also the rolling archive (about 400 days, re-matched every run), so older tests, reviews and news count
  const { loadMatchedItems } = await import('./live.js');
  const archive = await loadMatchedItems().catch(() => []);
  const seen = new Set((data.items ?? []).map((i) => i.id ?? i.url));
  const pool0 = [...(data.items ?? []), ...archive.filter((i) => !seen.has(i.id ?? i.url))];
  // "any battery test of the S26?", "iPhone 18 problems": keep to that kind of item when one is asked for
  const norm0 = normalize(text);
  const wantTopics = [
    [/\b(tests?|tested|benchmarks?)\b/, ['test']], [/\breviews?\b/, ['review', 'video']], [/\b(videos?|youtube)\b/, ['video']],
    [/\b(bugs?|problems?|issues?|recall|defects?)\b/, ['issue', 'software']], [/\b(updates?|software|hyperos)\b/, ['software']],
    [/\b(deals?|discount)\b/, ['price']],
  ].filter(([re]) => re.test(norm0)).flatMap(([, t]) => t);
  const TOPIC_STOP = new Set(['test', 'tests', 'tested', 'benchmark', 'benchmarks', 'review', 'reviews', 'video', 'videos', 'youtube', 'bug', 'bugs', 'problem', 'problems', 'issue', 'issues', 'recall', 'defect', 'defects', 'update', 'updates', 'software', 'hyperos', 'deal', 'deals', 'discount']);
  const terms = normalize(text).split(' ').filter((w) => w && !NEWS_STOP.has(w) && !TOPIC_STOP.has(w));
  const words = (s) => new Set(normalize(s).split(' '));
  // the visitor's own spelling for the subject ("Red Magic 12 Pro+"), without the question words
  const own = text.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+]+$/gu, '')).filter((w) => w && normalize(w).split(' ').some((t) => t && !NEWS_STOP.has(t))).join(' ');
  const matches = (item) => {
    if (ids.some((id) => item.devices?.includes(id))) return true;
    if (!terms.length) return false;
    const pool = words(item.title);
    for (const id of item.devices ?? []) {
      const d = store.deviceById.get(id);
      if (d) for (const w of words(`${brandName(d.brand) ?? ''} ${d.name}`)) pool.add(w);
    }
    // "Red Magic" and "RedMagic" are the same name
    return terms.every((t) => pool.has(t)) || normalize(item.title).replace(/ /g, '').includes(terms.join(''));
  };
  const all = pool0.filter((i) => i.title && isSafeUrl(i.url) && (!wantTopics.length || wantTopics.includes(i.topic)));
  const about = ids.length || terms.length;
  const found = about ? all.filter(matches) : all.filter((i) => i.kind !== 'video');
  const subject = ids.length ? html`the ${ids.map(link).reduce((acc, l, i) => (i ? html`${acc} and the ${l}` : l), '')}` : terms.length ? html`“${own || terms.join(' ')}”` : '';
  const when = live ? 'collected from the publishers’ feeds just now' : data.fetchedAt ? `collected ${timeAgo(data.fetchedAt)} by the site’s scheduled update` : 'collected by the site’s scheduled update';
  const note = html`<p class="ask__src">Headlines ${when}, plus the site’s archive of the past year. Titles only, matched automatically and not checked by this site; open a link for the full story. More on the <a href="${href('/news')}">News page</a>.</p>`;
  if (!found.length) {
    return {
      html: html`<p>None of the ${plural(all.length, wantTopics.length ? 'matching headline' : 'headline')} the site has collected mentions ${subject || 'that'}.</p>${note}`,
      devices: ids,
    };
  }
  const shown = found.slice(0, 6);
  return {
    html: html`<p>${about ? html`Latest headlines about ${subject}:` : 'The latest headlines:'}</p>
      <ul class="ask__list">${shown.map((i) => html`<li>${extLink(i.url, i.title)} <span class="muted">${sourceName(i.source) ?? i.source}${i.published ? `, ${timeAgo(i.published)}` : ''}${i.topic && i.topic !== 'news' ? ` · ${i.topic}` : ''}</span></li>`)}</ul>
      ${found.length > shown.length ? html`<p class="muted">${plural(found.length - shown.length, 'more headline')} on the <a href="${href('/news')}">News page</a>.</p>` : ''}${note}`,
    devices: ids,
  };
}

// Common Chinese question words, read as their English equivalents (device and brand names are matched separately).
const ZH_WORDS = [
  [/摩托罗拉/g, ' Motorola '], [/努比亚/g, ' nubia '], [/小米/g, ' Xiaomi '], [/红米/g, ' Redmi '], [/华为/g, ' Huawei '], [/荣耀/g, ' HONOR '],
  [/三星/g, ' Samsung '], [/苹果/g, ' Apple '], [/一加/g, ' OnePlus '], [/真我/g, ' realme '], [/红魔/g, ' REDMAGIC '], [/谷歌/g, ' Google '],
  [/索尼/g, ' Sony '], [/华硕/g, ' ASUS '], [/中兴/g, ' ZTE '],
  [/(?:rm|RM|马币)?\s*([\d,]+)\s*(?:令吉|马币|元)?\s*(?:以下|以内|之内)/g, ' under RM$1 '],
  [/无线充电/g, ' wireless charging '], [/续航|电池/g, ' battery '], [/快充|充电/g, ' charging '], [/屏幕|显示屏/g, ' screen '],
  [/价格|售价|多少钱|价钱/g, ' price '], [/拍照|相机|摄像头|影像/g, ' camera '], [/性能|跑分|处理器/g, ' performance '], [/游戏/g, ' gaming '],
  [/最轻/g, ' lightest '], [/最便宜/g, ' cheapest '], [/重量|多重/g, ' weight '], [/防水/g, ' water resistant '],
  [/哪个好|哪个更好|谁更好|哪款好/g, ' which is better '], [/对比|比较|和|与|跟/g, ' vs '], [/最好|推荐/g, ' best '],
  [/新闻|消息/g, ' news '], [/手机/g, ' phone '], [/手表/g, ' watch '], [/耳机|耳機/g, ' earbuds '], [/平板/g, ' tablet '], [/旗舰/g, ' flagship '],
];
const fromZh = (t) => (/[\u4e00-\u9fff]/.test(t) ? ZH_WORDS.reduce((acc, [re, en]) => acc.replace(re, en), t).replace(/\s+/g, ' ').trim() : t);

export async function ask(question, context = {}) {
  const text = fromZh(String(question ?? '').trim());
  const norm = normalizeText(text).replace(/\s+/g, ' ').trim();
  if (!norm) return { html: html`<p>Ask about a device, a comparison or a ranking.</p>` };
  for (const [re, fn] of SMALL_TALK) if (re.test(norm)) return { html: fn() };
  let ids = await devicesIn(text);
  // named chipsets win over a loose device match ("A20 Pro" is not the "POCO F9 Pro") and over the page's device
  const chipIds = detectChipsets(norm);
  if (chipIds.length && !(await devicesIn(text, { fuzzy: false })).length) {
    if (chipIds.length >= 2) return answerChips(chipIds);
    ids = [];
  }
  const named = ids.length > 0;
  const attrs = detectAttrs(norm);
  const category = detectCategory(norm);
  const pronoun = /\b(it|its|this|that|these|those|them|they|the phone|the watch|this one|both)\b/.test(norm);
  const feats = detectFeatures(norm);
  const evaluative = EVAL.test(norm);
  let previous = context.lastIds?.length ? context.lastIds : context.deviceIds ?? [];
  // a singular "it" after an answer about several devices means the device on this page, if there is one
  if (previous.length > 1 && context.deviceIds?.length === 1 && /\b(it|its|this( one)?)\b/.test(norm) && !/\b(them|they|these|those|both|either|which)\b/.test(norm)) {
    previous = [...context.deviceIds];
  }

  // "any news about the S26?", "when will the Galaxy S27 launch?": the latest headlines (Version 12). Only devices
  // named exactly count here, so a model the site doesn't list yet isn't mistaken for a similar one it does.
  if (NEWS_Q.test(norm)) {
    const exact = await namedForNews(await devicesIn(text, { fuzzy: false }), text);
    return answerNews(exact.length ? exact : pronoun ? previous.slice(0, 2) : [], text);
  }

  // "what is IP68?", "what does LTPO mean?": a general explanation (plus the current device's own value, if any)
  const glossShape = GLOSS_Q.test(norm) || (!pronoun && /^(is|are|can|does)\b/.test(norm) && /\bip ?[0-6x]\d|\b\d{1,2} ?atm\b/.test(norm));
  if (!named && !pronoun && glossShape && !SUPER_HIGH.test(norm) && !SUPER_LOW.test(norm) && !/\b(best|top)\b/.test(norm)) {
    const g = glossary(norm);
    if (g) {
      const ctxId = previous.length === 1 ? previous[0] : null;
      const fact = ctxId && g.attr ? facts(await full(ctxId), g.attr).find((f) => f.text) : null;
      return {
        html: html`${g.body}${fact ? html`<p>For the ${link(ctxId)}: ${fact.label.toLowerCase()} ${fact.text}.</p>` : ''}<p class="ask__src">General explanation, not a value measured or recorded by this site.</p>`,
        devices: fact ? [ctxId] : [],
      };
    }
  }

  // A budget ("under RM1,000", "bawah RM1000") without "it" asks for a new list, not about the previous answer's devices.
  const budgetOnly = !pronoun && detectMaxPrice(text);
  if (!ids.length && !budgetOnly && (pronoun || (attrs.length && !category) || ((feats.length || evaluative) && YESNO.test(norm) && !category))) ids = [...previous];
  // "does it good?", "is it worth it?" with no device on the page or earlier in the chat
  if (!ids.length && (pronoun || ((feats.length || evaluative) && /^(does|do|is|are|has|have|can)\b/.test(norm))) && !category && !detectBrands(norm).length && !detectMaxPrice(text)) {
    return {
      html: html`<p>Which device do you mean? Name it in the question, for example "Is the Galaxy S26 good?" or "Does the Redmi Note 17 have NFC?", or open a device page and ask there.</p>`,
    };
  }
  // "which is lighter, it or the Pixel 10?": the earlier device plus the one just named
  if (ids.length === 1 && /\b(it|this( one)?|that( one)?|them)\b/.test(norm) && /\b(or|vs|versus|than|compare[sd]?|which)\b/.test(norm)) {
    const other = previous.find((id) => id !== ids[0]);
    if (other) ids = [other, ids[0]];
  }

  // a named test ("DXOMARK score", "Geekbench", "how long to charge", "video test"): the recorded results (Version 20)
  const tests = detectTests(norm);
  if (tests.length) {
    const ranking = SUPER_HIGH.test(norm) || SUPER_LOW.test(norm) || /\b(which|rank|ranking|top|order)\b/.test(norm);
    const tIds = ids.length ? ids : (!ranking && previous.length) ? previous : [];
    if (tIds.length === 1) return answerTests(tIds[0], tests);
    if (tIds.length >= 2) return answerTestCompare(tIds.slice(0, 4), tests);
    return answerTestRank(tests[0], norm, text, category ?? 'smartphone');
  }
  // where prices come from (asked with the word "price", so checked before attribute questions)
  if (!ids.length && PRICE_HELP.test(norm)) return { html: priceHelp() };
  // explanations about the site itself
  if (!ids.length && !attrs.length) {
    for (const [re, fn] of HELP) if (re.test(norm)) return { html: fn() };
  }
  // yes/no feature checks, for one device or several ("do the S25 and iPhone 16 have eSIM?")
  if (ids.length && feats.length && !evaluative && (YESNO.test(norm) || !attrs.some((a) => a.rank))) {
    return answerFeatures(ids.slice(0, 4), feats.slice(0, 3));
  }
  // comparisons: two or more devices, or "vs"
  if (ids.length >= 2) return answerCompare(ids.slice(0, 4), attrs, norm, text);
  if (/\b(vs|versus|compare|compared)\b/.test(norm) && ids.length === 1 && context.deviceIds?.length && context.deviceIds[0] !== ids[0]) {
    return answerCompare([context.deviceIds[0], ids[0]], attrs, norm, text);
  }
  // "is it good?", "worth it?", "good for gaming?", "pros and cons"
  if (ids.length === 1 && evaluative && !/\b(rivals?|alternatives?|similar|competitors?|instead)\b/.test(norm)) {
    return answerVerdict(ids[0], norm, text, attrs);
  }
  if (ids.length === 1) {
    if (/\b(rivals?|alternatives?|similar|competitors?|instead)\b/.test(norm)) {
      const dev = await loadDevice(ids[0]).catch(() => null);
      const rel = dev?.related ?? [];
      if (rel.length) return answerCompare([ids[0], ...rel.slice(0, 2)], attrs, norm, text);
    }
    return answerDevice(ids[0], attrs);
  }
  // rankings and lists
  const cat = category ?? (attrs.some((a) => a.id === 'battery') && /\bwatch/.test(norm) ? 'smartwatch' : 'smartphone');
  // "biggest battery under RM1,500": the price is a filter and the battery is what gets ranked,
  // unless the question is about the price itself ("cheapest 5G phone").
  const rankables = attrs.filter((a) => a.rank);
  const nonPrice = rankables.find((a) => a.id !== 'price');
  const priceWords = /\b(cheap(er|est)?|most expensive|priciest|lowest price|highest price)\b/.test(norm);
  let rankAttr = nonPrice && !priceWords ? nonPrice : rankables[0];
  // "best phone under RM400": the price is only a budget, so rank by the site's scores instead
  if (rankAttr?.id === 'price' && !priceWords && detectMaxPrice(text)) rankAttr = undefined;
  if (rankAttr && (SUPER_HIGH.test(norm) || SUPER_LOW.test(norm) || /\b(which|rank|top|order)\b/.test(norm))) {
    if (!(rankAttr.id === 'camera' && /\bbest\b/.test(norm)) && !(rankAttr.id === 'performance' && /\bbest\b/.test(norm) && /gaming/.test(norm))) {
      return answerRank(norm, text, rankAttr, cat);
    }
  }
  if (/\b(best|top|recommend\w*|suggest\w*|should i (buy|get)|good)\b/.test(norm) || detectMaxPrice(text)) {
    return answerBest(norm, text, cat);
  }
  if (category || detectBrands(norm).length || /\b20[12]\d\b/.test(norm)) {
    const list = answerList(norm, text, cat);
    if (list) return list;
  }
  if (chipIds.length >= 2) return answerChips(chipIds);
  for (const [re, fn] of HELP) if (re.test(norm)) return { html: fn() };
  // nothing recognised: suggest matches
  const hits = (await search(text, { limit: 5 })).filter((h) => h.type === 'device' || h.type === 'chipset');
  return {
    html: hits.length
      ? html`<p>I'm not sure what you're asking. Did you mean one of these?</p><ul class="ask__list">${hits.map((h) => html`<li><a href="${href(h.type === 'device' ? `/device/${h.id}` : `/chipset/${h.id}`)}">${h.title ?? h.name}</a></li>`)}</ul><p class="ask__src">Try naming a device and a detail, such as "battery of the Galaxy S26".</p>`
      : html`<p>I couldn't match that to a device or a topic in this database. Try a model name ("Redmi Note 17"), a comparison ("S26 vs iPhone 17") or a ranking ("lightest phone under RM2,000"). I only answer from this site's data.</p>`,
  };
}

/** Two or more chipsets and no device: their consensus benchmark results side by side, with who leads each. */
function answerChips(chipIds) {
  const chips = chipIds.slice(0, 4).map((id) => store.chipsetById.get(id)).filter(Boolean);
  const keys = ['gb6_single', 'gb6_multi', 'antutu_v11', 'wle', 'steel_nomad_light', 'wle_stability'].filter((k) => chips.filter((c) => c.m?.[k]).length >= 2);
  const lead = (k) => {
    const def = metricDef(k);
    const vals = chips.filter((c) => c.m?.[k]).sort((a, b) => (def?.better === 'lower' ? a.m[k][0] - b.m[k][0] : b.m[k][0] - a.m[k][0]));
    if (vals.length < 2) return null;
    const gap = Math.abs(vals[0].m[k][0] - vals[1].m[k][0]) / Math.max(1e-9, Math.abs(vals[1].m[k][0]));
    return gap < 0.03 ? `${def?.name ?? k}: level` : `${def?.name ?? k}: ${vals[0].name} ahead by ${Math.round(gap * 100)}%`;
  };
  return {
    html: html`<p>${chips.map((c, i) => html`${i ? ' vs ' : ''}<a href="${href(`/chipset/${c.id}`)}">${c.name}</a>`)}:</p>
      <div class="ask__table"><table><thead><tr><th></th>${chips.map((c) => html`<th scope="col">${c.name}</th>`)}</tr></thead><tbody>
        <tr><th scope="row">Process</th>${chips.map((c) => html`<td>${c.process ?? html`<em class="ask__none">not recorded</em>`}</td>`)}</tr>
        ${keys.map((k) => html`<tr><th scope="row">${metricDef(k)?.name ?? k}</th>${chips.map((c) => html`<td>${c.m?.[k] ? fmtMetric(metricDef(k), c.m[k][0]) : html`<em class="ask__none">no results</em>`}</td>`)}</tr>`)}
      </tbody></table></div>
      ${keys.length ? html`<p>${keys.map(lead).filter(Boolean).join('. ')}.</p>` : html`<p>These chips don't share enough benchmark results to compare.</p>`}
      <p class="ask__src">Consensus of the phones tested with each chip (median across independent sources). Phones with the same chip can differ with their cooling.</p>`,
    devices: [],
  };
}

// ------------------------------------------------------------------ facts for the optional on-device AI (engine/ai.js)
const BRIEF_ATTRS = ['display', 'chip', 'ram', 'storage', 'battery', 'charging', 'camera', 'weight', 'size', 'water', 'software', 'network', 'sim', 'jack', 'card', 'speakers', 'biometrics', 'wifi', 'bluetooth', 'gps'];
const BRIEF_LABELS = { Capacity: 'Battery capacity', Rating: 'Water and dust rating', Screen: 'Display', Network: 'Mobile network' };

/** Plain-text facts about one device: key specs, Malaysian price, the site's scores and rank. */
export async function deviceBrief(id) {
  const r = row(id);
  if (!r) return '';
  const dev = await full(id);
  const cat = store.categoryById.get(r.category);
  const lines = [`${deviceTitle(r)} — a ${cat?.singular.toLowerCase() ?? 'device'} by ${brandName(r.brand)}`];
  if (dev.announced) lines.push(`Announced: ${fmtDate(dev.announced)}`);
  const my = (dev.prices ?? []).filter((p) => p.region === 'MY').sort((a, b) => a.amount - b.amount);
  lines.push(my.length ? `Malaysian launch price: ${my.map((p) => `${fmtPrice(p.amount, 'MYR')}${p.config ? ` (${p.config})` : ''}`).join('; ')}` : 'Malaysian launch price: not recorded');
  const seen = new Set();
  for (const a of BRIEF_ATTRS) {
    for (const f of facts(dev, a)) {
      const label = BRIEF_LABELS[f.label] ?? f.label;
      if (f.text && !seen.has(label)) {
        seen.add(label);
        lines.push(`${label}: ${f.text}`);
      }
    }
  }
  const cats = allCategoryScores(r);
  const scored = Object.entries(cats).map(([k, v]) => `${store.scoreCategoryById.get(k)?.label ?? k} ${Math.round(v.score)}`);
  if (scored.length) lines.push(`This site's scores out of 100 (platform analysis): ${scored.join(', ')}`);
  const list = board(r.category, 'balanced');
  const pos = list.findIndex((x) => x.id === id);
  if (pos >= 0) lines.push(`Overall rank on this site: ${ordinal(pos + 1)} of ${list.length} ${cat?.name.toLowerCase() ?? 'devices'} with enough evidence`);
  lines.push(Object.values(cats).every((c) => c.specOnly) ? 'Independent tests: none recorded; its scores come from its specification sheet only' : 'Independent tests: some recorded (lab or benchmark results)');
  return lines.join('\n');
}

function answerLines(markup) {
  const box = document.createElement('div');
  box.innerHTML = String(markup);
  box.querySelectorAll('.ask__more, a.ext .sr-only').forEach((n) => n.remove()); // a link's "(opens in a new tab)" is for screen readers
  const lines = [];
  for (const el of box.querySelectorAll('p, li, tr')) {
    const text = el.tagName === 'TR' ? [...el.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()).join(' | ') : el.textContent.replace(/\s+/g, ' ').trim();
    if (text) lines.push(el.tagName === 'LI' ? `- ${text}` : text);
  }
  return lines.join('\n');
}

/**
 * Everything the AI may use for one answer: the verified answer only. (Adding each device's full spec list was
 * tried: the small model then picked unrelated specs into its answers, so it gets just what the rules found.)
 * When the rules found nothing specific but one device is in context, its brief is added instead.
 */
export async function aiFacts(res) {
  const lines = answerLines(res.html);
  const parts = [`ANSWER FROM THE SITE'S DATA:\n${lines}`];
  if ((res.devices ?? []).length === 1 && lines.length < 200) parts.push(`DEVICE DETAILS:\n${await deviceBrief(res.devices[0])}`);
  parts.push(`ABOUT THE SITE: ${store.devices.length} phones, tablets, watches, fitness bands and earbuds sold in Malaysia (a few not sold here are marked). Prices are Malaysian launch prices in RM. Scores are this site's own analysis of recorded specifications and tests, not reviews.`);
  return parts.join('\n\n');
}

// ------------------------------------------------------------------ tools for the AI agent (engine/ai-agent.js, Version 9)
/** The attribute and feature ids the AI may put in its plan (the same ids the rules understand). */
export const ATTR_IDS = ATTRS.map((a) => a.id);
export const FEATURE_IDS = FEATURES.map((f) => f.id);
export const answerText = (markup) => answerLines(markup);

/**
 * Device names as a visitor wrote them ("s25 ultra", "redmi note14", "iphone 16") → ids in the database.
 * Exact and short names first, then fuzzy search for typos. Returns { ids, unknown }.
 */
export async function resolveDevices(names = []) {
  const ids = [];
  const unknown = [];
  for (const raw of names.slice(0, 4)) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    let found = (await devicesIn(name))[0];
    if (!found) {
      const [best] = await search(name, { limit: 1, types: ['device'] });
      if (best && best.score >= 55) found = best.id;
    }
    if (found && !ids.includes(found)) ids.push(found);
    else if (!found) unknown.push(name);
  }
  return { ids, unknown };
}

/** True for greetings, thanks and goodbyes, which the rules answer without any AI. */
export function isSmallTalk(text) {
  const norm = normalizeText(text).replace(/\s+/g, ' ').trim();
  return SMALL_TALK.some(([re]) => re.test(norm));
}

/** Devices the rules find in a piece of text (exact names, short names, no fuzzy guessing). */
export async function devicesInText(text) {
  return devicesIn(String(text ?? ''), { fuzzy: false });
}

/** What the rules read in a question: attributes, features, use case, category, budget, brands. */
export function analyse(text) {
  const norm = normalizeText(text);
  return {
    attrs: detectAttrs(norm).map((a) => a.id),
    features: detectFeatures(norm).map((f) => f.id),
    profile: detectProfile(text),
    category: detectCategory(norm),
    maxPrice: detectMaxPrice(text),
    brands: detectBrands(norm),
  };
}

/** Every one of the site's general explanations that the text mentions ("difference between LTPO and OLED"). */
export function explainTerms(text, limit = 3) {
  const norm = normalizeText(String(text ?? ''));
  const out = [];
  for (const [re, fn] of GLOSSARY) {
    const m = re.exec(norm);
    if (m) out.push(answerLines(fn(m)));
    if (out.length >= limit) break;
  }
  return out;
}

/** The official name the rules match exactly ("Samsung Galaxy S25"). */
export const officialName = (id) => (row(id) ? deviceTitle(row(id)) : id);

/** A short fact card for explaining recommendations: price, chip, screen, battery, charging, weight, camera, water, rank. */
export async function keyFacts(id) {
  const r = row(id);
  if (!r) return '';
  const dev = await full(id);
  const lines = [`${deviceTitle(r)}:`];
  const my = (dev.prices ?? []).filter((p) => p.region === 'MY').sort((a, b) => a.amount - b.amount)[0];
  lines.push(`  Malaysian launch price: ${my ? `${fmtPrice(my.amount, 'MYR')}${my.config ? ` (${my.config})` : ''}` : 'not recorded'}`);
  for (const a of ['chip', 'display', 'battery', 'charging', 'weight', 'camera', 'water']) {
    const f = facts(dev, a).find((x) => x.text);
    if (f) lines.push(`  ${BRIEF_LABELS[f.label] ?? f.label}: ${f.text}`);
  }
  const list = board(r.category, 'balanced');
  const pos = list.findIndex((x) => x.id === id);
  if (pos >= 0) lines.push(`  Overall on this site: ${ordinal(pos + 1)} of ${list.length} (${Math.round(list[pos].result.score)}/100)`);
  return lines.join('\n');
}

// ------------------------------------------------------------------ Version 10: everything the site knows, as text
// The AI is given these instead of a handful of key facts, so it can answer from the whole record: the full
// specification sheet, what differs between devices, the site's scores, reviews and tests, prices and headlines.

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
/** A formatted spec value as one line of plain text ("lines" become "a; b; c"). */
function specText(field, dev) {
  const value = specValue(dev, field.key);
  if (field.type === 'lines' && Array.isArray(value)) return value.length ? value.join('; ') : null;
  const out = fmtSpec(field, value, dev);
  if (out === null || out === undefined) return null;
  return decode(String(out).replace(/<\/li>\s*<li>/g, '; ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() || null;
}

// spec sections that answer a question about an attribute ("camera" → the main and selfie camera sections)
const SECTIONS_FOR_ATTR = {
  battery: ['battery'], charging: ['battery'], wireless: ['battery'], display: ['display'], refresh: ['display'], brightness: ['display'],
  chip: ['platform'], performance: ['platform', 'memory'], ram: ['memory'], storage: ['memory'], camera: ['camera', 'selfie'],
  weight: ['body'], size: ['body', 'display'], water: ['body'], release: ['launch'], software: ['misc', 'platform'], jack: ['sound'],
  card: ['memory'], sim: ['body', 'network'], wifi: ['comms'], bluetooth: ['comms'], gps: ['comms'], sensors: ['features'],
  colors: ['misc'], speakers: ['sound'], biometrics: ['features'], bands: ['network'], usb: ['comms'], network: ['network'],
};
export const sectionsFor = (attrs = []) => [...new Set(attrs.flatMap((a) => SECTIONS_FOR_ATTR[a] ?? []))];

const clip = (t, max) => (t && t.length > max ? `${t.slice(0, max).replace(/[\s,;·(]+\S*$/, '')}…` : t);
// band lists and module details run to hundreds of characters; only asked-for sections get them in full
const LONG_FIELDS = /bands|module details|maker's wording/i;

/** The device's full specification sheet (or only some sections), one line per section. */
export async function specSheetText(id, { sections = null, skip = [], maxValue = 150 } = {}) {
  const dev = await full(id);
  const cat = store.categoryById.get(dev?.category);
  if (!dev || !cat?.specSections) return '';
  const lines = [];
  for (const section of cat.specSections) {
    if ((sections?.length && !sections.includes(section.id)) || skip.includes(section.id)) continue;
    const asked = sections?.includes(section.id);
    const parts = section.fields
      .filter((f) => asked || !LONG_FIELDS.test(f.label))
      .map((f) => [f.label, clip(specText(f, dev), asked ? maxValue * 2 : maxValue)])
      .filter(([, t]) => t);
    if (parts.length) lines.push(`  ${section.label}: ${parts.map(([l, t]) => `${l} ${t}`).join('; ')}`);
  }
  return lines.length ? `${deviceTitle(dev)}:\n${lines.join('\n')}` : '';
}

/** Every Malaysian launch price with its configuration. */
export async function pricesText(id) {
  const dev = await full(id);
  const my = (dev?.prices ?? []).filter((p) => p.region === 'MY').sort((a, b) => a.amount - b.amount);
  return my.length ? `${deviceTitle(dev)}: ${my.map((p) => `${fmtPrice(p.amount, 'MYR')}${p.config ? ` (${p.config})` : ''}`).join(', ')}` : `${deviceTitle(dev)}: Malaysian launch price not recorded`;
}

/**
 * What differs between devices, field by field across the whole specification sheet.
 * Returns { differences: [lines where every device has a value and they differ], same: [fields with one value],
 * partial: [fields recorded for only some of them] } — a gap in the record is not a difference.
 */
/**
 * True when `long` is `short` with more detail around it — "IP68" and "IP68 (6 m, 30 min)", "Wi-Fi 7" and
 * "Wi-Fi 7 (802.11be) with 2x2 MIMO", "OLED" and "Super Retina XDR OLED, ProMotion" — rather than more of a list
 * ("256 GB / 512 GB" and "256 GB / 512 GB / 1 TB", a real difference).
 */
function moreDetail(short, long) {
  const i = long.indexOf(short);
  if (i < 0 || short.length < 2) return false;
  const pre = long.slice(0, i);
  const post = long.slice(i + short.length);
  if (pre && (/\d/.test(pre) || !/\s$/.test(pre))) return false;
  if (post && !/^\s*(\(|,\s*\p{L}|with\b|·)/u.test(post)) return false;
  return Boolean(pre || post);
}

export async function differencesText(ids, { maxValue = 110 } = {}) {
  const devs = await Promise.all(ids.map(full));
  const cat = store.categoryById.get(devs[0]?.category);
  if (!cat?.specSections || devs.some((d) => d?.category !== devs[0].category)) return { differences: [], same: [], partial: [], detail: [] };
  const names = devs.map((d) => d.name);
  const differences = [];
  const same = [];
  const partial = [];
  const detail = [];
  for (const section of cat.specSections) {
    for (const f of section.fields) {
      if (/bands/i.test(f.label)) continue;
      const texts = devs.map((d) => clip(specText(f, d), maxValue));
      if (texts.every((t) => t === null)) continue;
      if (texts.some((t) => t === null)) partial.push(`${f.label} (only ${names.filter((_, i) => texts[i] !== null).join(', ')})`);
      else if (texts.every((t) => t === texts[0])) same.push(`${f.label} ${texts[0]}`);
      else {
        const line = `- ${f.label}: ${texts.map((t, i) => `${names[i]} ${t}`).join(' | ')}`;
        const shortest = texts.reduce((a, b) => (b.length < a.length ? b : a));
        (texts.every((t) => t === shortest || moreDetail(shortest, t)) ? detail : differences).push(line);
      }
    }
  }
  return { differences, same, partial, detail };
}

/** The site's category scores with ranks, and the strong and weak areas, as the device page shows them. */
export async function scoresText(id) {
  const data = await loadDevice(id).catch(() => null);
  if (!data) return '';
  const dev = data.device;
  const rows = Object.entries(allCategoryScores(data)).map(([sid, s]) => ({ label: store.scoreCategoryById.get(sid)?.label ?? sid, s, rank: rankOf(dev.id, dev.category, sid) }));
  if (!rows.length) return '';
  const part = (r) => `${r.label} ${Math.round(r.s.score)}${r.rank ? ` (#${r.rank.position} of ${r.rank.of})` : ''}${r.s.specOnly ? ' spec-based' : ''}`;
  const strong = rows.filter((r) => r.rank && r.rank.of >= 5 && r.rank.percentile <= 0.2 && r.s.coverage >= 0.5).map((r) => r.label);
  const weak = rows.filter((r) => r.rank && r.rank.of >= 5 && r.rank.percentile >= 0.75 && r.s.coverage >= 0.5).map((r) => r.label);
  return `${deviceTitle(dev)}: ${rows.map(part).join('; ')}.${strong.length ? ` Strong areas (top 20%): ${strong.join(', ')}.` : ''}${weak.length ? ` Weak areas (bottom 25%): ${weak.join(', ')}.` : ''}`;
}

/** Reviewer findings, test results and news summaries recorded for the device (and its chipset), with publishers. */
export async function reviewsText(id, { limit = 8 } = {}) {
  const data = await loadDevice(id).catch(() => null);
  if (!data) return { lines: [], count: 0 };
  const docs = [...(data.documents ?? []), ...(data.chipsetDocuments ?? [])];
  const lines = [];
  const who = (doc) => `${sourceName(doc.source) ?? doc.source}${doc.kind === 'video' ? ' (video)' : doc.kind === 'news' ? ' (news)' : ''}${doc.published ? `, ${String(doc.published).slice(0, 7)}` : ''}`;
  for (const doc of docs) {
    for (const f of doc.findings ?? []) {
      if (f.subject && f.subject !== id && f.subject !== data.chipset?.id) continue;
      lines.push(`- ${who(doc)}, ${f.stance ?? 'neutral'}: ${f.text}`);
    }
    for (const r of doc.records ?? []) {
      if (r.subject !== id) continue;
      const def = metricDef(r.metric);
      if (def) lines.push(`- ${who(doc)} measured ${def.name}: ${fmtMetric(def, r.value)}${r.note ? ` (${r.note})` : ''}`);
    }
    if (doc.kind === 'news' && doc.summary) lines.push(`- ${who(doc)}: ${doc.summary}`);
    // a linked video review the site hasn't summarised: its title only, said as such
    if (doc.kind === 'video' && !(doc.findings ?? []).length) lines.push(`- ${who(doc)}: video review titled "${doc.title}" (linked, not summarised by the site)`);
  }
  return { lines: lines.slice(0, limit), count: docs.length };
}

/** Latest collected headlines that name the device (titles only; not checked by hand). */
export async function headlinesText(id, { limit = 4 } = {}) {
  try {
    // newest collection plus the year-long archive, so the AI can see tests, reviews and problem reports too
    const { loadMatchedItems } = await import('./live.js');
    const items = (await loadMatchedItems()).filter((h) => (h.devices ?? []).includes(id)).slice(0, limit);
    return items.map((h) => `- ${sourceName(h.source) ?? h.source}, ${String(h.published).slice(0, 10)}${h.topic && h.topic !== 'news' ? ` (${h.topic})` : ''}: "${h.title}"`);
  } catch {
    return [];
  }
}

/**
 * How a spec is spread across the database, so an answer can say what a figure means
 * ("the median phone here has 5,000 mAh; the top 10% have 6,500 mAh or more").
 */
export function dataContext(attrId, category = 'smartphone') {
  const attr = ATTRS.find((a) => a.id === attrId);
  if (!attr?.rank || !RANKERS[attr.rank]) return '';
  const rows = store.devices.filter((r) => r.category === category);
  const vals = rows.map((r) => ({ r, v: RANKERS[attr.rank](r) })).filter((x) => x.v != null && !(attr.rank === 'wirelessW' && x.v === 0)).sort((a, b) => a.v - b.v);
  if (vals.length < 10) return '';
  const at = (p) => vals[Math.min(vals.length - 1, Math.floor(p * (vals.length - 1)))];
  const txt = (x) => RANK_TEXT[attr.rank](x.v, x.r);
  const cat = store.categoryById.get(category)?.name.toLowerCase() ?? 'devices';
  const [lowWord, highWord] = attr.better === 'lower' ? ['highest', 'lowest'] : ['lowest', 'highest'];
  const best = attr.better === 'lower' ? at(0) : at(1);
  const worst = attr.better === 'lower' ? at(1) : at(0);
  const top10 = attr.better === 'lower' ? at(0.1) : at(0.9);
  return `${attr.label} across the ${vals.length} ${cat} in this database with a recorded value: median ${txt(at(0.5))}; the best 10% ${attr.better === 'lower' ? 'at or below' : 'at or above'} ${txt(top10)}; ${highWord} ${txt(best)}, ${lowWord} ${txt(worst)}.`;
}

/** The site's own general explanation of a spec term ("IP68", "LTPO", "mAh"), as plain text, or ''. */
export function explainTerm(term) {
  const g = glossary(normalizeText(String(term ?? '')));
  return g ? answerLines(g.body) : '';
}

/** What a use case means on this site: its description and what its score weighs. */
export function useCaseInfo(profileId) {
  const p = store.profileById.get(profileId);
  if (!p) return '';
  const weights = Object.entries(p.weights).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1])
    .map(([k, w]) => `${k === 'value' ? 'value for money' : (store.scoreCategoryById.get(k)?.label ?? k).toLowerCase()} ${Math.round(w * 100)}%`);
  return `The site's "${p.label}" ranking: ${p.description ?? ''} It weighs ${weights.join(', ')}.`;
}

/** Starter questions for the current page. */
export function suggestions(context = {}) {
  const id = context.deviceIds?.[0];
  const r = id && store.deviceById.get(id);
  // Version 20: a test question when the device has its own test results (DXOMARK, Geekbench, charging times…)
  const tested = (row) => Object.entries(row?.m ?? {}).some(([k, v]) => !k.startsWith('spec_') && !v[2]);
  if (context.deviceIds?.length >= 2) {
    const both = context.deviceIds.every((d) => tested(store.deviceById.get(d)));
    return ['Which is better overall?', 'Which has the bigger battery?', 'Which is cheaper in Malaysia?', both ? 'Compare their Geekbench scores' : 'Which charges faster?'];
  }
  if (r) {
    const wear = r.category === 'smartwatch' || r.category === 'band';
    const test = r.m?.dxomark_camera && !r.m.dxomark_camera[2] ? 'What is its DXOMARK camera score?'
      : r.m?.charge_full && !r.m.charge_full[2] ? 'How long does it take to charge?'
        : r.m?.gb6_multi && !r.m.gb6_multi[2] ? 'What are its Geekbench scores?' : null;
    return wear
      ? ['Is it any good?', 'How long does its battery last?', 'Is it water resistant?', 'Does it have GPS?', 'Compare it with its rivals']
      : ['Is it worth buying?', 'Is it good for gaming?', `What's the battery and charging?`, ...(test ? [test] : []), 'Does it have NFC and eSIM?', 'Compare it with its rivals'];
  }
  return ['Best phone under RM2,000', 'Is the Galaxy S26 worth it?', 'Galaxy S26 vs iPhone 17', 'Highest DXOMARK camera score', 'Best earbuds with ANC under RM500', 'What is IP68?'];
}
