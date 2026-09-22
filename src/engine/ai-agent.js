// The AI agent behind "AI answers" (Version 9). It gives the on-device model real work to do while keeping every
// fact tied to the site's data:
//
//   1. understand() — the model reads the question (any language, typos, vague needs) and fills in a plan whose
//      shape is forced by a JSON schema: intent, devices as the visitor named them, budget, use case, features…
//   2. lookUp()     — plain code, no model: resolves the device names, turns the plan into questions the rule-based
//      engine answers (rankings, comparisons, feature checks, verdicts, prices, explanations), and adds context:
//      key facts of the devices involved, how a spec is spread across the database, and the site's own
//      explanations of spec terms.
//   3. explain()    — the model answers in the visitor's language from those facts only.
//   4. The UI runs ai.checkAnswer() on the result before showing it (unconfirmed sentences are removed, or the whole
//      answer is withheld), next to what was looked up and the sources.

import * as eng from './assistant.js';
import { store } from '../core/store.js';
import { normalizeText } from './search.js';

// ------------------------------------------------------------------ 1. understanding the question
const INTENTS = ['device_info', 'price', 'feature_check', 'verdict', 'reviews', 'news', 'compare', 'differences', 'recommend', 'rank', 'advice', 'explain_term', 'list', 'smalltalk', 'other'];
const USE_CASES = ['gaming', 'photography', 'battery', 'student', 'longterm', 'performance', 'balanced', 'none'];
const LANGUAGES = { en: 'English', ms: 'Malay', zh: 'Chinese, in the same script (simplified or traditional) as the question', ta: 'Tamil', id: 'Indonesian', other: 'the same language as the question' };

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    question_en: { type: 'string' },
    language: { type: 'string', enum: Object.keys(LANGUAGES) },
    intent: { type: 'string', enum: INTENTS },
    devices: { type: 'array', items: { type: 'string' }, maxItems: 4 },
    about_previous: { type: 'boolean' },
    category: { type: 'string', enum: ['phone', 'watch', 'band', 'tablet', 'any'] },
    brand: { type: 'string' },
    budget_rm: { type: 'integer' },
    use_case: { type: 'string', enum: USE_CASES },
    attributes: { type: 'array', items: { type: 'string', enum: eng.ATTR_IDS }, maxItems: 4 },
    features: { type: 'array', items: { type: 'string', enum: eng.FEATURE_IDS }, maxItems: 4 },
    order: { type: 'string', enum: ['highest', 'lowest', 'none'] },
    terms: { type: 'array', items: { type: 'string' }, maxItems: 2 },
  },
  required: ['question_en', 'language', 'intent', 'devices', 'about_previous', 'category', 'brand', 'budget_rm', 'use_case', 'attributes', 'features', 'order', 'terms'],
  additionalProperties: false,
};

const PLAN_SYSTEM = `You turn a visitor's question to a phone, smartwatch and fitness band comparison website (Malaysia) into a JSON plan. Do not answer the question.
Fields:
- question_en: the question restated as a short, clear English question (fix typos, translate if needed).
- language: the language the visitor wrote in (en, ms = Malay, zh = Chinese, ta = Tamil, id = Indonesian, other).
- intent: device_info (specs or details of a device), price, feature_check (does it have NFC / eSIM / a headphone jack / wireless charging …), verdict (is it good, worth buying, good for gaming, pros and cons), reviews (what reviewers or tests say, problems, complaints), news (latest news, launch, updates about a device), compare (two or more devices, which is better), differences (what is different between two or more devices), recommend (which device to buy for a need or budget), rank (the device with the most or least of a spec: biggest battery, lightest, cheapest), advice (how to choose, what to look for, is a spec enough, how much do I need), explain_term (what a spec word means: IP68, LTPO, mAh), list (devices of a brand or year), smalltalk (greetings, thanks), other.
- devices: device model names exactly as the visitor wrote them (for example "s25 ultra", "redmi note 14"). Never invent names. Empty if none.
- about_previous: true when the question refers to earlier devices ("it", "this one", "the cheaper one", "them") without naming them.
- category: phone, watch, band, tablet, or any.
- brand: a brand name the visitor limited the question to, or "".
- budget_rm: the maximum price in Malaysian ringgit as a whole number ("under RM2k" = 2000, "bawah RM1000" = 1000, "below 1.5k" = 1500), or 0 when none.
- use_case: gaming, photography (camera, photos, selfies, video), battery (long battery life), student (value for money, cheap, basic use), longterm (lasting many years, updates), performance (speed), balanced (general or unspecified), or none.
- attributes: the specs the question is about, using only the allowed ids (battery, charging, camera, display, performance, price, weight …).
- features: yes/no features asked about, using only the allowed ids (nfc, esim, jack, wireless, card …).
- order: highest or lowest for rank questions ("biggest", "most", "lightest" = lowest weight, "cheapest" = lowest price), else none.
- terms: spec words the visitor wants explained, else empty.
Two or more devices with "vs", "or", "which is better" is compare, with use_case set to what they want it better for; "what is the difference" is differences. List features only when the visitor names them; never add others.`;

function planContext(ctx) {
  const name = (id) => store.deviceById.get(id)?.name;
  const page = (ctx.deviceIds ?? []).map(name).filter(Boolean);
  const prev = (ctx.lastIds ?? []).map(name).filter(Boolean);
  return [page.length ? `The page the visitor is on shows: ${page.join(', ')}.` : '', prev.length ? `The previous answer was about: ${prev.join(', ')}.` : ''].filter(Boolean).join(' ');
}

