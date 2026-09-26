// Optional on-device AI (Version 9). Two interchangeable back-ends, both free and running on the visitor's device:
//
//   • WebLLM + WebGPU with Qwen3.5 2B (about 1.1 GB) or, on strong PCs, Qwen3.5 4B (about 2.4 GB), both Apache 2.0.
//     Downloaded once from Hugging Face into the browser's Cache Storage (or IndexedDB, if the browser refuses a
//     large file).
//   • The browser's own built-in model (Chrome's Prompt API, `LanguageModel`), when the browser offers it. The
//     browser downloads and manages that model itself and shares one copy between sites. English only for now.
//     It is tried once before use, because some Chromium builds offer the interface with no model behind it.
//
// Each back-end does two jobs for engine/ai-agent.js: `plan()` returns JSON that is forced to match a schema
// (grammar-constrained decoding), and `write()` returns free text. Nothing is ever sent to an AI service.
// The answer checks at the end of this file run before any AI text is shown.

const WEBLLM = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm';

export const MODELS = {
  'qwen35-2b': { label: 'Qwen3.5 2B', mb: 1083, gpuMB: 2245, ids: { f16: 'Qwen3.5-2B-q4f16_1-MLC', f32: 'Qwen3.5-2B-q4f32_1-MLC' }, page: 'https://huggingface.co/Qwen/Qwen3.5-2B' },
  'qwen35-4b': { label: 'Qwen3.5 4B', mb: 2390, gpuMB: 3868, ids: { f16: 'Qwen3.5-4B-q4f16_1-MLC', f32: 'Qwen3.5-4B-q4f32_1-MLC' }, page: 'https://huggingface.co/Qwen/Qwen3.5-4B' },
};

let webllm = null;
const lib = async () => (webllm ??= await import(WEBLLM));

// ------------------------------------------------------------------ what this device can run
/**
 * { webgpu: { ok, f16, strong, reason }, builtin: 'available' | 'downloadable' | 'downloading' | 'unavailable' }.
 * "strong" (offer the 4B model) is a cautious guess: a computer (not a phone) with at least 8 GB of memory and a
 * graphics chip that allows 2 GB buffers. A 4B model that still doesn't fit falls back to 2B with a message.
 */
export async function deviceSupport() {
  const out = { webgpu: { ok: false, f16: false, strong: false, reason: '' }, builtin: 'unavailable' };
  if ('gpu' in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
        out.webgpu = {
          ok: true,
          f16: adapter.features.has('shader-f16'),
          strong: !mobile && (navigator.deviceMemory ?? 8) >= 8 && adapter.limits.maxBufferSize >= 2 ** 31,
          reason: '',
        };
      } else {
        out.webgpu.reason = 'WebGPU is switched off in this browser, or no suitable graphics chip was found.';
      }
    } catch {
      out.webgpu.reason = 'WebGPU could not start in this browser.';
    }
  } else {
    out.webgpu.reason = 'This browser has no WebGPU (recent Chrome and Edge on most computers have it; many phones and older laptops don’t yet).';
  }
  if (typeof self.LanguageModel !== 'undefined') {
    try {
      out.builtin = await self.LanguageModel.availability(LANG);
    } catch {
      out.builtin = 'unavailable';
    }
  }
  return out;
}

const LANG = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };

/** Drop any reasoning block and markdown emphasis the model may still produce. */
export function clean(text) {
  return String(text ?? '')
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    // section names copied from the notes it was given ("Background", "Strengths", "KEY FACTS")
    .replace(/^\s*(site answer|key facts|across the database|background|about the site|not in this database|strengths|weaker points|specifications|other specifications|differences|the same on both|worded differently|recorded for only one|scores|malaysian launch prices|reviews and tests|latest headlines)\s*[:.]?\s*$/gim, '')
    // …or inside a sentence (Version 20: "根据 SITE ANSWER 的数据" in a Chinese answer)
    .replace(/根据\s*(?:the\s*)?SITE ANSWER\s*(?:\(verified\)\s*)?的?数据/g, '根据本站的数据')
    .replace(/(?:the\s+)?\bSITE ANSWER\b(?:\s*\(verified\))?/g, "the site's data")
    .replace(/\b(KEY FACTS|ACROSS THE DATABASE|REVIEWS AND TESTS|MALAYSIAN LAUNCH PRICES|LATEST HEADLINES)\b/g, (m) => m.toLowerCase())
    // it sometimes refers to its instructions despite being told not to
    .replace(/\b(in|from|according to|based on) the (provided |given )?(facts|information provided|notes)\b/gi, 'on this site')
    .trim();
}

function parseJson(text) {
  const t = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = /\{[\s\S]*\}/.exec(t);
    return m ? JSON.parse(m[0]) : null;
  }
}

// ------------------------------------------------------------------ back-end 1: WebLLM (Qwen3.5)
// Where the model files are kept. WebLLM uses the browser's Cache Storage by default, but a browser can refuse a
// very large file there (in testing, the 318 MB first weight file of the 4B model: "Failed to execute 'add' on
// 'Cache': Unexpected internal error"). The download then moves to IndexedDB, and later visits look in both.
const STORES = ['cache', 'indexeddb'];
const REFUSED = /on 'Cache'|Unexpected internal error/i;
const appConfig = async (store) => ({ ...(await lib()).prebuiltAppConfig, cacheBackend: store });
const CONTEXT_TOKENS = 8192;
// no download progress for this long restarts the download once (Version 20)
const STALL_MS = 90000;
// characters of facts that fit beside the instructions, the question and the answer (about 3.5 characters a token)
const FACTS_BUDGET = 15000;

export class WebLLMBackend {
  constructor(key, { f16 = true } = {}) {
    this.key = key;
    this.info = MODELS[key];
    this.model = this.info.ids[f16 ? 'f16' : 'f32'];
    this.engine = null;
    this.cancel = null; // set while loading: stops the download
    this.kind = 'webllm';
    this.factsBudget = FACTS_BUDGET;
    this.languages = 'any';
  }

  get label() {
    return this.info.label;
  }

  /** Which store holds a complete copy: 'cache', 'indexeddb' or null. */
  async savedIn() {
    const wl = await lib();
    for (const store of STORES) {
      try {
        if (await wl.hasModelInCache(this.model, await appConfig(store))) return store;
      } catch {
        /* that store isn't usable here */
      }
    }
    return null;
  }

  async isDownloaded() {
    return Boolean(await this.savedIn());
  }

