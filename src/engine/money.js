// Currency handling. Launch prices are stored in the currency they were announced in.
// A reader's chosen currency is shown as:
//   1. the device's own launch price in that currency, if one is recorded (a real local price), else
//   2. a conversion of another recorded price, marked "≈" and explained (an estimate).
// Conversions use dated central-bank rates from data/meta/currencies.json and are never used
// for value scoring (see docs/METHODOLOGY.md).

import { store, sourceName } from '../core/store.js';
import { currencyPref } from '../core/state.js';
import { fmtPrice, fmtDate } from '../lib/format.js';

export const currencyList = () => store.core?.currencies?.currencies ?? [];

// ------------------------------------------------------------------ live rates
// The build saves Bank Negara Malaysia's rates (serve.py start-up, or the scheduled GitHub build).
// When those are not from today, the browser asks ExchangeRate-API (free, allows browser requests)
// at page load and uses its rates if they are newer. The answer is cached for three hours.
const LIVE_RATES_URL = 'https://open.er-api.com/v6/latest/MYR';
const LIVE_CACHE_KEY = 'tch.rates.live.v1';
const LIVE_CACHE_MS = 3 * 60 * 60 * 1000;
const malaysiaDate = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(date);

function readRatesCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(LIVE_CACHE_KEY));
    return cached && Date.now() - cached.savedAt < LIVE_CACHE_MS ? cached.data : null;
  } catch {
    return null;
  }
}

function writeRatesCache(data) {
  try {
    localStorage.setItem(LIVE_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // storage unavailable (private mode): fetch again next time
  }
}

/** Returns true when newer live rates replaced the saved ones (callers then re-render). */
export async function refreshRatesLive({ timeout = 5000 } = {}) {
  const cfg = store.core?.currencies;
  if (!cfg?.currencies?.length || !cfg.asOf || cfg.live) return false;
  if (cfg.asOf >= malaysiaDate(new Date())) return false; // the saved Bank Negara Malaysia rates are today's
  let data = readRatesCache();
  if (!data) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(LIVE_RATES_URL, { signal: controller.signal });
      if (!res.ok) return false;
      data = await res.json();
    } catch {
      return false; // offline or blocked: keep the saved rates
    } finally {
      clearTimeout(timer);
    }
    if (data?.result !== 'success' || !data.rates || !data.time_last_update_unix) return false;
    writeRatesCache(data);
  }
  const liveDate = malaysiaDate(new Date(data.time_last_update_unix * 1000));
  const base = cfg.base ?? 'MYR';
  if (liveDate <= cfg.asOf || cfg.currencies.some((c) => c.code !== base && !(data.rates[c.code] > 0))) return false;
  store.core.currencies = {
    ...cfg,
    asOf: liveDate,
    session: null,
    currencies: cfg.currencies.map((c) => (c.code === base ? c : { ...c, toMYR: Math.round((1 / data.rates[c.code]) * 1e6) / 1e6 })),
    source: {
      name: 'ExchangeRate-API',
      url: 'https://www.exchangerate-api.com',
      note: `Rates by ExchangeRate-API, checked by your browser when the page loaded because the saved Bank Negara Malaysia rates (${fmtDate(cfg.asOf)}) were older.`,
    },
    live: { replacedAsOf: cfg.asOf, replacedSource: cfg.source?.name },
  };
  return true;
}

/** "Bank Negara Malaysia, 17 Sep 2026 (12:00 session)" */
export function ratesLabel() {
  const c = store.core?.currencies ?? {};
  return `${c.source?.name ?? 'Exchange rates'}, ${c.asOf ? fmtDate(c.asOf) : 'date not recorded'}${c.session ? ` (${c.session} session)` : ''}`;
}
const rateOf = (code) => currencyList().find((c) => c.code === code)?.toMYR ?? null;

export function selectedCurrency() {
  const fallback = store.core?.currencies?.default ?? 'USD';
  const chosen = currencyPref.get(fallback);
  return rateOf(chosen) ? chosen : fallback;
}

export function setCurrency(code) {
  if (rateOf(code)) currencyPref.set(code);
}