function normalisePlan(p, question) {
  if (!p || typeof p !== 'object' || !INTENTS.includes(p.intent)) return null;
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, 4) : []);
  return {
    question_en: typeof p.question_en === 'string' && p.question_en.trim() ? p.question_en.trim().slice(0, 240) : question,
    language: LANGUAGES[p.language] ? p.language : 'other',
    intent: p.intent,
    devices: arr(p.devices),
    about_previous: Boolean(p.about_previous),
    category: ['phone', 'watch', 'band', 'tablet'].includes(p.category) ? p.category : 'any',
    brand: typeof p.brand === 'string' ? p.brand.trim().slice(0, 40) : '',
    budget_rm: Number.isFinite(p.budget_rm) && p.budget_rm >= 100 && p.budget_rm <= 20000 ? Math.round(p.budget_rm) : 0,
    use_case: USE_CASES.includes(p.use_case) ? p.use_case : 'none',
    attributes: arr(p.attributes).filter((a) => eng.ATTR_IDS.includes(a)),
    features: arr(p.features).filter((f) => eng.FEATURE_IDS.includes(f)),
    order: ['highest', 'lowest'].includes(p.order) ? p.order : 'none',
    terms: arr(p.terms).slice(0, 2),
  };
}

/**
 * True when a device name from the plan is in the question, allowing for typos and a missing brand: at least half
 * of its words, including one with a digit ("iPhone 16 Pro" in "iphne 16 pro", "Galaxy S25 Ultra" in "s25 ultra").
 */
const VARIANT_WORDS = new Set(['pro', 'plus', 'max', 'ultra', 'lite', 'mini', 'fe', 'edge', 'neo', 'turbo', 'prime']);
function namedIn(name, question) {
  const q = ` ${normalizeText(question)} `;
  if (normalizeText(question).replace(/\s+/g, '').includes(normalizeText(name).replace(/\s+/g, ''))) return true;
  const words = normalizeText(name).split(' ').filter(Boolean);
  // a model word the visitor didn't write makes it another device: "redmi note 14" is not the "Redmi Note 14 Pro 5G"
  // (in testing, after an answer about the 14 Pro, the model planned "is the redmi note 14 worth it" as the 14 Pro)
  if (words.some((w) => VARIANT_WORDS.has(w) && !new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(q))) return false;
  const hits = words.filter((w) => q.includes(` ${w} `) || (/\d/.test(w) && q.replace(/\s+/g, '').includes(w)));
  return hits.some((w) => /\d/.test(w)) && hits.length * 2 >= words.length;
}

const GENERIC_WORDS = new Set(['phone', 'phones', 'smartphone', 'smartphones', 'watch', 'watches', 'smartwatch', 'band', 'bands', 'tablet', 'tablets', 'the', 'a', 'new', 'latest', 'cheap', 'best', 'telefon', 'fon']);
/** True for a "device" that is only brand and category words ("samsung phone", "xiaomi"). */
function isGeneric(name) {
  const brands = new Set((store.core.brands ?? []).flatMap((b) => normalizeText(b.name).split(' ')));
  return normalizeText(name).split(' ').filter(Boolean).every((w) => GENERIC_WORDS.has(w) || brands.has(w));
}

/** The visitor's language from the words themselves, when it is clear; the model's guess otherwise. */
function languageOf(question) {
  if (/[㐀-鿿]/.test(question)) return 'zh';
  if (/[஀-௿]/.test(question)) return 'ta';
  const words = normalizeText(question).split(' ');
  const count = (re) => words.filter((w) => re.test(w)).length;
  const malay = count(/^(yang|untuk|bawah|murah|bagus|telefon|fon|harga|mana|lebih|dan|ada|tak|tidak|boleh|saya|nak|berapa|dengan|atau|sesuai|terbaik|bateri|kamera|apa|beza|mahal|baik|bajet|ke|ni|tu)$/);
  const english = count(/^(the|is|are|what|which|for|and|with|does|do|how|my|i|best|under|below|good|any|much|it|a|an|of|to|can|should|than|or|between)$/);
  if (malay >= 2 && malay > english) return 'ms';
  if (english >= 1 && english >= malay) return 'en';
  return null;
}

const COMPARE_WORDS = /\b(vs|versus|compare[ds]?|comparison|or|which (one )?(is )?better|better between|bandingkan|atau|mana lebih)\b|还是|哪个|比较|對比|对比/i;
const PRONOUN = /\b(it|its|this one|that one|them|they|both|the (first|second|cheaper|other|former|latter)( one)?)\b|它|这个|這個|\b(ia|itu|ini)\b/i;
// words that make the model's use case plausible when the rules found none
const USE_HINTS = {
  gaming: /\b(games?|gaming|gamer|pubg|genshin|mlbb|mobile legends|fps|main game)\b|游戏|遊戲/i,
  photography: /\b(photos?|photography|camera|selfies?|pictures?|video|vlog\w*|instagram|tiktok|gambar|kamera)\b|拍照|相机|相機|摄影|攝影/i,
  battery: /\b(battery|batteries|bateri|charge|charging|endurance|last(s|ing)? (all|long|longer))\b|电池|電池|续航|續航/i,
  student: /\b(students?|pelajar|school|sekolah|university|universiti|value|cheap|budget|afford\w*|murah)\b|学生|學生|便宜/i,
  longterm: /\b(years?|tahun|long term|updates?|durable|last(s|ing)? long)\b|耐用|更新/i,
  performance: /\b(fast|speed|performance|powerful|lag\w*|laju|pantas)\b|性能|流畅|流暢/i,
  balanced: /./,
  none: /./,
};
const DIFFERENCE_WORDS = /\b(differ\w*|beza\w*|perbezaan)\b|区别|區別|不同|差别|差別|差异|差異/i;
const REVIEW_WORDS = /\b(reviews?|reviewers?|reviewed|problems?|issues?|complain\w*|flaws?|downsides?|drawbacks?|test results?|ulasan|masalah|kelemahan)\b|评测|評測|评价|評價|缺点|缺點|问题|問題/i;
const NEWS_WORDS = /\b(news|latest|rumou?rs?|leaks?|announced|launch(ed|ing)?|release date|coming|berita|terkini)\b|新闻|新聞|消息|发布|發布/i;
const FOLLOW_UP = /^\s*(and|also|then|so|what about|how about|bagaimana dengan|macam mana dengan|kalau)\b|^\s*(那|还有|那么)/i;
const SUPERLATIVE = /\b(lightest|heaviest|cheapest|priciest|biggest|largest|smallest|longest|shortest|fastest|slowest|brightest|thinnest|most|least|highest|lowest|paling|terringan|termurah|terbesar|terkecil|terlaju)\b|最轻|最輕|最便宜|最大|最小|最快|最亮|最薄/i;
const LOWEST = /\b(lightest|cheapest|smallest|shortest|slowest|thinnest|least|lowest|terringan|termurah|terkecil)\b|最轻|最輕|最便宜|最小|最薄/i;
const CATEGORY_PLAN = { smartphone: 'phone', smartwatch: 'watch', band: 'band', tablet: 'tablet' };
const OTHER_CATEGORY_WORDS = [
  [/手环|手環|\bgelang\b/i, 'band'],
  [/手表|手錶|\bjam (tangan|pintar)\b/i, 'smartwatch'],
  [/平板/, 'tablet'],
  [/手机|手機|\b(telefon|fon|handphone|ponsel)\b/i, 'smartphone'],
];