  async load(onProgress) {
    if (this.engine) return;
    const { CreateWebWorkerMLCEngine, deleteModelAllInfoInCache } = await lib();
    const saved = await this.savedIn();
    const progress = (r) => onProgress?.({ progress: r.progress ?? 0, text: /fetch|download/i.test(r.text ?? '') ? 'downloading (only the first time)' : /cache/i.test(r.text ?? '') ? 'loading from this browser' : 'preparing the model on your graphics chip' });
    for (const store of saved ? [saved] : STORES) {
     // Version 20: a download that stops moving for STALL_MS is restarted once by itself; the parts already saved are
     // kept, so it carries on from there (seen in testing: a download sitting at the same percentage for minutes)
     for (let attempt = 0; attempt < 2; attempt += 1) {
      const worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
      // the visitor can stop a long or stalled download; stopping ends the worker and the wait
      const stopped = new Promise((_, reject) => {
        this.cancel = () => {
          worker.terminate();
          reject(Object.assign(new Error('Stopped.'), { name: 'AbortError' }));
        };
      });
      let moved = { at: Date.now(), p: -1, downloading: true };
      let watch = null;
      const stalled = new Promise((_, reject) => {
        watch = setInterval(() => {
          if (moved.downloading && Date.now() - moved.at > STALL_MS) reject(Object.assign(new Error('Stalled.'), { name: 'StallError' }));
        }, 5000);
      });
      const watched = (r) => {
        const downloading = /fetch|download/i.test(r.text ?? '');
        if ((r.progress ?? 0) !== moved.p || downloading !== moved.downloading) moved = { at: Date.now(), p: r.progress ?? 0, downloading };
        progress(r);
      };
      try {
        // an 8K context window (the prebuilt setting is 4K) so the model can read a device's whole record
        this.engine = await Promise.race([CreateWebWorkerMLCEngine(worker, this.model, { appConfig: await appConfig(store), initProgressCallback: watched }, { context_window_size: CONTEXT_TOKENS }), stopped, stalled]);
        clearInterval(watch);
        this.cancel = null;
        return;
      } catch (error) {
        clearInterval(watch);
        worker.terminate();
        this.cancel = null;
        if (error?.name === 'StallError' && attempt === 0) {
          onProgress?.({ progress: Math.max(0, moved.p), text: 'the download paused, so starting it again (the parts already saved are kept)' });
          continue;
        }
        if (error?.name === 'StallError') throw Object.assign(new Error('The download stopped moving. Please try again later, or choose the smaller model.'), { name: 'StallError' });
        // only a refused file moves the download to the other store; anything else is a real failure
        if (error?.name === 'AbortError' || saved || store === STORES[STORES.length - 1] || !REFUSED.test(String(error?.message ?? error))) throw error;
        try {
          await deleteModelAllInfoInCache(this.model, await appConfig(store)); // the partial copy
        } catch {
          /* nothing to clear */
        }
        onProgress?.({ progress: 0, text: 'this browser refused one large file, so saving the model to its database instead' });
        break; // on to the next store
      }
     }
    }
  }

  /** JSON forced to match `schema` (WebLLM compiles the schema into a grammar). */
  async plan(system, user, schema) {
    const res = await this.engine.chat.completions.create({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0,
      max_tokens: 320,
      response_format: { type: 'json_object', schema: JSON.stringify(schema) },
      extra_body: { enable_thinking: false },
    });
    return parseJson(res.choices?.[0]?.message?.content);
  }

  async write(system, user, onText) {
    const stream = await this.engine.chat.completions.create({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: true,
      temperature: 0,
      frequency_penalty: 0.4,
      max_tokens: 420,
      extra_body: { enable_thinking: false },
    });
    let text = '';
    for await (const chunk of stream) {
      text += chunk.choices?.[0]?.delta?.content ?? '';
      onText?.(clean(text));
    }
    return clean(text);
  }

  stop() {
    this.engine?.interruptGenerate?.();
  }

  async remove() {
    try {
      await this.engine?.unload();
    } catch {
      /* already gone */
    }
    this.engine = null;
    const { deleteModelAllInfoInCache } = await lib();
    for (const store of STORES) await deleteModelAllInfoInCache(this.model, await appConfig(store)).catch(() => {});
  }
}

// ------------------------------------------------------------------ back-end 2: the browser's built-in model
// Some Chromium builds expose `LanguageModel` with no model behind it: availability() says "downloadable" and
// every prompt is echoed back ("On-device model is not available in Chromium, this API is just echoing back the
// input", seen in testing, with a 1,000-token window). So the model is tried once before it is used.
const MIN_CONTEXT = 3000; // tokens; the planning and writing prompts need about 1,500–2,500

async function probe(session) {
  const room = session.contextWindow ?? session.inputQuota;
  if (Number.isFinite(room) && room < MIN_CONTEXT) {
    throw new Error(`This browser's built-in AI takes only ${room.toLocaleString('en')} tokens at a time, too little for these answers.`);
  }
  const question = 'Reply with the single word: ready';
  const reply = String(await session.prompt(question));
  if (!reply.trim() || reply.includes(question) || /\becho/i.test(reply)) {
    throw new Error('This browser has the built-in AI interface but no working model behind it.');
  }
}

export class BuiltinBackend {
  constructor() {
    this.kind = 'builtin';
    this.languages = 'en';
    this.sessions = new Map(); // system prompt → base session, cloned for each request
    this.abort = null;
    this.cancel = null; // set while loading
    this.ready = false;
    this.factsBudget = 6000; // replaced by what the browser's model can take once it has been tried
  }

  get label() {
    return "your browser's built-in AI";
  }

  async load(onProgress) {
    // creating a first session makes the browser download its model if it hasn't yet
    const abort = new AbortController();
    this.cancel = () => abort.abort();
    try {
      const s = await self.LanguageModel.create({
        ...LANG,
        signal: abort.signal,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => onProgress?.({ progress: e.loaded ?? 0, text: 'your browser is downloading its AI model (only the first time)' }));
        },
      });
      try {
        await probe(s);
        const room = s.contextWindow ?? s.inputQuota;
        if (Number.isFinite(room)) this.factsBudget = Math.max(3000, Math.min(FACTS_BUDGET, (room - 1800) * 3));
      } finally {
        s.destroy();
      }
      this.ready = true;
    } finally {
      this.cancel = null;
    }
  }

  async session(system) {
    if (!this.sessions.has(system)) this.sessions.set(system, await self.LanguageModel.create({ ...LANG, initialPrompts: [{ role: 'system', content: system }] }));
    return this.sessions.get(system).clone();
  }

  async plan(system, user, schema) {
    const s = await this.session(system);
    try {
      return parseJson(await s.prompt(user, { responseConstraint: schema }));
    } finally {
      s.destroy();
    }
  }

  async write(system, user, onText) {
    const s = await this.session(system);
    this.abort = new AbortController();
    let text = '';
    try {
      for await (const chunk of s.promptStreaming(user, { signal: this.abort.signal })) {
        // older Chrome versions streamed the whole text so far; newer ones stream only the new part
        text = chunk.startsWith(text) ? chunk : text + chunk;
        onText?.(clean(text));
      }
    } catch (error) {
      if (error?.name !== 'AbortError') throw error;
    } finally {
      s.destroy();
      this.abort = null;
    }
    return clean(text);
  }

  stop() {
    this.abort?.abort();
  }
}

