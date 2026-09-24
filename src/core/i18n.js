// Interface language (Version 15): English or Simplified Chinese.
//
// The English text is the key: t('Compare') returns '对比' in Chinese and 'Compare' otherwise, so a string with no
// translation yet still reads correctly in English. Data labels carry their own Chinese beside the English
// (metrics.json "name_zh", scoring.json "label_zh", brands "name_zh"…), read with L(object, 'name').
// What sources wrote (review findings, headlines, notes, method texts) stays in the language it was written in.

import ZH from '../i18n/zh.js';

const KEY = 'tch-lang';
const SUPPORTED = ['en', 'zh'];

function initial() {
  try {
    const saved = localStorage.getItem(KEY);
    if (SUPPORTED.includes(saved)) return saved;
  } catch { /* storage unavailable: fall back to the browser language */ }
  return /^zh\b/i.test(navigator.language ?? '') ? 'zh' : 'en';
}

let current = initial();
document.documentElement.lang = current === 'zh' ? 'zh-Hans' : 'en';

export const lang = () => current;
export const isZh = () => current === 'zh';

export function setLang(value) {
  if (!SUPPORTED.includes(value)) return;
  current = value;
  document.documentElement.lang = value === 'zh' ? 'zh-Hans' : 'en';
  try {
    localStorage.setItem(KEY, value);
  } catch { /* the choice lasts for this visit only */ }
}

/** Translate interface text. `vars` fills {name} placeholders after translating: t('{n} devices', { n: 5 }). */
export function t(text, vars) {
  let s = current === 'zh' ? (ZH[text] ?? (vars ? text : lookup(text) ?? text)) : text;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return s;
}

// ------------------------------------------------------------------ page translation
// Pages are written in English. In Chinese, every text node, placeholder, label and tooltip whose whole text is a
// known interface phrase is swapped for its translation once it is drawn (a MutationObserver catches later redraws).
// Text with no entry, such as device names, headlines, review findings and source notes, is left as written.
const ATTRS = ['placeholder', 'aria-label', 'title'];
const squash = (s) => s.replace(/\s+/g, ' ').trim();

function lookup(text) {
  const key = squash(text);
  if (!key || !/[A-Za-z]/.test(key)) return null;
  if (ZH[key]) return ZH[key];
  for (const [re, rep] of ZH.__patterns ?? []) {
    if (re.test(key)) return key.replace(re, rep);
  }
  return null;
}

function translateText(node) {
  const zh = lookup(node.nodeValue);
  if (zh) node.nodeValue = node.nodeValue.replace(/\S[\s\S]*\S|\S/, zh);
}

export function translateDom(root) {
  if (current !== 'zh' || !root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    if (!root.parentElement?.closest('[data-no-i18n],script,style')) translateText(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE || root.closest?.('[data-no-i18n]')) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('[data-no-i18n],script,style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) translateText(n);
  const els = [root, ...root.querySelectorAll('[placeholder],[aria-label],[title]')];
  for (const el of els) {
    for (const a of ATTRS) {
      const v = el.getAttribute?.(a);
      const zh = v && lookup(v);
      if (zh) el.setAttribute(a, zh);
    }
  }
}

let observer = null;
export function startTranslation() {
  if (current !== 'zh' || observer) return;
  translateDom(document.body);
  observer = new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) translateDom(n);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/** A data object's label in the current language: L(metric, 'name') reads name_zh in Chinese, else name. */
export function L(obj, field = 'name') {
  if (!obj) return '';
  return (current === 'zh' && obj[`${field}_zh`]) || obj[field] || '';
}