/**
 * Small models guess. The site's own rules re-read the question (and the model's English restatement) and
 * overrule the plan wherever they are sure: a feature the visitor never mentioned is dropped, a budget has to be
 * in the question, "X vs Y" is a comparison, and a use case, category or brand the rules recognise wins.
 */
function reconcile(plan, question) {
  const own = eng.analyse(question);
  // the English restatement may carry device names ("… Redmi Note 17 Pro Max 5G …"); their "5G" is not a question
  // about 5G unless the visitor wrote it
  const en = eng.analyse(/\b5g\b/i.test(question) ? plan.question_en : plan.question_en.replace(/\b5G\b/gi, ''));
  const p = { ...plan };

  // devices: only names the visitor actually wrote (in testing the model added three phones to "a phone for my mum"),
  // and not just a brand or a kind of device ("samsung phone")
  p.devices = plan.devices.filter((d) => namedIn(d, question) && !isGeneric(d));
  p.language = languageOf(question) ?? plan.language;

  // features: only ones actually mentioned
  const mentioned = new Set([...own.features, ...en.features]);
  p.features = [...new Set([...plan.features.filter((f) => mentioned.has(f)), ...mentioned])].slice(0, 4);
  // attributes: the ones the rules see first, then the model's
  p.attributes = [...new Set([...own.attrs, ...en.attrs, ...plan.attributes])].slice(0, 4);

  // budget: the rules' reading, or the model's only if that number is in the question ("预算2000令吉")
  const price = [own.maxPrice, en.maxPrice].find((m) => m && m.currency === 'MYR');
  if (price) p.budget_rm = Math.round(price.amount);
  else if (p.budget_rm) {
    const digits = question.replace(/[,\s]/g, '');
    const k = p.budget_rm % 100 === 0 ? `${p.budget_rm / 1000}k` : null;
    if (!digits.includes(String(p.budget_rm)) && !(k && digits.toLowerCase().includes(k))) p.budget_rm = 0;
  }

  // use case: a word the rules recognise ("long battery" -> battery), with budget words left out; the model's own
  // guess only when the question has a word that goes with it (it gave "is the Redmi Note 14 worth it" a student
  // use case and "a smartwatch for swimming" a gaming one)
  const noBudget = (s) => s.replace(/\b(budget|bajet|cheap(er|est)?|murah)\b/gi, (w) => (price ? '' : w));
  const profile = eng.analyse(noBudget(question)).profile ?? eng.analyse(noBudget(plan.question_en)).profile;
  if (profile) p.use_case = profile;
  else if (!USE_HINTS[p.use_case]?.test(`${question} ${plan.question_en}`)) p.use_case = 'none';

  // terms: only words the visitor used (the model added "IP68" and "LTPO" to a camera comparison)
  const squash = (s) => normalizeText(s).replace(/\s+/g, '');
  p.terms = plan.terms.filter((t) => squash(question).includes(squash(t)) || squash(plan.question_en).includes(squash(t)));

  // category: the rules' reading; a watch, band or tablet only when the visitor said so (in any language)
  const category = own.category ?? en.category ?? OTHER_CATEGORY_WORDS.find(([re]) => re.test(question))?.[1];
  if (category && CATEGORY_PLAN[category]) p.category = CATEGORY_PLAN[category];
  else if (p.category !== 'phone') p.category = 'any';
  // brand: only one the visitor wrote (the model carried "Redmi" over from an earlier question); for questions in
  // Chinese or Tamil script ("三星"), the one in the model's English restatement
  const otherScript = /[㐀-鿿஀-௿]/.test(question);
  const brandId = own.brands[0] ?? (otherScript ? en.brands[0] : undefined);
  const known = (store.core.brands ?? []);
  if (brandId) p.brand = known.find((b) => b.id === brandId)?.name ?? '';
  else p.brand = '';

  // intent fixes
  const text = `${question} ${plan.question_en}`;
  if (p.devices.length >= 2 && COMPARE_WORDS.test(text) && !['feature_check', 'price', 'differences'].includes(p.intent)) p.intent = 'compare';
  // "what is the main difference between X and Y" is about differences, not which is better
  if (p.devices.length >= 2 && DIFFERENCE_WORDS.test(text) && !/\bbetter|lebih baik|更好/i.test(text)) p.intent = 'differences';
  if (p.intent === 'differences' && p.devices.length < 2 && !p.about_previous) p.intent = p.devices.length ? 'device_info' : 'other';
  if (p.devices.length <= 1 && REVIEW_WORDS.test(text) && !['compare', 'differences'].includes(p.intent)) p.intent = 'reviews';
  if (p.devices.length <= 1 && NEWS_WORDS.test(text) && !['compare', 'differences', 'reviews'].includes(p.intent)) p.intent = 'news';
  const judging = /\b(good|worth|bagus|berbaloi|recommend(ed)?|should i)\b|好|值得/i.test(text);
  if (p.intent === 'feature_check' && !p.features.length) {
    if (p.devices.length >= 2) p.intent = 'compare';
    else p.intent = p.use_case !== 'none' || judging ? 'verdict' : 'device_info';
  }
  // one named device and "is it worth it?": a verdict on that device, not a list of other devices
  // (the 4B model planned "is the Redmi Note 14 worth it" as "best Redmi phone")
  if (p.devices.length === 1 && ['recommend', 'list'].includes(p.intent) && judging) p.intent = 'verdict';
  // "is the Redmi Note 14 worth it", "pros and cons of the OnePlus 15": the whole verdict, not one spec the model
  // picked (in testing "is … price good" and "is … performance good")
  if (['verdict', 'reviews', 'news'].includes(p.intent) && !own.attrs.length && p.language === 'en') p.attributes = [];
  // "vivo X300 Ultra camera specs" asks for the specifications, not a verdict (2B)
  if (p.intent === 'verdict' && p.devices.length && /\bspecs?\b|\bspecifications?\b|spesifikasi|规格|規格|参数|參數/i.test(question) && !judging) p.intent = 'device_info';
  // "the lightest Samsung phone": a ranking, not a question about the previous device
  if (!p.devices.length && p.attributes.length && SUPERLATIVE.test(text) && !['recommend', 'advice', 'explain_term'].includes(p.intent)) {
    p.intent = 'rank';
    p.order = LOWEST.test(text) ? 'lowest' : 'highest';
  }
  // follow-ups: a pronoun ("compare it with…") or a follow-up opening ("what about the battery?") means the earlier
  // device; otherwise only a very short question can lean on the previous answer (the model marked "is 5000 mAh
  // enough for a day?" as a follow-up and the answer drifted to the previous phones)
  const words = normalizeText(question).split(' ').filter(Boolean).length;
  const newTopic = own.brands.length || own.maxPrice || own.category || p.devices.length >= 2;
  p.about_previous = p.devices.length <= 1 && (PRONOUN.test(question) || FOLLOW_UP.test(question) || (plan.about_previous && !newTopic && (words <= 4 || /[㐀-鿿]/.test(question))));
  return p;
}