// ------------------------------------------------------------------ answer checks (from Version 8, run before display)
// The verified part of the facts: everything before the added context sections.
// (the sections after it are context: specifications, differences, scores, reviews, prices, headlines, spread, background)
const verified = (facts) => facts.split(/\n\n(?:KEY FACTS|ACROSS THE DATABASE|BACKGROUND|ABOUT THE SITE|DEVICE DETAILS|SPECIFICATIONS|OTHER SPECIFICATIONS|DIFFERENCES|THE SAME ON BOTH|WORDED DIFFERENTLY|RECORDED FOR ONLY ONE|SCORES|MALAYSIAN LAUNCH PRICES|REVIEWS AND TESTS|LATEST HEADLINES)[^\n]*:/)[0];

/**
 * True when the verified answer says something is not recorded / not listed but the AI's answer never says so
 * (small models tend to turn "not recorded" into "it doesn't have it").
 */
export function dropsUnknowns(answer, facts) {
  const part = verified(facts);
  if (/ \| /.test(part)) return false; // comparison tables always have some empty cells; a summary needn't list them
  if (!/\bnot (recorded|listed)\b/i.test(part)) return false;
  return !/\bnot (recorded|listed|stated|known|specified|confirmed)\b|\bisn'?t (recorded|listed|stated|known|confirmed)\b|\bno (information|data|record)\b|\b(doesn'?t|does not|do not|don'?t) (say|state|list|mention|confirm)\b|\bdon'?t (have|know)\b|\bunknown\b|\bunclear\b|\bunverified\b|\btidak (direkod|dinyatakan|diketahui|disahkan)\b|\btiada (maklumat|rekod)\b|未记录|未記錄|没有记录|沒有記錄/i.test(answer);
}

/**
 * True when a sentence of the answer says the device lacks something ("doesn't have", "lacks", "no …") that the
 * verified answer only marks as not recorded or not listed, e.g. "Wireless charging: Not recorded".
 */
export function negatesUnknowns(answer, facts) {
  const part = verified(facts);
  // "Wireless charging: not recorded" lines, and comparison-table rows with a "not recorded" cell
  // ("Front camera | 12 MP | not recorded"; the 2B model turned that into "both lack … front cameras")
  const labels = [
    ...[...part.matchAll(/^-?\s*([A-Za-z0-9 .()-]{3,60}?)[:\s]+not (?:recorded|listed)\b/gim)].map((m) => m[1]),
    ...[...part.matchAll(/^([^|\n]{3,60}?)\s*\|[^\n]*\bnot (?:recorded|listed)\b/gim)].map((m) => m[1]),
  ];
  const unknown = labels
    .map((l) => l.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !['with', 'from', 'this', 'that'].includes(w)))
    .filter((words) => words.length);
  if (!unknown.length) return false;
  const sentences = answer.toLowerCase().split(/(?<=[.!?])\s+/);
  return sentences.some((s) => (/\b(doesn'?t|does not|do not|don'?t|lacks?|lacking|without|no)\b/.test(s) || /\bneither\b/.test(s))
    // about the data, not the device: "no recorded…", "lacks front camera specifications"
    && !/\b(recorded|listed|stated|information)\b/.test(s)
    && !/\b(no|lacks?|lacking|without|missing)\s+(\w+\s+){0,2}(data|details|specifications?|specs|records?|figures?|values?)\b/.test(s)
    // names the unknown feature, or sweeps it in with "both" / "either" / "neither" / "all of"
    && (unknown.some((words) => words.some((w) => s.includes(w))) || /\b(both|either|neither|all of)\b/.test(s)));
}

// Words that name each score area in an answer, for checking praise and criticism against the verdict.
const AREA_WORDS = {
  performance: /\b(performance|speed|fast|faster|processor|chip)/,
  gaming: /\b(gaming|games?)\b/,
  'battery life': /\bbattery\b/,
  charging: /\bcharg/,
  display: /\b(display|screen)\b/,
  'camera hardware': /\b(camera|photo)/,
  'software support': /\b(software|updates?)\b/,
  'build & portability': /\b(light|lighter|lightweight|weight|heavy|heavier|portab|build|compact)/,
  durability: /\b(durab|water|tough|rugged)/,
};
// "charging speed", "fast charging", "charges faster" are about charging, not performance
const CHARGING_SPEED = /\bcharg\w*\s+(speeds?|fast|faster|quickly)\b|\b(fast|faster|quick|quicker)[\s-]+charg\w*/g;
const mentionsArea = (area, s) => AREA_WORDS[area].test(area === 'performance' ? s.replace(CHARGING_SPEED, ' ') : s);
// Praise or criticism the site's own scores back: "software support is excellent" about the device whose strong
// area is software support (Version 10; in testing such sentences were removed as unsupported judgements)
const PRAISE_CLAIMS = new Set(['strong', 'stronger', 'great', 'excellent', 'impressive', 'outstanding', 'top-tier', 'solid', 'decent', 'hebat', 'cemerlang', 'kuat', 'mantap']);
const CRITIC_CLAIMS = new Set(['weak', 'poor', 'slow', 'slower']);
function claimsBackedByStandings(sentence, claims, standings) {
  if (!standings) return [];
  const clauses = sentence.toLowerCase().split(/,\s*|;\s*|\s+(?:and|but|while|whereas|although|dan|tetapi)\s+/);
  return claims.filter((w) => {
    const list = PRAISE_CLAIMS.has(w) ? standings.strong : CRITIC_CLAIMS.has(w) ? standings.weak : null;
    if (!list?.length) return false;
    const holding = clauses.filter((c) => new RegExp(`\\b${w}\\b`).test(c));
    return holding.length > 0 && holding.every((c) => {
      const areas = Object.keys(AREA_WORDS).filter((a) => mentionsArea(a, c));
      return areas.length > 0 && areas.every((a) => list.includes(a));
    });
  });
}
/** The areas listed under a verdict heading ("Strengths", "Weaker points") in the verified answer. */
function verdictAreas(facts, heading) {
  const m = new RegExp(`\\n${heading}\\n((?:- .*\\n?)+)`).exec(verified(facts));
  const lines = m ? m[1].split('\n').map((l) => l.replace(/^- /, '').toLowerCase()) : [];
  return Object.keys(AREA_WORDS).filter((a) => lines.some((l) => l.startsWith(a)));
}

