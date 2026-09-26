// Rule-based query understanding. It turns natural phrasing into structured intents
// the app can act on, and is the first stage of a future AI assistant pipeline:
//   question -> intent -> evidence retrieval (evidencePack.js) -> reasoning -> cited answer.

import { store } from '../core/store.js';
import { href } from '../core/router.js';
import { fmtPrice } from '../lib/format.js';
import { selectedCurrency } from './money.js';
import { profilePhrase } from './scoring.js';
import { normalizeText, resolveDevice, search } from './search.js';

const PROFILE_WORDS = [
  [/\b(gaming|games?|gamer|fps)\b/, 'gaming'],
  [/\b(photo(graphy|s)?|camera|cameras|pictures?|zoom)\b/, 'photography'],
  [/\b(battery|endurance|lasts? longer|battery life)\b/, 'battery'],
  [/\b(students?|study(ing)?|school|university|college|value|budget|cheap|affordable|money)\b/, 'student'],
  [/\b(long ?term|longevity|updates?|years|durable)\b/, 'longterm'],
  [/\b(performance|fastest|fast|powerful|speed)\b/, 'performance'],
  [/\b(balanced|overall|all ?round(er)?)\b/, 'balanced'],
];

const CATEGORY_WORDS = [
  [/\b(earbuds?|ear ?buds?|tws|earphones?|in-ear|airpods|freebuds|galaxy buds|pixel buds|headphones?)\b/, 'earbuds'],
  [/\b(tablets?|ipads?|pads?)\b/, 'tablet'],
  [/\b(watch(es)?|smartwatch(es)?|wearables?)\b/, 'smartwatch'],
  [/\b(phones?|smartphones?|mobiles?|handsets?)\b/, 'smartphone'],
];

export function detectProfile(text) {
  const t = normalizeText(text);
  for (const [re, id] of PROFILE_WORDS) if (re.test(t)) return id;
  return null;
}

function detectCategory(text) {
  const t = normalizeText(text);
  for (const [re, id] of CATEGORY_WORDS) if (re.test(t)) return id;
  return null;
}

const CURRENCY_TOKENS = [
  [/^(rm|myr|ringgit)$/i, 'MYR'],
  [/^(s\$|sgd)$/i, 'SGD'],
  [/^(us\$|usd|\$|dollars?)$/i, 'USD'],
  [/^(€|eur|euros?)$/i, 'EUR'],
  [/^(£|gbp|pounds?)$/i, 'GBP'],
  [/^(₹|inr|rs\.?|rupees?)$/i, 'INR'],
  [/^(cn¥|¥|cny|rmb|yuan)$/i, 'CNY'],
];

function currencyFromToken(token) {
  for (const [re, code] of CURRENCY_TOKENS) if (re.test(token)) return code;
  return null;
}

/** "under RM4,000", "below $900", "< €800", "up to 4k" -> { amount, currency }. No symbol = the reader's currency. */
function detectMaxPrice(text) {
  const m = /(?:under|below|less than|cheaper than|<|max(?:imum)?|up to|within)\s*(rm|myr|s\$|sgd|us\$|usd|\$|€|eur|£|gbp|₹|inr|rs\.?|cn¥|¥|cny|rmb)?\s*([\d][\d,]*(?:\.\d+)?)\s*(k)?\s*(ringgit|myr|rm|sgd|usd|dollars?|eur|euros?|gbp|pounds?|inr|rupees?|cny|rmb|yuan)?/i.exec(text);
  if (!m) return null;
  let amount = Number(m[2].replace(/,/g, ''));
  if (m[3]) amount *= 1000;
  if (!Number.isFinite(amount) || amount < 50) return null;
  const currency = currencyFromToken(m[1] ?? '') ?? currencyFromToken(m[4] ?? '') ?? selectedCurrency();
  return { amount, currency };
}