export async function understand(backend, question, ctx = {}) {
  const context = planContext(ctx);
  const raw = await backend.plan(PLAN_SYSTEM, `${context ? `${context}\n` : ''}Visitor's question: ${question}`, PLAN_SCHEMA);
  const plan = normalisePlan(raw, question);
  return plan ? reconcile(plan, question) : null;
}

// ------------------------------------------------------------------ 2. looking it up (no model involved)
const ATTR_WORD = {
  price: 'price', battery: 'battery', charging: 'charging', wireless: 'wireless charging', display: 'screen', refresh: 'refresh rate',
  brightness: 'brightness', chip: 'chip', performance: 'performance', ram: 'RAM', storage: 'storage', camera: 'camera', weight: 'weight',
  size: 'size', water: 'water resistance', release: 'launch date', software: 'software updates', jack: 'headphone jack', card: 'memory card',
  sim: 'SIM', wifi: 'Wi-Fi', bluetooth: 'Bluetooth', gps: 'GPS', sensors: 'sensors', colors: 'colours', speakers: 'speakers',
  biometrics: 'fingerprint', bands: 'network bands', usb: 'USB', network: '5G',
};
const FEATURE_WORD = {
  esim: 'eSIM', dualsim: 'dual SIM', wireless: 'wireless charging', reverse: 'reverse charging', fast: 'fast charging', jack: 'headphone jack',
  card: 'microSD card slot', ir: 'IR blaster', stereo: 'stereo speakers', uwb: 'UWB', nfc: 'NFC', '5g': '5G', wifi7: 'Wi-Fi 7', wifi6: 'Wi-Fi 6',
  ois: 'OIS', tele: 'telephoto camera', fingerprint: 'fingerprint reader', face: 'face unlock', ecg: 'ECG', spo2: 'SpO2', gps: 'GPS', water: 'water resistance',
};
// "biggest battery", "lightest" … as the rules phrase rankings
const RANK_WORD = {
  battery: ['biggest battery', 'smallest battery'], charging: ['fastest charging', 'slowest charging'], wireless: ['fastest wireless charging', 'slowest wireless charging'],
  display: ['biggest screen', 'smallest screen'], refresh: ['highest refresh rate', 'lowest refresh rate'], brightness: ['brightest', 'least bright'],
  performance: ['fastest', 'slowest'], ram: ['most RAM', 'least RAM'], storage: ['most storage', 'least storage'], camera: ['highest megapixel camera', 'lowest megapixel camera'],
  weight: ['heaviest', 'lightest'], price: ['most expensive', 'cheapest'], water: ['best water resistance', 'lowest water resistance'], software: ['longest updates', 'shortest updates'],
};
const CATEGORY_WORD = { phone: 'phone', watch: 'smartwatch', band: 'fitness band', tablet: 'tablet', any: 'phone' };
const CATEGORY_ID = { phone: 'smartphone', watch: 'smartwatch', band: 'band', tablet: 'tablet', any: 'smartphone' };
const USE_WORD = { gaming: 'gaming', photography: 'photography', battery: 'battery life', student: 'students', longterm: 'long-term use', performance: 'performance', balanced: '', none: '' };
// the site's own explanation to add as background when a question is about a spec
const TERM_FOR_ATTR = {
  battery: 'mAh', charging: 'fast charging watts', wireless: 'wireless charging', refresh: 'refresh rate', brightness: 'nits', display: 'OLED',
  chip: 'chipset', performance: 'benchmarks', ram: 'LPDDR', storage: 'UFS', camera: 'megapixels', water: 'IP68', sim: 'eSIM', network: '5G',
  wifi: 'Wi-Fi 7', bluetooth: 'bluetooth', gps: 'GPS', usb: 'USB-C', speakers: 'stereo speakers',
};

const couldntMatch = (res) => /I couldn't match that|I'm not sure what you're asking/.test(String(res?.html ?? ''));