const PRAISE = /\b(strong|good|great|excellent|impressive|decent|solid|light|lighter|lightweight|fast|best|top|high|highly|(?<!as )well|plus|advantage|standout)\b/;
const CRITICISM = /\b(weak|poor|low|lower|bottom|heavy|heavier|slow|worse|lacks?|behind|limited|near the bottom)\b/;

/**
 * True when the answer praises an area the verdict lists under "Weaker points", or criticises one listed under
 * "Strengths" (in testing, the small model called a phone in the bottom 10% for weight "among the lighter devices").
 */
export function contradictsStandings(answer, facts, standings = null) {
  const part = verified(facts);
  const listAfter = (heading) => {
    const m = new RegExp(`\\n${heading}\\n((?:- .*\\n?)+)`).exec(part);
    return m ? m[1].split('\n').map((l) => l.replace(/^- /, '').toLowerCase()) : [];
  };
  const areasIn = (lines) => Object.keys(AREA_WORDS).filter((a) => lines.some((l) => l.startsWith(a)));
  // the verdict's lists, or (Version 10) the strong and weak areas of the one device a sentence is about
  const weak = standings ? standings.weak : areasIn(listAfter('Weaker points'));
  const strong = standings ? standings.strong : areasIn(listAfter('Strengths'));
  if (!weak.length && !strong.length) return false;
  // one clause at a time: "while it scores highly on performance, its charging is rated low" praises one area and
  // criticises another
  const clauses = answer.toLowerCase().split(/(?<=[.!?])\s+|,\s*(?:but|while|whereas|although|though|yet)\s+|;\s*|\s+(?:but|whereas)\s+/)
    .flatMap((c) => (/^(while|although|though|whereas|despite|even though)\b/.test(c.trim()) ? c.split(/,\s*/) : [c]));
  return clauses.some((s) => {
    const praised = PRAISE.test(s) && !CRITICISM.test(s);
    const criticised = CRITICISM.test(s) && !PRAISE.test(s);
    return (praised && weak.some((a) => mentionsArea(a, s))) || (criticised && strong.some((a) => mentionsArea(a, s)));
  });
}

// Describing words an answer must not introduce on its own ("a more powerful chip", "a strong battery").
const CLAIM_WORDS = ['strong', 'stronger', 'powerful', 'great', 'excellent', 'impressive', 'amazing', 'fast', 'faster', 'fastest', 'slow', 'slower',
  'better', 'worse', 'best', 'worst', 'premium', 'flagship', 'budget', 'cheap', 'cheaper', 'expensive', 'affordable', 'lightweight', 'heavy',
  'heavier', 'bright', 'brighter', 'sharp', 'sharper', 'smooth', 'smoother', 'long-lasting', 'durable', 'reliable', 'capable', 'efficient', 'weak',
  'poor', 'basic', 'advanced', 'decent', 'solid', 'top-tier', 'high-end', 'low-end', 'mid-range', 'superior', 'inferior', 'ideal', 'perfect',
  // buying advice: the site ranks and explains, it doesn't tell people to buy or avoid
  'recommend', 'recommended', 'recommends', 'avoid', 'must-buy', 'bargain', 'overpriced',
  // size and weight words, and emphasis the data rarely backs ("very light at 224 g" in testing)
  'light', 'lighter', 'slim', 'thin', 'compact', 'outstanding',
  // Malay: best, great, excellent, strong, fast, light, heavy, cheap, expensive, powerful
  'terbaik', 'hebat', 'cemerlang', 'kuat', 'laju', 'pantas', 'ringan', 'berat', 'murah', 'mahal', 'berkuasa', 'mantap', 'bajet'];

/**
 * True when the site calls a comparison too close to call but the answer never says so (in testing the model
 * turned a 76-vs-73 tie into "the stronger choice").
 */
export function ignoresTie(answer, facts) {
  if (!/too close to call/i.test(verified(facts))) return false;
  // only an answer that names a winner must also say it's close ("what is the difference?" needn't mention it)
  return WINNER_WORDS.test(answer) && !TIE_WORDS.test(answer);
}
const TIE_WORDS = /\b(close|tie|tied|similar(ly)?|level|even|neck and neck|too close|marginal(ly)?|neither|no clear|not clearly|hampir sama|seri|setara)\b|接近|相近|差不多|平手/i;
const WINNER_WORDS = /\b(better|best|wins?|winner|ahead|superior|stronger|outperforms?|beats?|lebih baik|menang)\b|更好|胜出|赢/i;

// Comparative words the verified answer backs when it names a winner or a cheaper/lighter device.
const BACKED_BY = [
  [/comes out ahead/i, ['better', 'stronger', 'superior']],
  [/\bis cheaper\b/i, ['cheaper', 'expensive']],
  [/\bis lighter\b/i, ['heavier', 'lightweight', 'lighter']],
];
const SUPERLATIVE_BACKS = [
  [/\blightest\b|terringan|最轻|最輕/i, ['light', 'lighter', 'lightweight']],
  [/\bcheapest\b|termurah|最便宜/i, ['cheap', 'cheaper']],
  [/\bfastest\b|terlaju|最快/i, ['fast', 'faster']],
  [/\bbrightest\b|最亮/i, ['bright', 'brighter']],
  [/\b(slimmest|thinnest)\b|最薄/i, ['slim', 'thin']],
  [/\b(heaviest)\b/i, ['heavy', 'heavier']],
];
// "best" is backed only in a sentence about the first device of the site's ranking (see sentenceProblem)
const BEST_WORDS = ['best', 'top', 'terbaik'];

/** Describing words in the answer that appear neither in the facts nor in the question. */
export function unsupportedClaims(answer, facts, question = '') {
  const backed = BACKED_BY.filter(([re]) => re.test(verified(facts))).flatMap(([, words]) => words);
  // a visitor who gives a price limit has a budget; saying so is not a claim
  if (/\b(under|below|within|budget|bajet|bawah|max(imum)?)\b|预算|rm ?\d/i.test(question)) backed.push('budget', 'bajet');
  // asking for "the lightest" makes "light" and "lighter" part of the answer's subject, not a claim
  for (const [re, words] of SUPERLATIVE_BACKS) if (re.test(question)) backed.push(...words);
  const known = `${facts} ${question} ${backed.join(' ')}`.toLowerCase();
  const words = new Set(answer.toLowerCase().match(/[a-z]+(?:-[a-z]+)*/g) ?? []);
  return CLAIM_WORDS.filter((w) => words.has(w) && !new RegExp(`\\b${w}\\b`).test(known));
}

/**
 * For ranked answers: true when the first device the AI names isn't the site's first (in Version 8 testing it
 * called the 5th of 5 "the best"). Later devices may come in any order: "the POCO M7 is cheaper than the
 * Redmi 15 5G" is a fair point even though the Redmi ranks higher. `ranked` is [[name variants…], …] in rank order.
 */