export function currencyLabel(code) {
  return currencyList().find((c) => c.code === code)?.label ?? code;
}

/** Convert between any two listed currencies through their MYR rates. */
export function convert(amount, from, to) {
  if (amount === null || amount === undefined) return null;
  if (from === to) return amount;
  const a = rateOf(from);
  const b = rateOf(to);
  return a && b ? (amount * a) / b : null;
}

function preferenceRank(code) {
  const order = store.core?.currencies?.conversionPreference ?? [];
  const i = order.indexOf(code);
  return i === -1 ? order.length : i;
}

/**
 * Price of a device (index row or compiled device) in `currency`.
 * Returns { amount, currency, local, basis } or null when no price is recorded.
 */
export function displayPrice(row, currency = selectedCurrency()) {
  const prices = row?.prices ?? [];
  if (!prices.length) return null;
  const local = prices.filter((p) => p.currency === currency);
  if (local.length) {
    const basis = local.reduce((a, b) => (a.amount <= b.amount ? a : b));
    return { amount: basis.amount, currency, local: true, basis };
  }
  const candidates = [...prices].sort((a, b) => preferenceRank(a.currency) - preferenceRank(b.currency) || a.amount - b.amount);
  for (const basis of candidates) {
    const converted = convert(basis.amount, basis.currency, currency);
    if (converted !== null) return { amount: Math.round(converted), currency, local: false, basis };
  }
  return null;
}

/** "1 USD = RM4.07" */
export function rateText(from, to) {
  const one = convert(1, from, to);
  if (one === null) return '';
  const digits = one < 1 ? 4 : 2;
  const formatted = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(one);
  return `1 ${from} = ${formatted} ${to}`;
}

export function ratesSource() {
  const c = store.core?.currencies ?? {};
  return { name: c.source?.name ?? 'exchange rates', url: c.source?.url ?? null, asOf: c.asOf ? `${fmtDate(c.asOf)}${c.session ? ` (${c.session})` : ''}` : 'date not recorded', note: c.conversionNote };
}

const AVAILABILITY_TEXT = {
  'not-launched': (c) => ({ short: `not sold in ${c.region}`, long: `Not sold in ${c.regionName}` }),
  'not-found': (c) => ({ short: `no ${c.region} launch found`, long: `No launch in ${c.regionName} found` }),
  'price-not-found': (c) => ({ short: `${c.region} price not found`, long: `Listed in ${c.regionName}, without a verified launch price` }),
};

/**
 * Why a device has no launch price in the region of `currency` (data/devices availability),
 * or null. Index rows carry the status only; full device records add note, source, url, checked.
 */
export function availabilityIn(row, currency = selectedCurrency()) {
  const cur = currencyList().find((c) => c.code === currency);
  const value = cur?.region ? row?.availability?.[cur.region] : null;
  if (!value) return null;
  const entry = typeof value === 'string' ? { status: value } : value;
  const text = AVAILABILITY_TEXT[entry.status]?.(cur);
  return text ? { ...entry, ...text, region: cur.region, regionName: cur.regionName } : null;
}

/** Plain text for a display price: "RM6,799" or "≈ RM5,292". */
export function priceText(dp) {
  if (!dp) return null;
  return `${dp.local ? '' : '≈ '}${fmtPrice(dp.amount, dp.currency)}`;
}

/** Tooltip explaining where a display price comes from. */
export function priceExplanation(dp) {
  if (!dp) return '';
  const b = dp.basis;
  // Version 17: a price read from the maker's own Malaysian store when the launch price was not reported ("listed")
  const kind = b.type === 'listed' ? `store price when checked${b.date ? ` (${fmtDate(b.date)})` : ''}` : 'launch price';
  const where = `${b.region ?? ''} ${kind}${b.config ? `, ${b.config}` : ''}`.trim();
  if (dp.local) return `${where}${b.source ? ` · ${sourceName(b.source)}` : ''}`;
  const src = ratesSource();
  return `Estimate converted from ${fmtPrice(b.amount, b.currency)} (${where}) at ${rateText(b.currency, dp.currency)}, ${src.name} rate of ${src.asOf}. Not a local price.`;
}