/** Turn the plan into questions for the rule-based engine; returns the list of English queries to run. */
function queriesFor(plan, names) {
  const [a0] = plan.attributes;
  const attrWords = plan.attributes.map((a) => ATTR_WORD[a]).filter(Boolean).join(' and ');
  const cat = CATEGORY_WORD[plan.category];
  const use = USE_WORD[plan.use_case];
  const budget = plan.budget_rm ? ` under RM${plan.budget_rm}` : '';
  const brand = plan.brand ? `${plan.brand} ` : '';
  switch (plan.intent) {
    case 'device_info':
      return names.length ? [`${names[0]}${attrWords ? ` ${attrWords}` : ''}`] : [];
    case 'price':
      return names.length ? names.slice(0, 2).map((n) => `${n} price`) : [];
    case 'feature_check': {
      const what = plan.features.map((f) => FEATURE_WORD[f]).filter(Boolean).join(' and ') || attrWords;
      return names.length && what ? [`does ${names.join(' and ')} have ${what}`] : [];
    }
    case 'verdict':
      return names.length ? [`is ${names[0]}${a0 && !use ? ` ${ATTR_WORD[a0]}` : ''} good${use ? ` for ${use}` : ''}`] : [];
    // reviews and news: the site's verdict as the anchor; the findings and headlines come with the facts
    case 'reviews':
    case 'news':
      return names.length ? [`is ${names[0]} good`] : [];
    case 'differences':
      // the comparison table without "which is better"; every difference comes with the facts
      return names.length >= 2 ? [`${names.join(' vs ')}${attrWords ? ` ${attrWords}` : ''}`] : [];
    case 'compare':
      if (names.length >= 2) return [`${names.join(' vs ')}${attrWords ? ` ${attrWords}` : ''}${use ? ` which is better for ${use}` : ' which is better'}`];
      return names.length ? [`${names[0]} rivals`] : [];
    case 'recommend': {
      const q = [`best ${brand}${cat}${use ? ` for ${use}` : ''}${budget}`];
      // a need the rankings don't cover as a use case ("for swimming"): also rank by the spec behind it
      const need = !use && (plan.features.includes('water') ? 'water' : plan.attributes.find((a) => a !== 'price' && RANK_WORD[a]));
      if (need) q.push(`${RANK_WORD[need][0]} ${brand}${cat}${budget}`);
      return q;
    }
    case 'rank': {
      const words = RANK_WORD[a0];
      if (!words) return [`best ${brand}${cat}${use ? ` for ${use}` : ''}${budget}`];
      return [`${plan.order === 'lowest' ? words[1] : words[0]} ${brand}${cat}${budget}`];
    }
    case 'advice': {
      // general advice ("is 5000 mAh enough?") is answered from the database spread and the site's explanations;
      // a ranking only helps when there is a budget or a brand to shop within
      const q = [];
      if (plan.budget_rm || plan.brand) q.push(`best ${brand}${cat}${use ? ` for ${use}` : ''}${budget}`);
      if (names.length && attrWords) q.push(`${names[0]} ${attrWords}`);
      return q;
    }
    case 'explain_term':
      // the site's general explanation, or the term on a device the visitor named
      return names.length && attrWords ? [`${names[0]} ${attrWords}`] : [plan.question_en];
    case 'list':
      return [`${brand}${cat}s`];
    default:
      return [];
  }
}

/**
 * Run the plan against the site's data. Returns { facts, results: [{ query, res }], used, context, ids, unknown, ranked }; `context` holds the database spread and explanations when there was no direct answer.
 * `ranked` lists the devices of a ranking answer in order, for the ranking-order check.
 */