export function misordersRanking(answer, ranked) {
  if (!ranked?.length) return false;
  // longest names first, each match blanked out, so "Redmi Watch 6" is not found inside "Redmi Watch 6 Lite"
  let text = answer.toLowerCase();
  const names = ranked.flatMap((ns, rank) => ns.map((n) => [n.toLowerCase(), rank])).sort((a, b) => b[0].length - a[0].length);
  const found = [];
  for (const [n, rank] of names) {
    for (let at = text.indexOf(n); at >= 0; at = text.indexOf(n, at + 1)) {
      if (/[a-z0-9+]/.test(text[at + n.length] ?? '') || /[a-z0-9]/.test(text[at - 1] ?? '')) continue;
      found.push([at, rank]);
      text = text.slice(0, at) + ' '.repeat(n.length) + text.slice(at + n.length);
    }
  }
  if (!found.length) return false;
  found.sort((a, b) => a[0] - b[0]);
  return found[0][1] !== 0;
}

/** A unit attached to the wrong kind of spec, e.g. "4,970 mAh of storage" or "256 GB battery". */
export function mislabelsUnits(answer) {
  // only a unit directly attached to the wrong word ("mAh of storage"), so "a 5,000 mAh battery and 128 GB of storage" is fine
  return /\bmah\s+(?:of\s+)?(?:internal\s+)?(storage|ram|memory|display|screen)\b|\b(gb|tb)\s+(?:of\s+)?battery\b|\bhz\s+(?:of\s+)?(battery|storage|camera)\b|\bmp\s+(?:of\s+)?(battery|storage|display|screen)\b/i.test(answer);
}

/**
 * Figures in the answer that do not appear in the facts ("5,000" and "5000" count as the same).
 * Small whole numbers (up to 12) are allowed: counts such as "two phones" or "3 cameras" are not claims about specs.
 */
