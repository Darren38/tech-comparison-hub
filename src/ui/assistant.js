// "Ask the hub" panel: a launcher button (bottom right) and a chat-style panel. Answers come from
// engine/assistant.js, which reads this site's data only. The engine module loads on first open.
//
// Version 9: optional AI answers from an on-device model (engine/ai.js, engine/ai-agent.js). The model works out
// what the visitor means, the site's own code looks it up, and the model explains the result in the visitor's
// language. Every AI answer is checked before it is shown, and what was looked up and the verified answers with
// their sources are always shown with it. No AI service is used.

import { html, mount } from '../lib/html.js';
import { parseLocation } from '../core/router.js';
import { store, deviceTitle } from '../core/store.js';
import { icon } from './components.js';

let engine = null;
let ai = null; // engine/ai.js (back-ends + checks), loaded only when a visitor asks for AI answers
let agent = null; // engine/ai-agent.js
let backend = null; // the AI back-end in use
let loading = null; // the back-end being downloaded or started
let queued = null; // a model to start once the current start has been cancelled
let builtinBroken = false; // the browser's built-in AI failed its check this visit, so it isn't offered again
let aiState = 'off'; // off | loading | on
let lastIds = [];
let open = false;
let busy = false;
const history = []; // { who: 'you' | 'hub' | 'sys', text | html }

function pageContext() {
  const { path } = parseLocation();
  const dev = /^\/device\/([\w-]+)$/.exec(path);
  if (dev && store.deviceById.has(dev[1])) return { deviceIds: [dev[1]] };
  const cmp = /^\/compare\/([\w,-]+)$/.exec(path);
  if (cmp) return { deviceIds: cmp[1].split(',').filter((id) => store.deviceById.has(id)) };
  return { deviceIds: [] };
}

function placeholder(ctx) {
  const r = ctx.deviceIds.length === 1 ? store.deviceById.get(ctx.deviceIds[0]) : null;
  if (aiState === 'on') return r ? `Ask anything about the ${deviceTitle(r)}…` : backend?.languages === 'en' ? 'Ask anything, in your own words…' : 'Ask anything, in any words or language…';
  return r ? `Ask about the ${deviceTitle(r)}…` : ctx.deviceIds.length > 1 ? 'Ask about these devices…' : 'Ask about any phone, watch or band…';
}

async function loadEngine() {
  if (!engine) engine = await import('../engine/assistant.js');
  return engine;
}

async function loadAi() {
  if (!ai) ai = await import('../engine/ai.js');
  if (!agent) agent = await import('../engine/ai-agent.js');
  return ai;
}

function renderChips(el, ctx) {
  const list = engine ? engine.suggestions({ ...ctx, lastIds }) : [];
  mount(el, html`${list.map((s) => html`<button type="button" class="ask__chip" data-ask-chip>${s}</button>`)}`);
}

function renderLog(log) {
  mount(log, html`${history.length ? '' : html`<div class="ask__intro">
      <p><strong>Ask the hub.</strong> I answer from this site's data (specifications, launch prices, tests and their sources), and say so when something isn't recorded.</p>
      <p>Try "Is it worth buying?", "Does it have NFC?", "Which is better, the Galaxy S26 or the iPhone 17?" or "What is IP68?".</p>
      <p class="ask__src">Switch on <strong>AI answers</strong> above to ask in your own words or language ("phone for my mum, long battery, below 1.5k"): a free AI model on your own device works out what you mean, looks it up in the site's data and explains it.</p>
    </div>`}${history.map((m) => html`<div class="ask__msg ask__msg--${m.who}">${m.who === 'you' ? html`<p>${m.text}</p>` : m.html}</div>`)}`);
  log.scrollTop = log.scrollHeight;
}