export async function lookUp(plan, question, ctx = {}) {
  const previous = ctx.lastIds?.length ? ctx.lastIds : ctx.deviceIds ?? [];
  let { ids, unknown } = await eng.resolveDevices(plan?.devices ?? []);
  // devices the rules find by exact name in the visitor's own words count too (the model may have left one out)
  const exact = await eng.devicesInText(question);
  ids = [...new Set([...ids, ...exact])].slice(0, 4);
  if (exact.length) unknown = unknown.filter((n) => !exact.some((id) => eng.officialName(id).toLowerCase().includes(n.toLowerCase())));
  const deviceIntent = ['device_info', 'price', 'feature_check', 'verdict', 'reviews', 'news', 'compare', 'differences', 'explain_term', 'advice'].includes(plan?.intent);
  // a spec term is explained in general ("what is LTPO and do I need it": the "it" is LTPO, not the last phone)
  if (plan && !ids.length && !unknown.length && deviceIntent && plan.intent !== 'explain_term' && (plan.about_previous || plan.intent !== 'advice')) ids = [...previous];
  // "compare it with the Pixel 10": the earlier device plus the one just named
  if (['compare', 'differences'].includes(plan?.intent) && ids.length === 1 && plan.about_previous && previous[0] && previous[0] !== ids[0]) ids = [previous[0], ids[0]];
  const names = ids.map(eng.officialName);

  const results = [];
  const run = async (query) => {
    const res = await eng.ask(query, { deviceIds: ids.length ? ids : ctx.deviceIds, lastIds: [] });
    results.push({ query, res });
    return res;
  };
  if (plan && plan.intent !== 'smalltalk') for (const q of queriesFor(plan, names).slice(0, 2)) await run(q);
  // nothing planned, or the plan's question didn't match: the visitor's own words, then the English restatement
  if (!results.length || results.every((r) => couldntMatch(r.res))) {
    // the previous answer's devices only for a follow-up ("how much RAM do I need for gaming?" is not about them,
    // and in "what is LTPO and do I need it" the "it" is LTPO)
    const followUp = !plan || (plan.about_previous && plan.intent !== 'explain_term');
    const own = await eng.ask(question, { deviceIds: followUp ? ctx.deviceIds : [], lastIds: followUp ? ctx.lastIds : [] });
    results.push({ query: question, res: own });
    if (couldntMatch(own) && plan?.question_en && plan.question_en !== question) await run(plan.question_en);
  }
  const good = results.filter((r) => !couldntMatch(r.res));

  // how the asked-about specs are spread across the database
  const categoryId = ids[0] ? store.deviceById.get(ids[0])?.category : CATEGORY_ID[plan?.category ?? 'any'];
  // (not for "what is LTPO": the spread of refresh rates invites guesses about which phones have it)
  const spread = plan?.intent === 'explain_term' ? [] : [...new Set(plan?.attributes ?? [])].map((a) => eng.dataContext(a, categoryId)).filter(Boolean).slice(0, 3);
  // the site's own explanations and what a use-case ranking weighs
  const background = [];
  for (const t of plan?.terms ?? []) background.push(eng.explainTerm(t));
  if (['advice', 'explain_term'].includes(plan?.intent)) background.push(...eng.explainTerms(`${question} ${plan.question_en}`, 2));
  if (['advice', 'explain_term', 'device_info'].includes(plan?.intent)) for (const a of (plan?.attributes ?? []).slice(0, 2)) background.push(eng.explainTerm(TERM_FOR_ATTR[a] ?? ''));
  if (plan && plan.use_case !== 'none' && ['recommend', 'verdict', 'advice', 'compare'].includes(plan.intent)) background.push(eng.useCaseInfo(plan.use_case));
  const bg = [...new Set(background.filter(Boolean))];

  // General advice with no direct site answer is explained from the spread and the explanations alone,
  // rather than from the rules' "I couldn't match that".
  const general = !good.length && (spread.length || bg.length);
  const used = good.length ? good : general ? [] : results.slice(-1);
  const parts = [used.length
    ? `SITE ANSWER (verified):\n${used.map((r) => eng.answerText(r.res.html)).join('\n\n')}`
    : 'SITE ANSWER: none for this exact question. Answer it with the figures in ACROSS THE DATABASE and the explanations in BACKGROUND.'];
  if (unknown.length) parts.push(`NOT IN THIS DATABASE: ${unknown.join(', ')} (the site has no data on ${unknown.length > 1 ? 'these' : 'this'}).`);

  // ---- Everything the site knows about the devices involved (Version 10), within the model's budget.
  // Rankings and recommendations get the key facts of their top devices; questions about one or two devices get the
  // whole record: specification sheet (or the asked-about sections), what differs, scores, reviews and tests,
  // prices and the latest headlines.
  const intent = plan?.intent;
  const fromAnswer = used.flatMap((r) => r.res.devices ?? []);
  const answerIds = [...new Set(['recommend', 'rank'].includes(intent) ? [...fromAnswer, ...ids] : [...ids, ...fromAnswer])].slice(0, 3);
  const perDevice = new Map(); // id → texts that belong to that device only, for the per-device checks
  const own = (id, text) => text && perDevice.set(id, [...(perDevice.get(id) ?? []), text]);
  const extra = []; // { title, body, keep } in order of importance; the least important are dropped first
  const sections = eng.sectionsFor(plan?.attributes ?? []);
  const wantsNetwork = sections.includes('network');
  const focus = ['recommend', 'rank', 'list', 'advice', 'explain_term'].includes(intent) ? [] : ids.slice(0, 3);
  const used1 = []; // what was used, for "What I looked up"

  if (!focus.length && answerIds.length && ['recommend', 'rank', 'advice'].includes(intent)) {
    const keyTexts = await Promise.all(answerIds.map(eng.keyFacts));
    keyTexts.forEach((t, i) => own(answerIds[i], t));
    if (keyTexts.some(Boolean)) extra.push({ title: 'KEY FACTS', body: keyTexts.filter(Boolean).join('\n'), keep: 3 });
  }
  if (focus.length === 1) {
    const id = focus[0];
    const wholeSheet = ['verdict', 'reviews', 'news', 'other'].includes(intent) || !sections.length;
    const sheet = await eng.specSheetText(id, { sections: wholeSheet ? null : sections, skip: wantsNetwork ? [] : ['network'] });
    own(id, sheet);
    if (sheet) extra.push({ title: wholeSheet ? 'SPECIFICATIONS' : 'SPECIFICATIONS (the sections asked about)', body: sheet, keep: 3 });
    if (!wholeSheet) {
      const rest = await eng.specSheetText(id, { skip: [...sections, ...(wantsNetwork ? [] : ['network'])] });
      own(id, rest);
      if (rest) extra.push({ title: 'OTHER SPECIFICATIONS', body: rest, keep: 0 });
    }
    used1.push('its full specification sheet');
  }
  if (focus.length >= 2) {
    const { differences, same, partial, detail } = await eng.differencesText(focus);
    for (const id of focus) own(id, await eng.specSheetText(id, { skip: ['network'] }));
    if (differences.length) extra.push({ title: 'DIFFERENCES (both recorded)', body: differences.join('\n'), keep: 3 });
    if (same.length) extra.push({ title: 'THE SAME ON BOTH', body: same.join('; '), keep: 1 });
    if (detail.length) extra.push({ title: 'WORDED DIFFERENTLY (the same thing, recorded in more detail for one; not a difference)', body: detail.join('\n'), keep: 0 });
    if (partial.length) extra.push({ title: 'RECORDED FOR ONLY ONE (not a difference, just a gap in the record)', body: partial.join('; '), keep: 0 });
    used1.push('both specification sheets side by side');
  }
  if (focus.length) {
    const scores = await Promise.all(focus.map(eng.scoresText));
    scores.forEach((t, i) => own(focus[i], t));
    if (scores.some(Boolean)) extra.push({ title: "SCORES (the site's analysis, 0–100, with rank among devices with the same evidence)", body: scores.filter(Boolean).join('\n'), keep: 2 });
    const prices = await Promise.all(focus.map(eng.pricesText));
    prices.forEach((t, i) => own(focus[i], t));
    extra.push({ title: 'MALAYSIAN LAUNCH PRICES', body: prices.join('\n'), keep: 2 });
    const reviews = await Promise.all(focus.map((id) => eng.reviewsText(id, { limit: focus.length > 1 ? 4 : 8 })));
    const reviewLines = reviews.flatMap((r, i) => (r.lines.length ? [`${eng.officialName(focus[i])}:`, ...r.lines] : []));
    reviews.forEach((r, i) => own(focus[i], r.lines.join('\n')));
    if (reviewLines.length) {
      extra.push({ title: 'REVIEWS AND TESTS (findings in the site\'s own words, with the publisher)', body: reviewLines.join('\n'), keep: intent === 'reviews' ? 3 : 1 });
      used1.push(`${reviews.reduce((n, r) => n + r.lines.length, 0)} review and test findings`);
    } else if (intent === 'reviews') {
      extra.push({ title: 'REVIEWS AND TESTS', body: 'No reviews or tests of this device are recorded on the site yet.', keep: 3 });
    }
    if (['news', 'reviews', 'device_info', 'verdict'].includes(intent)) {
      const heads = (await Promise.all(focus.map((id) => eng.headlinesText(id, { limit: 3 })))).flat();
      if (heads.length) {
        extra.push({ title: 'LATEST HEADLINES (titles collected from news feeds; not checked by the site)', body: heads.join('\n'), keep: intent === 'news' ? 3 : 0 });
        used1.push('the latest headlines');
      }
    }
  }
  if (spread.length) extra.push({ title: 'ACROSS THE DATABASE', body: spread.join('\n'), keep: 2 });
  if (bg.length) extra.push({ title: "BACKGROUND (the site's general explanations)", body: bg.join('\n'), keep: 2 });

  // fit the budget: drop the least important sections first, then shorten what is left
  const budget = ctx.budget ?? 14000;
  const size = () => parts.join('\n\n').length + extra.reduce((n, s) => n + s.title.length + s.body.length + 4, 0);
  for (const keep of [0, 1, 2]) {
    while (size() > budget && extra.some((s) => s.keep === keep)) extra.splice(extra.findLastIndex((s) => s.keep === keep), 1);
  }
  for (const s of extra) if (size() > budget) s.body = s.body.slice(0, Math.max(400, s.body.length - (size() - budget)));
  for (const s of extra) parts.push(`${s.title}:\n${s.body}`);
  parts.push(`ABOUT THE SITE: ${store.devices.length} phones, watches, bands and tablets sold in Malaysia. Prices are Malaysian launch prices in RM. Scores are the site's own analysis of recorded specifications and tests, not hands-on reviews.`);

  // Which lines belong to which device, so the checks can tell when the AI gives one device another's figures:
  // its own texts above, its line in a ranking ("- POCO X8 8,340 mAh") and its column of a comparison table.
  const factIds = [...new Set([...answerIds, ...fromAnswer, ...ids])].slice(0, 14);
  // full names, names without "5G", and the name without its brand or series word ("Note 15 Pro+ 5G",
  // "Watch 6 Lite", "S23") when no other device in this answer shares it
  const fullVariants = (id) => {
    const r = store.deviceById.get(id);
    return [...new Set([r.name, eng.officialName(id)].flatMap((n) => [n, n.replace(/\s*5G$/i, '')]))];
  };
  const shortVariant = (n) => {
    const rest = n.replace(/^(redmi|galaxy|xiaomi|oppo|vivo|honor|huawei|poco|realme|oneplus|samsung|redmagic|nubia)\s+/i, '');
    return rest !== n && /[a-z]/i.test(rest) && /\d/.test(rest) && rest.length >= 3 ? rest : null;
  };
  const rankRes = used.find((r) => /class="ask__rank"/.test(String(r.res.html)));
  const rankIds = rankRes ? (rankRes.res.devices ?? []).filter((id) => store.deviceById.has(id)) : [];
  const allShort = [...new Set([...factIds, ...rankIds])].flatMap((id) => [...new Set(fullVariants(id).map(shortVariant).filter(Boolean))]);
  const nameVariants = (id) => {
    const full = fullVariants(id);
    const short = [...new Set(full.map(shortVariant).filter(Boolean))].filter((v) => allShort.filter((x) => x.toLowerCase() === v.toLowerCase()).length === 1);
    return [...new Set([...full, ...short])];
  };
  const answerLines = used.flatMap((r) => eng.answerText(r.res.html).split('\n'));
  const owner = (line) => {
    // the device whose full name is the longest start of the line ("Redmi Note 17 5G …" is not the Redmi Note 17)
    let best = null;
    for (const id of factIds) for (const n of [store.deviceById.get(id).name, eng.officialName(id)]) {
      if (line.slice(2).toLowerCase().startsWith(`${n.toLowerCase()} `) && (!best || n.length > best.len)) best = { id, len: n.length };
    }
    return best?.id;
  };
  for (const l of answerLines.filter((x) => /^- /.test(x))) own(owner(l), l);
  // comparison table: " | Galaxy S24 Ultra | iPhone 16 Pro Max" then "Weight | 232 g | 227 g"
  const header = answerLines.find((l) => /^\s*\|/.test(l));
  if (header) {
    const cols = header.split('|').slice(1).map((c) => c.trim());
    const colIds = cols.map((c) => factIds.find((id) => nameVariants(id).some((n) => n.toLowerCase() === c.toLowerCase() || eng.officialName(id).toLowerCase().endsWith(c.toLowerCase()))));
    for (const l of answerLines.filter((x) => x !== header && x.includes(' | '))) {
      const [label, ...cells] = l.split(' | ');
      cells.forEach((c, i) => colIds[i] && own(colIds[i], `${label}: ${c}`));
    }
  }
  const deviceFacts = factIds.map((id) => ({ names: nameVariants(id), text: (perDevice.get(id) ?? []).join('\n') }));

  const ranked = rankRes ? rankIds.map(nameVariants) : null;
  return { facts: parts.join('\n\n'), results, used, extras: used1, context: general ? [...spread, ...bg] : [], deviceFacts, ids: answerIds.length ? answerIds : ids, unknown, ranked };
}