export function ungroundedFigures(answer, facts) {
  const norm = (s) => s.replace(/(\d),(?=\d{3}\b)/g, '$1');
  const known = norm(facts);
  const text = norm(answer);
  // small whole numbers are counts ("two phones", "3 cameras") unless they carry a price or a unit ("RM0", "8 GB")
  const withUnit = new Set([...text.matchAll(/\b(?:rm|\$|usd)\s?(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s?(?:gb|tb|mp|w|mah|g|hz|mm|nits|inch|-inch|%)\b/gi)].map((m) => m[1] ?? m[2]));
  const figures = [...new Set(text.match(/\d+(?:\.\d+)?/g) ?? [])];
  const inFacts = (n) => new RegExp(`(?<![\\d.])${n.replace('.', '\\.')}(?![\\d])`).test(known);
  const grounded = figures.filter(inFacts).map(Number);
  // a difference worked out from two figures in the same sentence: "249 g against 211 g, 38 g heavier",
  // "RM5,999 vs RM5,499, RM500 more", "0.6 inches bigger"
  const derived = (n) => grounded.some((a) => grounded.some((b) => a > b && (Math.abs(a - b - n) < 0.051 || Math.abs(Math.round((a / b - 1) * 100) - n) < 0.5)));
  return figures.filter((n) => {
    if (!n.includes('.') && Number(n) <= 12 && !withUnit.has(n)) return false;
    return !inFacts(n) && !derived(Number(n));
  });
}

/**
 * True when a sentence says a device has or supports something the verified answer marks as not recorded
 * (in testing: "The Pixel 10 supports eSIM, but this feature is not recorded").
 */
export function affirmsUnknowns(sentence, facts) {
  const unknown = [...verified(facts).matchAll(/^-?\s*([A-Za-z0-9 .()-]{3,60}?)[:\s]+not (?:recorded|listed)\b/gim)]
    .map((m) => m[1].trim().toLowerCase().replace(/^.*?\b(esim|nfc|wireless charging|headphone jack|microsd|ir blaster|uwb|stereo speakers|fast charging|dual sim|wi-fi \d|ecg|spo2|gps)\b.*$/, '$1'))
    .filter((w) => w.length >= 3 && w.length <= 30);
  if (!unknown.length) return false;
  const s = sentence.toLowerCase();
  if (/\b(whether|if)\b/.test(s)) return false; // "the site doesn't say whether it has eSIM"
  return unknown.some((w) => new RegExp(`\\b(supports?|has|have|offers?|comes with|includes?|features?)\\s+(?:an?\\s+|the\\s+)?${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(s));
}

/**
 * The devices a sentence names, as indexes into `devices` ([{ names, text }]), longest names first so
 * "Redmi Note 15 Pro+" is not also read as "Redmi Note 15 Pro".
 */
function devicesNamed(sentence, devices) {
  let s = sentence.toLowerCase();
  const names = devices.flatMap((d, i) => d.names.map((n) => [n.toLowerCase(), i])).sort((a, b) => b[0].length - a[0].length);
  const found = [];
  for (const [n, i] of names) {
    for (let at = s.indexOf(n); at >= 0; at = s.indexOf(n, at + 1)) {
      if (/[a-z0-9+]/.test(s[at + n.length] ?? '') || /[a-z0-9]/.test(s[at - 1] ?? '')) continue;
      found.push([at, i]);
      s = s.slice(0, at) + ' '.repeat(n.length) + s.slice(at + n.length);
    }
  }
  return [...new Set(found.sort((a, b) => a[0] - b[0]).map(([, i]) => i))];
}
const PLURAL_BACK = /\b(they|them|their|both|these two|the two|kedua-dua|keduanya|mereka)\b|它们|它們|两款|兩款|两者|兩者|二者/i;
const POINTS_BACK = /\b(it|its|it's|this (phone|model|device|one)|ia|model ini|telefon ini)\b|它|这款|這款|该机|該機/i;

/**
 * True when a sentence says the site has no data on a device that is in the facts (the 4B model wrote "The site
 * has no data on the Redmi Note 14" while the facts were about other Redmi phones). "No data on the Pixel 10's
 * updates" is about one field and is not flagged.
 */
function deniesKnownDevice(sentence, devices) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // the name must end there: not "Redmi Note 14's battery", nor another model ("Redmi Note 14 Pro", "… 5G")
  const end = `(?![\\w'’+]|\\s+(pro|plus|ultra|max|mini|lite|fe|edge|5g|4g)\\b)`;
  return devices.some((d) => d.names.some((n) => new RegExp(`(no data|no information|no record|no details|not have (any )?data|tiada (data|maklumat))\\s+(on|about|for|tentang|mengenai)\\s+(the\\s+)?${esc(n)}${end}|${esc(n)}${end}\\s+(is not|isn['’]t)\\s+in\\s+(this|the|its)\\s+database`, 'i').test(sentence)));
}

const LEANS_BACK = /^\s*(both|these|those|they|their|them|it|its|this|that|however|but|also|still|meanwhile|in comparison|by contrast|the other|either|neither|kedua-dua|mereka|ia|namun|tetapi|walau bagaimanapun|它|它们|这两|這兩|两款|兩款|不过|不過|但)/i;

const SHOWN_COMPARATIVES = ['lighter', 'heavier', 'lightweight', 'cheaper', 'expensive', 'bigger', 'larger', 'smaller', 'brighter', 'faster', 'slower', 'sharper',
  // Malay: cheap, expensive, light, heavy, fast ("lebih murah" with both prices in the sentence)
  'murah', 'mahal', 'ringan', 'berat', 'laju', 'pantas'];

/** True when a sentence gives two or more figures in the same unit (two weights, two prices…). */
function figuresCompared(sentence) {
  const units = [...sentence.matchAll(/\b(rm)\s?\d[\d,.]*|\d[\d,.]*\s?(mah|g|w|mp|gb|hz|nits|mm|inch(?:es)?|-inch)\b/gi)].map((m) => (m[1] ?? m[2]).toLowerCase().replace(/^-/, ''));
  return units.some((u, i) => units.indexOf(u) !== i);
}

// The site measures nothing itself: tests and reviews belong to the publishers named in the facts.
const OWN_TESTS = /\b(our|my) (own )?(tests?|testing|lab|measurements?|reviews?|hands-on)\b|\bwe (have )?(tested|measured|reviewed|timed|benchmarked)\b|\b(ujian|pengujian) kami\b|\bkami (telah )?(uji|menguji)\b|我们的(测试|实测|评测)|我们(测试|实测|评测)/i;

// "heavier at 224 g than the X at 193 g": which way round the two figures must be for each comparative
const UP_WORDS = /\b(heavier|larger|bigger|higher|pricier|more expensive|faster|brighter|longer|thicker|lebih (berat|besar|tinggi|mahal|laju|pantas|panjang|tebal))\b/i;
const DOWN_WORDS = /\b(lighter|smaller|lower|cheaper|less expensive|slower|dimmer|shorter|thinner|lebih (ringan|kecil|rendah|murah|perlahan|pendek|nipis))\b/i;
const VERSUS = /\b(than|compared (?:to|with)|versus|vs\.?|berbanding(?: dengan)?|daripada)\b/i;
const FIGURE = /\b(rm)\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(mah|g|w|mp|gb|tb|hz|nits|mm|inch(?:es)?|-inch|hours?|h|%)(?![a-z])/gi;

/** True when a sentence says "heavier" (or "cheaper", "lebih ringan"…) with the two figures the wrong way round. */
export function abovesBackwards(text) {
  const word = /\b(above|over|higher than|more than|below|under|lower than|less than)\b/i.exec(text);
  if (!word) return false;
  const figures = [...text.matchAll(FIGURE)].map((m) => ({
    index: m.index,
    unit: (m[1] ?? m[4]).toLowerCase().replace(/^-/, '').replace(/^inches$/, 'inch').replace(/^hours?$/, 'h'),
    value: Number((m[2] ?? m[3]).replace(/,/g, '')),
  }));
  const before = figures.filter((f) => f.index < word.index && f.index > word.index - 70).pop();
  const after = figures.find((f) => f.index > word.index && f.index < word.index + 70);
  if (!before || !after || before.unit !== after.unit || before.value === after.value) return false;
  return /above|over|higher|more/i.test(word[1]) ? before.value < after.value : before.value > after.value;
}

export function comparesBackwards(text) {
  const up = UP_WORDS.exec(text);
  const down = DOWN_WORDS.exec(text);
  if (!up === !down) return false; // none, or both ("lighter but more expensive"): leave it
  const word = up ?? down;
  const vs = VERSUS.exec(text.slice(word.index));
  if (!vs) return false;
  const at = word.index + vs.index;
  const figures = [...text.matchAll(FIGURE)].map((m) => ({
    index: m.index,
    unit: (m[1] ?? m[4]).toLowerCase().replace(/^-/, '').replace(/^inches$/, 'inch').replace(/^hours?$/, 'h'),
    value: Number((m[2] ?? m[3]).replace(/,/g, '')),
  }));
  const before = figures.filter((f) => f.index < at && f.index > word.index - 80).pop();
  const after = figures.find((f) => f.index > at);
  if (!before || !after || before.unit !== after.unit || before.value === after.value) return false;
  return up ? before.value < after.value : before.value > after.value;
}

/** Why one sentence can't be shown, or null. `known` is the part of the facts this sentence may draw on. */
// Version 20: "both are level on battery" when the site's comparison names one of them ahead ("… has the bigger
// battery: 5,391 mAh vs 5,000 mAh"). Seen in testing with Qwen3.5 2B on a gaming comparison.
const LEVEL_WORDS = /\b(level|tied?|the same|equal(ly)?|identical|similar|on par|evenly matched|no difference|neck and neck)\b|持平|相同|一样|差不多|sama|setara/i;
const LEVEL_AREAS = [
  [/\bbatter(y|ies)\b|\bmah\b|电池|電池|bateri/i, /has the bigger battery/, /level on (battery|capacity)/i],
  [/\bcharg(e|es|ing)\b|充电|充電|mengecas|pengecasan/i, /charges faster/, /level on (charging|wired charging|wireless charging)/i],
  [/\b(screens?|displays?)\b|屏幕|螢幕|skrin|paparan/i, /has the bigger screen/, /level on (display|screen)/i],
  [/\bperform(ance|s|ing)?\b|\bfaster\b|性能|prestasi/i, /has the higher performance score/, /level on performance/i],
  [/\bcameras?\b|相机|相機|摄像|kamera/i, /has the higher-resolution main camera/, /level on camera/i],
  [/\bweigh(t|s)?\b|重量|berat/i, /\bis lighter\b/, /level on weight/i],
];
// Version 20: "the Galaxy has the higher performance score at 85 compared to the iPhone's 89": plain scores (no unit)
// compared the wrong way round. Seen in testing with Qwen3.5 4B.
const SCORE_UP = /\b(higher|better|stronger|bigger|greater|leads?|ahead|wins?|outperforms?)\b[^.!?\d]{0,45}?(?<![\d,.])(\d{1,3}(?:\.\d)?)(?![\d,]|\.\d|\s*(?:%|mah|w\b|mp|hz|nits|g\b|mm|gb|tb|h\b|hours?|min))[^.!?\d]{0,45}?\b(compared (?:to|with)|vs\.?|versus|than|against|over)\b[^.!?\d]{0,35}?(?<![\d,.])(\d{1,3}(?:\.\d)?)(?![\d,]|\.\d)/i;
const SCORE_DOWN = /\b(lower|worse|weaker|behind|trails?)\b[^.!?\d]{0,45}?(?<![\d,.])(\d{1,3}(?:\.\d)?)(?![\d,]|\.\d|\s*(?:%|mah|w\b|mp|hz|nits|g\b|mm|gb|tb|h\b|hours?|min))[^.!?\d]{0,45}?\b(compared (?:to|with)|vs\.?|versus|than|against)\b[^.!?\d]{0,35}?(?<![\d,.])(\d{1,3}(?:\.\d)?)(?![\d,]|\.\d)/i;
export function scoresBackwards(sentence) {
  const up = SCORE_UP.exec(sentence);
  if (up && Number(up[2]) < Number(up[4])) return true;
  const down = SCORE_DOWN.exec(sentence);
  return Boolean(down && Number(down[2]) > Number(down[4]));
}

// Version 20: "the site does not provide hands-on reviews or test results for this phone" when it does
const DENIES_TESTS = /\b(no|not any|without|lacks?|doesn'?t (?:have|provide|include|list)|does not (?:have|provide|include|list)|has(?:n'?t| not) (?:got|recorded))\b[^.!?]{0,50}\b(reviews?|tests?|test results|measurements?|benchmarks?|lab results)\b/i;
export function deniesTests(sentence, facts) {
  return DENIES_TESTS.test(sentence) && /REVIEWS AND TESTS \(findings|test results:|measured by|Test results side by side/i.test(facts);
}

// Version 20: a ranking must be quoted as the site gives it. In testing Qwen3.5 4B mixed ranks and totals from
// different lists ("66th out of 155", "performance at 85/172"); every "Nth of M" / "N out of M" / "N/M" pair in a
// sentence has to appear as that pair in the facts (scores out of 100 are left to the figure checks).
const RANK_PAIR = /(?<![\d,.])(\d{1,4})(?:st|nd|rd|th)?\s*(?:out of|of|\/|dari|daripada)\s*(\d{1,4})(?![\d,])/gi;
const RANK_PAIR_ZH = /(?:第\s*(\d{1,4})\s*名?[^。，]{0,6}?(?:共|在)\s*(\d{1,4}))|(?:(\d{1,4})\s*款[^。，]{0,8}?第\s*(\d{1,4}))/g;
export function mixedRanks(sentence, facts) {
  const pairs = [...sentence.matchAll(RANK_PAIR)].map((m) => [m[1], m[2]]);
  for (const m of sentence.matchAll(RANK_PAIR_ZH)) pairs.push(m[1] ? [m[1], m[2]] : [m[4], m[3]]);
  return pairs.some(([n, total]) => {
    if (total === '100' || Number(n) > Number(total)) return total !== '100'; // "81/100" is a score; "200 of 50" is not a rank
    const esc = (x) => x.replace(/\D/g, '');
    return !new RegExp(`(?<![\\d,.])${esc(n)}(?:st|nd|rd|th)?\\s*(?:out of|of|/)\\s*${esc(total)}(?![\\d,])`, 'i').test(facts);
  });
}

export function claimsLevel(sentence, facts) {
  if (!LEVEL_WORDS.test(sentence)) return false;
  return LEVEL_AREAS.some(([area, leader, level]) => area.test(sentence) && leader.test(facts) && !level.test(facts));
}

function sentenceProblem(sentence, facts, { question = '', echo = false, known = facts, ranked = null, devices = [], standings = null, previous = '' } = {}) {
  if (deniesKnownDevice(sentence, devices)) return 'said the site has no data on a device it does have';
  if (OWN_TESTS.test(sentence)) return 'presented another publisher’s tests as the site’s own';
  const figures = ungroundedFigures(sentence, echo ? `${known}\n${question}` : known);
  if (figures.length) return `mentioned ${figures.slice(0, 3).join(', ')}, which isn't in this site's data${known === facts ? '' : ' for that device'}`;
  if (negatesUnknowns(sentence, facts)) return 'didn’t make clear that some of this isn’t recorded';
  if (affirmsUnknowns(sentence, facts)) return 'said a device has something the site hasn’t recorded';
  if (contradictsStandings(sentence, facts) || (standings && contradictsStandings(sentence, facts, standings))) return 'described a strength or weak point differently from the site’s scores';
  if (mislabelsUnits(sentence)) return 'attached a figure to the wrong spec';
  if (claimsLevel(sentence, facts)) return 'called two devices level where the site’s data shows one ahead';
  if (scoresBackwards(sentence)) return 'compared two scores the wrong way round';
  if (mixedRanks(sentence, facts)) return 'quoted a ranking that isn’t in the site’s data';
  if (deniesTests(sentence, facts)) return 'said there are no tests or reviews where the site has some';
  // "takes 16 hours and 40 minutes to charge fully": a battery-life figure given as a charging time (Version 20)
  const chargeHours = /\b(charg\w*|recharg\w*)\b|充电|充電|mengecas|dicas/i.test(sentence) && /\b(full(y)?|0 ?(-|to) ?100|from empty|completely)\b|充满|充滿|penuh/i.test(sentence)
    && [...sentence.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b|小时|小時|jam)/gi)].some((m) => parseFloat(m[1]) >= 4);
  if (chargeHours) return 'attached a figure to the wrong spec';
  // Chinese counts pixels in 万 (10,000): "200 万像素" is 2 MP, so a 200 MP camera written that way is wrong
  const wan = /(\d+(?:\.\d+)?)\s*万\s*像素/.exec(sentence);
  if (wan && new RegExp(`(?<![\\d.])${wan[1].replace('.', '\\.')} MP\\b`).test(facts)) return 'attached a figure to the wrong spec';
  if (/too close to call/i.test(verified(facts)) && WINNER_WORDS.test(sentence) && !TIE_WORDS.test(sentence)) return 'picked a winner where the site calls it too close to call';
  const aboutTop = ranked?.[0]?.some((n) => sentence.toLowerCase().includes(n.toLowerCase()));
  // "heavier at 224 g than the HONOR X9d at 193 g": a comparison with both (already checked) figures in view
  // …or with one of them in the sentence before: "It weighs 201 g. This is slightly heavier than the median of 196 g."
  const pointsBack = Boolean(previous) && /^(this|that|it|which|ini|itu|ia)\b/i.test(sentence.trim()) && /\d/.test(sentence);
  if (comparesBackwards(sentence) || (pointsBack && comparesBackwards(`${previous} ${sentence}`)) || abovesBackwards(sentence)) return 'compared two figures the wrong way round';
  const compared = figuresCompared(sentence) || (pointsBack && figuresCompared(`${previous} ${sentence}`));
  const unbacked = unsupportedClaims(sentence, facts, question).filter((w) => !(aboutTop && BEST_WORDS.includes(w)) && !(compared && SHOWN_COMPARATIVES.includes(w)));
  const backedByScores = claimsBackedByStandings(sentence, unbacked, standings);
  const claims = unbacked.filter((w) => !backedByScores.includes(w));
  if (claims.length) return `called something "${claims[0]}", which the site's data doesn't say`;
  return null;
}

/**
 * The check the chat uses (Version 9). Sentences that fail a check are removed rather than throwing the whole
 * answer away; the answer is withheld when more than half would go, or when the checks on the whole answer fail
 * (a dropped "not recorded", a tie never mentioned, a ranking out of order).
 * Returns { text, removed, reason }: reason is null when `text` may be shown.
 * `echo` allows figures from the visitor's own question (for advice such as "is 5000 mAh enough?").
 */
export function checkAnswer(answer, facts, { question = '', ranked = null, echo = false, devices = [] } = {}) {
  // Facts that belong to no particular device (verdict text, comparison tables, database spread, explanations).
  // A sentence about one device may use those plus that device's own facts, not another device's figures
  // (in testing a Malay answer gave one phone two different water ratings and batteries from two other phones).
  let general = facts;
  for (const d of devices) for (const line of d.text.split('\n').map((l) => l.trim()).filter((l) => l.length > 3)) general = general.split(line).join('');
  let last = null;
  let lastNamed = [];
  const knownFor = (sentence) => {
    let named = devicesNamed(sentence, devices);
    // "they cost RM1,399 and RM1,699 respectively" / "它们分别为…": all the devices of the sentence before
    if (!named.length && lastNamed.length > 1 && PLURAL_BACK.test(sentence)) named = [...lastNamed];
    // "it is heavier at 224 g than the HONOR X9d at 193 g": "it" is still the device of the sentence before
    else if (last !== null && POINTS_BACK.test(sentence) && !named.includes(last)) named = [last, ...named];
    if (named.length) last = named[named.length - 1];
    lastNamed = named;
    return named.length ? [general, ...named.map((i) => devices[i].text)].join('\n') : facts;
  };
  // each device's strong and weak areas from its SCORES line ("… Strong areas (top 20%): Performance. Weak areas …")
  const standingsOf = devices.map((d) => {
    const line = facts.split('\n').find((l) => d.names.some((n) => l.startsWith(`${n}:`)) && /areas \((top|bottom)/.test(l));
    if (!line) return null;
    const list = (re) => (re.exec(line)?.[1] ?? '').toLowerCase().split(/,\s*/).filter(Boolean);
    const toAreas = (labels) => Object.keys(AREA_WORDS).filter((a) => labels.some((l) => l.startsWith(a)));
    const strong = toAreas(list(/Strong areas \(top 20%\): ([^.]+)\./));
    const weak = toAreas(list(/Weak areas \(bottom 25%\): ([^.]+)\./));
    // with one device, its verdict's "Strengths" and "Weaker points" count too
    if (devices.length === 1) {
      strong.push(...verdictAreas(facts, 'Strengths').filter((a) => !strong.includes(a)));
      weak.push(...verdictAreas(facts, 'Weaker points').filter((a) => !weak.includes(a)));
    }
    return { strong, weak };
  });
  // sentences and line breaks, kept in order so the answer can be put back together
  const pieces = String(answer ?? '').split(/(?<=[.!?])[ \t]+|(?<=[。！？])[ \t]*|(\n+)/).filter((x) => x !== undefined && x !== '');
  const isBreak = (x) => /^\n+$/.test(x) || !x.trim();
  const sentences = pieces.filter((x) => !isBreak(x));
  if (!sentences.length) return { text: '', removed: 0, reason: 'returned nothing' };
  let firstReason = null;
  let removed = 0;
  const seen = new Set();
  const lastSentence = sentences[sentences.length - 1];
  let previousRemoved = false;
  let previousKept = '';
  const kept = pieces.map((x) => {
    if (isBreak(x)) return x;
    // a repeated sentence (small models can loop) or one cut off by the length limit is simply dropped
    const key = x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (seen.has(key) || (x === lastSentence && sentences.length > 1 && !/[.!?。！？)"”]\s*$/.test(x))) return null;
    seen.add(key);
    // a sentence that leans on a removed one ("Both devices…", "However, it…") would no longer make sense
    if (previousRemoved && LEANS_BACK.test(x)) {
      removed += 1;
      return null;
    }
    const known = knownFor(x);
    // strengths and weak points are checked for the one device a sentence is about
    const standings = lastNamed.length === 1 ? standingsOf[lastNamed[0]] : null;
    const why = sentenceProblem(x, facts, { question, echo, ranked, devices, known, standings, previous: previousKept });
    previousRemoved = Boolean(why);
    previousKept = why ? '' : x;
    if (!why) return x;
    firstReason ??= why;
    removed += 1;
    return null;
  });
  // a heading or lead-in ("Key points:", "Perbandingan:") with no sentence of its own left under it goes too,
  // and so does a heading or fragment left at the end ("Kesimpulan", "Not recorded")
  const isHeading = (y) => y !== null && !isBreak(y) && (/:\s*$/.test(y) || (!/[.!?。！？]\s*$/.test(y) && y.trim().split(/\s+/).length <= 6));
  for (let i = kept.length - 1; i >= 0; i -= 1) {
    if (kept[i] === null || isBreak(kept[i])) continue;
    if (!isHeading(kept[i])) break;
    kept[i] = null;
  }
  const text = kept
    .map((x, i) => (isHeading(x) && !(kept.slice(i + 1).find((y) => y !== null && !isBreak(y)) && !isHeading(kept.slice(i + 1).find((y) => y !== null && !isBreak(y)))) ? null : x))
    .filter((x) => x !== null)
    .map((x) => (isBreak(x) ? '\n\n' : x))
    // Chinese sentences follow each other without a space
    .reduce((out, x) => out + (out && !/[。！？]$/.test(out) && x !== '\n\n' ? ' ' : '') + x, '')
    .replace(/ *\n\n */g, '\n\n')
    .replace(/(\n\n)+/g, '\n\n')
    .trim();
  const left = sentences.length - removed;
  if (!left || removed * 2 > sentences.length) return { text: '', removed, reason: firstReason };
  if (dropsUnknowns(text, facts)) return { text: '', removed, reason: 'didn’t make clear that some of this isn’t recorded' };
  if (ignoresTie(text, facts)) return { text: '', removed, reason: 'picked a winner where the site calls it too close to call' };
  if (misordersRanking(text, ranked)) return { text: '', removed, reason: 'put the devices in a different order from the site’s ranking' };
  return { text, removed, reason: null };
}