/** The model's plain text as paragraphs and simple lists (everything is escaped by the html template). */
function aiTextHtml(text) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return html`${blocks.map((b) => {
    const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
    const isList = lines.length > 1 && lines.slice(1).every((l) => /^([-*•]|\d+[.)])\s+/.test(l));
    if (isList || lines.every((l) => /^([-*•]|\d+[.)])\s+/.test(l))) {
      const [head, ...rest] = /^([-*•]|\d+[.)])\s+/.test(lines[0]) ? [null, ...lines] : lines;
      return html`${head ? html`<p>${head}</p>` : ''}<ul class="ask__ai-list">${rest.map((l) => html`<li>${l.replace(/^([-*•]|\d+[.)])\s+/, '')}</li>`)}</ul>`;
    }
    return html`<p>${lines.join(' ')}</p>`;
  })}`;
}

const aiLabel = () => html`<p class="ask__ai-label">${icon('spark', { size: 13 })} AI answer · ${backend?.label ?? 'on your device'}</p>`;

export function mountAssistant() {
  if (document.getElementById('ask-root')) return;
  const root = document.createElement('div');
  root.id = 'ask-root';
  document.body.append(root);
  mount(root, html`
    <button type="button" class="ask-launch" data-ask-toggle aria-expanded="false" aria-controls="ask-panel">
      ${icon('chat', { size: 20 })}<span>Ask</span>
    </button>
    <section id="ask-panel" class="ask" role="dialog" aria-modal="false" aria-labelledby="ask-title" hidden>
      <header class="ask__head">
        <div><h2 id="ask-title">Ask the hub</h2><p class="tiny muted">Answers from this site's data, with sources</p></div>
        <div class="row">
          <button type="button" class="ask__ai-switch" data-ai-switch aria-pressed="false" title="AI answers from a free model that runs on your device">
            <span class="ask__ai-knob" aria-hidden="true"></span><span>AI answers</span><span class="ask__ai-state" data-ai-state>Off</span>
          </button>
          <button type="button" class="icon-btn" data-ask-toggle aria-label="Close">${icon('close', { size: 16 })}</button>
        </div>
      </header>
      <div class="ask__log" data-ask-log aria-live="polite"></div>
      <div class="ask__chips" data-ask-chips></div>
      <form class="ask__form" data-ask-form>
        <label class="sr-only" for="ask-input">Your question</label>
        <input id="ask-input" name="q" type="text" autocomplete="off" maxlength="300" />
        <button type="submit" class="btn btn--primary btn--sm">Ask</button>
      </form>
    </section>`);
  const panel = root.querySelector('#ask-panel');
  const launch = root.querySelector('.ask-launch');
  const log = root.querySelector('[data-ask-log]');
  const chips = root.querySelector('[data-ask-chips]');
  const form = root.querySelector('[data-ask-form]');
  const input = root.querySelector('#ask-input');
  const aiSwitch = root.querySelector('[data-ai-switch]');
  const aiStateEl = root.querySelector('[data-ai-state]');

  const refreshContext = () => {
    const ctx = pageContext();
    input.placeholder = placeholder(ctx);
    renderChips(chips, ctx);
  };

  const showAiState = () => {
    aiSwitch.setAttribute('aria-pressed', String(aiState === 'on'));
    aiSwitch.classList.toggle('is-loading', aiState === 'loading');
    aiStateEl.textContent = aiState === 'on' ? 'On' : aiState === 'loading' ? 'Loading…' : 'Off';
    input.placeholder = placeholder(pageContext());
  };

  const setBusy = (on) => {
    busy = on;
    form.querySelector('button[type="submit"]').disabled = on;
    input.disabled = on;
    if (!on) input.focus();
  };

  const push = (who, markup) => {
    const entry = { who, html: markup };
    history.push(entry);
    renderLog(log);
    return entry;
  };

  // ---------------------------------------------------------------- choosing and starting an AI back-end
  const progressCard = (pct, text, { slow = false, choice = '' } = {}) => html`<div class="ask__card">
    <p><strong>Getting the AI ready…</strong></p>
    <div class="ask__progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
    <p class="tiny muted">${pct}% · ${text}</p>
    ${slow ? html`<p class="tiny">This is taking longer than expected: the connection may be slow, or the browser may have stopped saving the download.${choice === 'qwen35-4b' ? html` <button type="button" class="linkish" data-ai-start="qwen35-2b">Switch to the smaller Qwen3.5 2B</button>` : ''}</p>` : ''}
    <p class="tiny muted">You can keep asking meanwhile; answers come from the site's data until it's ready. <button type="button" class="linkish" data-ai-cancel-load>Cancel</button></p>
  </div>`;
  const onCard = () => html`<div class="ask__card ask__card--good">
    <p><strong>AI answers are on</strong> (${backend.label}). Ask in your own words${backend.languages === 'en' ? '' : ' or language'}: it works out what you mean, looks it up in the site's data and explains it. Every answer is checked against the data before it's shown, with what was looked up and the sources underneath.</p>
    ${backend.kind === 'webllm'
      ? html`<p class="tiny"><button type="button" class="linkish" data-ai-remove>Remove the model from this browser</button> <span class="muted">(frees about ${(backend.info.mb / 1000).toFixed(1)} GB; useful on a shared computer)</span></p>`
      : html`<p class="tiny muted">Your browser manages this model and answers in English. Ask in English for the best results.</p>`}
  </div>`;

  async function offerAi() {
    const lib = await loadAi();
    const support = await lib.deviceSupport();
    const gb = (key) => (lib.MODELS[key].mb / 1000).toFixed(1);
    const options = [];
    if (!builtinBroken && ['available', 'downloadable', 'downloading'].includes(support.builtin)) {
      options.push({ id: 'builtin', primary: true, label: 'Use my browser’s built-in AI', note: support.builtin === 'available' ? 'Already on this device, so it starts in seconds. English only.' : 'Your browser downloads its own model once and shares it with every site. English only.' });
    }
    if (support.webgpu.ok) {
      // Version 10: on a computer that can run it, Qwen3.5 4B is the recommended choice (in testing on 24 questions
      // no 4B answer was withheld and 9% of its sentences were removed, against 21% for 2B and 9B); 2B stays for smaller devices
      const [cached2, cached4] = await Promise.all(['qwen35-2b', 'qwen35-4b'].map((m) => new lib.WebLLMBackend(m, { f16: support.webgpu.f16 }).isDownloaded()));
      const four = support.webgpu.strong && { id: 'qwen35-4b', label: cached4 ? 'Use Qwen3.5 4B (already saved here)' : `Download Qwen3.5 4B${options.length ? '' : ', recommended'} (${gb('qwen35-4b')} GB)`, note: 'The most accurate model tested for this site: understands and answers in any language, including Malay and Chinese. Best with a separate graphics card; on built-in laptop graphics an answer can take up to a minute.' };
      const two = { id: 'qwen35-2b', label: cached2 ? 'Use Qwen3.5 2B (already saved here)' : `Download the smaller Qwen3.5 2B (${gb('qwen35-2b')} GB)`, note: four ? 'Quicker to download and to answer, but more of its sentences fail the checks and are left out.' : 'An open model (Apache 2.0) that understands and answers in any language, including Malay and Chinese.' };
      // a model already saved here comes first, so a returning visitor isn't asked to download another
      const order = four ? (cached2 && !cached4 ? [two, four] : [four, two]) : [two];
      for (const o of order) options.push({ ...o, primary: !options.length });
    }
    if (!options.length) {
      push('sys', html`<div class="ask__card ask__card--warn"><p><strong>AI answers aren't available on this device.</strong> ${support.webgpu.reason}</p><p class="tiny muted">Answers keep coming from the site's data, exactly as before.</p></div>`);
      return;
    }
    push('sys', html`<div class="ask__card" data-ai-offer>
      <p><strong>Turn on AI answers?</strong> A free AI model runs on this device. It works out what you mean, looks it up in the site's data and explains the result. Your questions are not sent to any AI service.</p>
      <div class="ask__choices">${options.map((o) => html`<div class="ask__choice"><button type="button" class="btn ${o.primary ? 'btn--primary' : 'btn--ghost'} btn--sm" data-ai-start="${o.id}">${o.label}</button><span class="tiny muted">${o.note}</span></div>`)}</div>
      <p class="tiny muted">The model can still word things loosely, so each answer is checked against the site's data first, and what was looked up and the verified answers with sources are always shown underneath.</p>
      <p class="tiny"><button type="button" class="linkish" data-ai-cancel>Not now</button></p>
    </div>`);
  }

  async function startAi(choice) {
    const lib = await loadAi();
    const support = await lib.deviceSupport();
    const next = choice === 'builtin' ? new lib.BuiltinBackend() : new lib.WebLLMBackend(choice, { f16: support.webgpu.f16 });
    aiState = 'loading';
    loading = next;
    showAiState();
    const entry = push('sys', progressCard(0, 'starting'));
    // no progress for two minutes: say so, and offer the smaller model or cancelling
    let last = { pct: -1, text: '', at: Date.now() };
    const draw = () => {
      entry.html = progressCard(last.pct < 0 ? 0 : last.pct, last.text || 'starting', { slow: Date.now() - last.at > 120000, choice });
      if (open) renderLog(log);
    };
    const watch = setInterval(draw, 15000);
    try {
      await next.load((r) => {
        const pct = Math.max(0, Math.min(100, Math.round((r.progress ?? 0) * 100)));
        if (pct !== last.pct || r.text !== last.text) last = { pct, text: r.text ?? 'loading', at: Date.now() };
        draw();
      });
      backend = next;
      aiState = 'on';
      entry.html = onCard();
    } catch (error) {
      console.error(error);
      aiState = backend ? 'on' : 'off';
      if (choice === 'builtin') builtinBroken = true;
      // offer a downloadable model when the built-in AI or the 4B model didn't work and this device can run it:
      // 4B first where it fits (Version 10), else 2B
      const alternatives = !support.webgpu.ok || choice === 'qwen35-2b' ? [] : choice === 'builtin' && support.webgpu.strong ? ['qwen35-4b', 'qwen35-2b'] : ['qwen35-2b'];
      entry.html = error?.name === 'AbortError'
        ? html`<div class="ask__card"><p>Stopped getting ${next.label} ready. Answers come from the site's data${backend ? `, with ${backend.label} as before` : ''}.</p></div>`
        : html`<div class="ask__card ask__card--warn"><p><strong>The AI couldn't start.</strong> ${error?.message ?? String(error)}</p>
        ${alternatives.length ? html`<p>${choice === 'qwen35-4b' ? 'The 4B model may be too big for this device or browser. ' : ''}${alternatives.map((m, i) => html`<button type="button" class="btn ${i ? 'btn--ghost' : 'btn--primary'} btn--sm" data-ai-start="${m}">Use ${lib.MODELS[m].label} instead (${(lib.MODELS[m].mb / 1000).toFixed(1)} GB)</button> `)}</p>` : html`<p class="tiny muted">Answers keep coming from the site's data.</p>`}</div>`;
    } finally {
      clearInterval(watch);
      loading = null;
    }
    showAiState();
    if (open) renderLog(log);
    // "Switch to the smaller model" pressed during the download
    if (queued) {
      const c = queued;
      queued = null;
      startAi(c);
    }
  }

  async function removeAi() {
    if (backend?.kind !== 'webllm') return;
    try {
      await backend.remove();
      backend = null;
      aiState = 'off';
      push('sys', html`<div class="ask__card"><p>The AI model was removed from this browser. Answers come from the site's data.</p></div>`);
    } catch (error) {
      push('sys', html`<div class="ask__card ask__card--warn"><p>The model couldn't be removed (${error?.message ?? error}). Clearing this site's data in the browser settings also removes it.</p></div>`);
    }
    showAiState();
  }

  async function setOpen(next) {
    open = next;
    panel.hidden = !open;
    launch.setAttribute('aria-expanded', String(open));
    root.classList.toggle('is-open', open);
    if (open) {
      // Every opening starts a fresh conversation: nothing from an earlier chat (or an earlier visitor) carries over.
      history.length = 0;
      lastIds = [];
      input.value = '';
      await loadEngine();
      refreshContext();
      if (aiState === 'on') history.push({ who: 'sys', html: onCard() });
      renderLog(log);
      showAiState();
      input.focus();
    } else {
      launch.focus();
    }
  }

  // ---------------------------------------------------------------- asking
  async function submit(q) {
    const question = q.trim();
    if (!question || busy) return;
    const eng = await loadEngine();
    history.push({ who: 'you', text: question });
    const entry = push('hub', html`<p class="ask__thinking">Looking it up…</p>`);
    setBusy(true);
    try {
      if (aiState === 'on' && backend) {
        await aiAnswer(question, entry);
      } else {
        let res;
        try {
          res = await eng.ask(question, { ...pageContext(), lastIds });
        } catch (error) {
          console.error(error);
          res = { html: html`<p>Sorry, something went wrong reading the data (${error.message}). Try again, or open the device page directly.</p>` };
        }
        if (res.devices?.length) lastIds = res.devices.slice(0, 4);
        entry.html = aiState === 'loading' ? html`${res.html}<p class="ask__src">The AI is still getting ready, so this answer comes straight from the site's data.</p>` : res.html;
      }
    } finally {
      if (history.length > 40) history.splice(0, history.length - 40);
      renderLog(log);
      renderChips(chips, pageContext());
      setBusy(false);
    }
  }

  const steps = (done, current, detail = '') => html`${aiLabel()}<ol class="ask__steps">${['Understanding your question', 'Looking it up in the site’s data', 'Writing the answer'].map((s, i) => html`<li class="${i < done ? 'is-done' : i === done ? 'is-now' : ''}">${s}${i === done && detail ? html` <span class="muted">${detail}</span>` : ''}</li>`)}</ol>
    ${current === 'write' ? html`<p class="tiny"><button type="button" class="linkish" data-ai-stop>Stop</button></p>` : ''}`;

  async function aiAnswer(question, entry) {
    const eng = await loadEngine();
    const ctx = { ...pageContext(), lastIds };
    // greetings and thanks need no AI
    if (eng.isSmallTalk(question)) {
      entry.html = (await eng.ask(question, ctx)).html;
      return;
    }
    entry.html = steps(0);
    renderLog(log);
    // 1. understand
    let plan = null;
    try {
      plan = await agent.understand(backend, question, ctx);
    } catch (error) {
      console.error(error);
    }
    // 2. look up (plain code; still works if the plan failed)
    entry.html = steps(1, 'look', plan ? plan.question_en : '');
    renderLog(log);
    let found;
    try {
      // as much of the site's data as this model can read at once
      found = await agent.lookUp(plan, question, { ...ctx, budget: backend.factsBudget });
    } catch (error) {
      console.error(error);
      const res = await eng.ask(question, ctx);
      entry.html = res.html;
      return;
    }
    if (found.ids.length) lastIds = found.ids.slice(0, 4);
    const lookedUp = html`<div class="ask__looked"><p class="tiny muted"><strong>What I looked up:</strong> ${found.used.length ? found.used.map((r, i) => html`${i ? ' · ' : ''}“${r.query}”`) : 'how this spec is spread across the database, and the site’s explanations'}${found.extras?.length ? html` · plus ${found.extras.join(', ')}` : ''}${found.unknown.length ? html` · not in this database: ${found.unknown.join(', ')}` : ''}</p></div>`;
    // no direct answer: the figures and explanations the AI was given, so the visitor can check it
    const siteData = found.used.length ? found.used.map((r) => r.res.html) : html`<ul class="ask__facts">${found.context.map((c) => html`<li>${c}</li>`)}</ul>`;
    const verifiedBlock = html`<details class="ask__verified" open><summary>${found.used.length ? `Verified answer${found.used.length > 1 ? 's' : ''} and sources from the site's data` : 'What the site’s data says'}</summary>${siteData}</details>
      <details class="ask__given"><summary>Show all the data the AI was given</summary><pre class="ask__facts-raw">${found.facts}</pre></details>`;
    const next = agent.followUps(plan, found);
    const nextChips = next.length ? html`<div class="ask__next">${next.map((s) => html`<button type="button" class="ask__chip" data-ask-chip>${s}</button>`)}</div>` : '';
    // 3. explain
    entry.html = steps(2, 'write');
    renderLog(log);
    const live = log.querySelector('.ask__steps .is-now');
    let text = '';
    try {
      text = await agent.explain(backend, question, plan, found, (partial) => {
        const words = partial.split(/\s+/).filter(Boolean).length;
        if (live?.isConnected) live.textContent = `Writing the answer (${words} word${words === 1 ? '' : 's'})`;
      });
    } catch (error) {
      console.error(error);
      entry.html = html`${lookedUp}${siteData}<p class="ask__src">The AI stopped with an error (${error?.message ?? error}), so this answer comes straight from the site's data.</p>`;
      return;
    }
    // 4. check before showing: sentences the checks can't confirm are removed; too many, and the answer is withheld
    const echo = ['advice', 'explain_term'].includes(plan?.intent);
    const checked = ai.checkAnswer(text, found.facts, { question, ranked: found.ranked, echo, devices: found.deviceFacts });
    const removedNote = checked.removed ? ` ${checked.removed} sentence${checked.removed > 1 ? 's' : ''} the checks couldn't confirm ${checked.removed > 1 ? 'were' : 'was'} left out.` : '';
    entry.html = checked.reason
      ? html`<p class="ask__ai-withheld">${icon('spark', { size: 13 })} The AI's answer ${checked.reason}, so it isn't shown. Here is ${found.used.length ? 'the verified answer' : 'what the site’s data says'}:</p>${lookedUp}${siteData}${nextChips}`
      : html`${aiLabel()}<div class="ask__ai-text">${aiTextHtml(checked.text)}</div>
        <p class="ask__src">Written by an AI model on your device from the site's data below, and checked against it.${removedNote} It can still word things loosely: the verified answer is what counts.</p>
        ${lookedUp}${verifiedBlock}${nextChips}`;
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-ask-toggle]')) setOpen(!open);
    if (e.target.closest('[data-ai-switch]')) {
      if (aiState === 'on') {
        aiState = 'off';
        push('sys', html`<div class="ask__card"><p>AI answers are off. Answers come straight from the site's data.</p></div>`);
        showAiState();
      } else if (aiState === 'off') {
        if (backend) {
          aiState = 'on';
          push('sys', onCard());
          showAiState();
        } else {
          offerAi();
        }
      }
    }
    const start = e.target.closest('[data-ai-start]');
    if (start && aiState === 'loading') {
      // switching models mid-download: stop this one, then start the other
      queued = start.dataset.aiStart;
      loading?.cancel?.();
    } else if (start) {
      const i = history.findIndex((m) => m.who === 'sys' && /data-ai-offer|The AI couldn/.test(String(m.html)));
      if (i >= 0) history.splice(i, 1);
      startAi(start.dataset.aiStart);
    }
    if (e.target.closest('[data-ai-cancel-load]')) loading?.cancel?.();
    if (e.target.closest('[data-ai-cancel]')) {
      const i = history.findIndex((m) => m.who === 'sys' && String(m.html).includes('data-ai-offer'));
      if (i >= 0) history.splice(i, 1);
      renderLog(log);
    }
    if (e.target.closest('[data-ai-remove]')) removeAi();
    if (e.target.closest('[data-ai-stop]')) backend?.stop();
    const chip = e.target.closest('[data-ask-chip]');
    if (chip) submit(chip.textContent);
    if (e.target.closest('.ask__log a[href^="#"]') && window.matchMedia('(max-width: 640px)').matches) setOpen(false);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) return;
    const q = input.value;
    input.value = '';
    submit(q);
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
  window.addEventListener('hashchange', () => {
    lastIds = [];
    if (open) refreshContext();
  });
  // Pages can open the panel with a question, e.g. the "Ask about this device" card.
  document.addEventListener('click', (e) => {
    const q = e.target.closest('[data-ask-question]');
    if (!q) return;
    setOpen(true).then(() => submit(q.dataset.askQuestion));
  });
}