// ------------------------------------------------------------------ 3. explaining the answer
// what the answer should do with the facts, by kind of question
const TASK = {
  differences: 'List the main differences (up to six) from DIFFERENCES, giving each device\'s figure, most important first (price, size and weight, display, cameras, battery and charging, performance). Add one sentence on what stays the same if it helps. A field under RECORDED FOR ONLY ONE is a gap in the site\'s record, not a difference: mention it only as "not recorded for …".',
  compare: 'Say which comes out ahead according to SITE ANSWER (or that it is too close to call) and why, using the two or three DIFFERENCES that matter most for the question.',
  reviews: 'Summarise what REVIEWS AND TESTS say, naming the publisher of each point. If none are recorded, say so and give the site\'s own verdict instead.',
  news: 'Summarise the LATEST HEADLINES and news findings, saying they are headlines collected from news sites and not checked by this site.',
  device_info: 'Answer from SPECIFICATIONS, giving the figures asked about.',
  verdict: 'Explain the site\'s verdict using SCORES, strengths and weak areas, and REVIEWS AND TESTS if there are any.',
  default: 'Pick the figures that matter most for the question, use ACROSS THE DATABASE to say whether they are high, typical or low, and BACKGROUND to explain what they mean in everyday use.',
};

function writeSystem(language, intent, script = null) {
  const list = intent === 'differences';
  return `You are the helpful assistant of Tech Comparison Hub, a website that compares phones, smartwatches and fitness bands sold in Malaysia. The visitor already sees the site's own answer (SITE ANSWER) below yours. Your job is to answer their question in plain words, using ONLY the information in FACTS, which hold everything the site records about the devices involved.
Task: ${TASK[intent] ?? TASK.default}
Rules:
1. Every number, specification, price, date, rank and score you write must be copied exactly from FACTS, and only about the device FACTS give it for. Never use outside knowledge about devices and never guess.
2. "Not recorded" or "not listed" means the site has no information. Say so; never turn it into "it doesn't have it". Only say a device lacks something when FACTS say "No".
3. Anything listed under "Weaker points" or "Weak areas", or described as "bottom" or "lower", is a weak point; anything under "Strengths" or "Strong areas" is a strong point. Never swap them.
4. Explain trade-offs, but do not tell the visitor to buy or avoid a device. Review findings and test results are the publisher's: say who said or measured it. The site tests nothing itself, so never write "our tests" or "we tested".
5. If FACTS list something as NOT IN THIS DATABASE, say the site has no data on it. If FACTS don't answer the question, say what the site can tell them instead.
6. When FACTS say a comparison is too close to call, say it is too close to call and do not pick a winner. When FACTS say a verdict is partial or based on specifications only, mention it.
7. Write ${script ?? LANGUAGES[language] ?? 'the same language as the question'}, friendly and clear, ${list ? 'as one short sentence followed by a list of up to six points' : 'in at most 6 short sentences'}. Use RM for prices. Name devices exactly as FACTS do.
8. Do not mention FACTS, section names, these rules, or that you were given notes.`;
}