/** Split "A vs B vs C" or "compare A and B" into device phrases. */
function splitComparison(text) {
  let t = text.trim();
  const forMatch = /\s+for\s+(.+)$/i.exec(t);
  const purpose = forMatch ? forMatch[1] : null;
  if (forMatch) t = t.slice(0, forMatch.index);
  t = t.replace(/^\s*(compare|comparison of|which is better[,:]?|should i (buy|get))\s+/i, '');
  let parts = t.split(/\s+(?:vs\.?|versus|v\.?)\s+/i);
  if (parts.length < 2) parts = t.split(/\s*,\s*|\s+(?:and|or|with)\s+/i);
  parts = parts.map((p) => p.trim()).filter((p) => p.length >= 2);
  return { parts, purpose };
}

/**
 * Parse a query into one of:
 *   { type: 'compare', devices: [ids], profile }
 *   { type: 'best', profile, category, maxPrice }
 *   { type: 'chipset-devices', chipset }
 *   { type: 'search' }
 */
export async function parseIntent(query) {
  const text = String(query ?? '').trim();
  if (!text) return { type: 'search' };
  const norm = normalizeText(text);

  const looksLikeComparison = /\s(vs\.?|versus|v)\s/i.test(` ${text} `) || /^(compare|which is better|should i (buy|get))\b/i.test(text);
  if (looksLikeComparison) {
    const { parts, purpose } = splitComparison(text);
    if (parts.length >= 2) {
      const matches = [];
      for (const part of parts.slice(0, 4)) {
        const hit = await resolveDevice(part);
        if (hit && !matches.includes(hit.id)) matches.push(hit.id);
      }
      if (matches.length >= 2) {
        return { type: 'compare', devices: matches, profile: purpose ? detectProfile(purpose) ?? 'balanced' : detectProfile(text) ?? 'balanced', phrases: parts };
      }
    }
  }

  if (/\b(best|top|recommended?|which)\b/.test(norm)) {
    const profile = detectProfile(text) ?? 'balanced';
    return { type: 'best', profile, category: detectCategory(text) ?? 'smartphone', maxPrice: detectMaxPrice(text) };
  }

  const chipsetPhrase = /^(?:phones?|devices?)\s+(?:with|using|on)\s+(.+)$/i.exec(text) ?? /^(.+?)\s+(?:phones?|devices?)$/i.exec(text);
  if (chipsetPhrase) {
    const [hit] = await search(chipsetPhrase[1], { limit: 1, types: ['chipset'] });
    if (hit && hit.score >= 60) return { type: 'chipset-devices', chipset: hit.id };
  }

  return { type: 'search' };
}

/** Where an intent leads. Plain searches go to the results page. */
export function intentHref(intent, query) {
  switch (intent.type) {
    case 'compare':
      return href(`/compare/${intent.devices.join(',')}`, { profile: intent.profile });
    case 'best':
      return href(`/devices/${intent.category}`, { rank: intent.profile, priceMax: intent.maxPrice?.amount, cur: intent.maxPrice?.currency });
    case 'chipset-devices':
      return href('/devices/smartphone', { chipset: intent.chipset });
    default:
      return href('/search', { q: query });
  }
}

/** Human-readable description of an intent, shown so users can see how the query was understood. */
export function describeIntent(intent) {
  switch (intent.type) {
    case 'compare': {
      const names = intent.devices.map((id) => store.deviceById.get(id)?.name ?? id);
      const profile = store.profileById.get(intent.profile);
      return `Comparison of ${names.join(' vs ')}${profile && profile.id !== 'balanced' ? `, weighted for ${profile.label.toLowerCase()}` : ''}`;
    }
    case 'best': {
      const profile = store.profileById.get(intent.profile);
      const cat = store.categoryById.get(intent.category)?.name.toLowerCase() ?? 'devices';
      return `Best ${cat} ${profilePhrase(profile)}${intent.maxPrice ? ` under ${fmtPrice(intent.maxPrice.amount, intent.maxPrice.currency)}` : ''}`;
    }
    case 'chipset-devices':
      return `Devices using the ${store.chipsetById.get(intent.chipset)?.name ?? intent.chipset}`;
    default:
      return null;
  }
}