// Characters written differently in simplified and traditional Chinese, for answering in the visitor's own script
// (in testing the 4B model answered "预算2000令吉" in traditional characters)
const SIMPLIFIED = /[们这个说买预为无时间会来对发车门长东边钱请让没见还价机选择续电摄显]/g;
const TRADITIONAL = /[們這個說買預為無時間會來對發車門長東邊錢請讓沒見還價機選擇續電攝顯]/g;
function chineseScript(text) {
  const simp = (text.match(SIMPLIFIED) ?? []).length;
  const trad = (text.match(TRADITIONAL) ?? []).length;
  return simp > trad ? 'Chinese in simplified characters (简体中文), as the question is' : trad > simp ? 'Chinese in traditional characters (繁體中文), as the question is' : null;
}

export async function explain(backend, question, plan, found, onText) {
  const language = backend.languages === 'en' ? 'en' : plan?.language ?? 'other';
  const script = language === 'zh' ? chineseScript(question) : null;
  // the language is repeated last, where a small model follows it best (4B answered a simplified-Chinese question
  // in traditional characters when it was only in the instructions)
  const inLanguage = script ?? LANGUAGES[language];
  return backend.write(writeSystem(language, plan?.intent, script), `FACTS:\n${found.facts}\n\nVISITOR'S QUESTION: ${question}${inLanguage && language !== 'en' ? `\n\n(Answer in ${inLanguage}.)` : ''}`, onText);
}

// ------------------------------------------------------------------ follow-up questions to offer
export function followUps(plan, found) {
  const name = (id) => store.deviceById.get(id)?.name;
  const [a, b] = found.ids.map(name).filter(Boolean);
  const use = plan?.use_case && !['none', 'balanced'].includes(plan.use_case) ? USE_WORD[plan.use_case] : null;
  const out = [];
  switch (plan?.intent) {
    case 'recommend':
    case 'rank':
      if (a && b) out.push(`Compare the ${a} and the ${b}`);
      if (a) out.push(`Is the ${a} worth buying?`);
      if (a) out.push(`Does the ${a} have NFC and eSIM?`);
      break;
    case 'compare':
      if (a && b) out.push(`What is the difference between the ${a} and the ${b}?`, `Which has the better camera, the ${a} or the ${b}?`);
      break;
    case 'differences':
      if (a && b) out.push(`Which is better for photography, the ${a} or the ${b}?`, `Which has the longer battery life, the ${a} or the ${b}?`, `What do reviewers say about the ${a}?`);
      break;
    case 'reviews':
    case 'news':
      if (a) out.push(`Is the ${a} worth buying?`, `Compare the ${a} with its rivals`, `What does the ${a} cost in Malaysia?`);
      break;
    case 'verdict':
    case 'device_info':
    case 'price':
    case 'feature_check':
      if (a) out.push(`Compare the ${a} with its rivals`, use ? `Is the ${a} good for photography?` : `Is the ${a} good for gaming?`, `What does the ${a} cost in Malaysia?`);
      break;
    case 'advice':
    case 'explain_term':
      out.push(plan.budget_rm ? `Best phone for ${use ?? 'everyday use'} under RM${plan.budget_rm}` : 'Best phone under RM1,500', 'What is IP68?');
      break;
    default:
      break;
  }
  return [...new Set(out)].filter((q) => !/undefined/.test(q)).slice(0, 3);
}
