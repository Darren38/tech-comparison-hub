// Number, unit, date and price formatting shared by every page.

const intFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (digits === 0) return intFormat.format(Math.round(value));
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value);
}

/** 23.116 -> "23:07h" (hours:minutes, the convention battery tests use). */
export function fmtHours(hours) {
  if (hours === null || hours === undefined) return '—';
  let h = Math.floor(hours);
  let m = Math.round((hours - h) * 60);
  if (m === 60) {
    h += 1;
    m = 0;
  }
  return `${h}:${String(m).padStart(2, '0')}h`;
}

/** 43 -> "43 min", 72 -> "1:12h". */
export function fmtMinutes(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return fmtHours(minutes / 60);
}

/** Format a metric value using its definition (unit + precision). */
export function fmtMetric(def, value) {
  if (value === null || value === undefined) return '—';
  if (!def) return fmtNumber(value, 1);
  // Claimed wearable battery life is quoted in whole days ("21 days") or hours ("40 h"), not as a test time.
  if (def.format === 'life') return value >= 48 && value % 24 === 0 ? `${fmtNumber(value / 24)} days` : `${fmtNumber(value)} h`;
  switch (def.unit) {
    case 'h':
      return fmtHours(value);
    case 'min':
      return fmtMinutes(value);
    case '%':
      return `${fmtNumber(value, def.digits ?? 0)}%`;
    case 'pts':
      return fmtNumber(value, def.digits ?? 0);
    case 'x':
      return `${fmtNumber(value, 1)}×`;
    case '/100':
      return `${fmtNumber(value)}/100`;
    case 'type':
      // Sensor optical format stored as a fraction of a 1-inch type: 1 → 1″, 0.78 → 1/1.28″.
      return value >= 0.995 ? '1″' : `1/${fmtNumber(1 / value, 2)}″`;
    default: {
      const n = fmtNumber(value, def.digits ?? (Math.abs(value) < 10 ? 1 : 0));
      return def.unit ? `${n} ${def.unit}` : n;
    }
  }
}

/** ISO date with optional precision ("day" | "month" | "year"). Accepts "2026-03" and "2026". */
export function fmtDate(iso, precision) {
  if (!iso) return 'Date not recorded';
  const [y, m, d] = String(iso).split('-').map(Number);
  const p = precision || (d ? 'day' : m ? 'month' : 'year');
  if (p === 'year' || !m) return String(y);
  if (p === 'month' || !d) return `${MONTHS[m - 1]} ${y}`;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Days between an ISO date and today (or `now`). Partial dates count from their first day. */
export function daysSince(iso, now = new Date()) {
  if (!iso) return Infinity;
  const [y, m = 1, d = 1] = String(iso).split('-').map(Number);
  return Math.floor((now - new Date(y, m - 1, d)) / 86400000);
}

export function relativeDate(iso, now = new Date()) {
  const days = daysSince(iso, now);
  if (!Number.isFinite(days)) return 'Date not recorded';
  if (days < 0) return fmtDate(iso);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return fmtDate(iso);
}

/** "just now", "12 min ago", "3 h ago", "Yesterday", "4 days ago", then a date — for timestamps (ISO with time). */
export function timeAgo(iso, now = new Date()) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'Date not given';
  const minutes = Math.round((now - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 14) return `${days} days ago`;
  return fmtDate(then.toISOString().slice(0, 10));
}

/** "17 Sep 2026, 16:05" in the reader's time zone. */
export function fmtDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(d);
  const local = new Intl.DateTimeFormat('en-CA').format(d); // YYYY-MM-DD in local time
  return `${fmtDate(local)}, ${time}`;
}

// Fixed symbols, so "$" only ever means US dollars (Intl's narrow symbol prints "$" for SGD too),
// CNY is not mistaken for yen, and ringgit reads "RM6,799" the way Malaysian retailers write it.
const PRICE_SYMBOLS = { MYR: 'RM', USD: '$', EUR: '€', GBP: '£', SGD: 'S$', CNY: 'CN¥', INR: '₹', JPY: '¥', KRW: '₩', HKD: 'HK$', AUD: 'A$', CAD: 'C$' };

// One formatter per currency *and* decimal setting: caching per currency alone made $1,299.99
// render as $1,300 whenever a whole-number price in that currency was formatted first.
const priceFormats = new Map();
export function fmtPrice(amount, currency) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  const digits = Math.round(amount * 100) % 100 ? 2 : 0; // cents only when the price has them
  const key = `${currency}:${digits}`;
  if (!priceFormats.has(key)) {
    const number = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    const symbol = PRICE_SYMBOLS[currency];
    priceFormats.set(key, (v) => (symbol ? `${v < 0 ? '−' : ''}${symbol}${number.format(Math.abs(v))}` : `${currency} ${number.format(v)}`));
  }
  return priceFormats.get(key)(amount);
}

/** "1.2M views" / "12K views"; in Chinese "120万次观看". */
export function fmtViews(n) {
  if (n == null || !Number.isFinite(n)) return '';
  if (document.documentElement.lang?.startsWith('zh')) {
    if (n >= 1e8) return `${(n / 1e8).toFixed(n >= 1e9 ? 0 : 1).replace(/\.0$/, '')}亿次观看`;
    if (n >= 1e4) return `${(n / 1e4).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '')}万次观看`;
    return `${n}次观看`;
  }
  const short = n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K` : String(n);
  return `${short} ${n === 1 ? 'view' : 'views'}`;
}

export function plural(count, word, pluralWord = /(ch|sh|s|x|z)$/.test(word) ? `${word}es` : `${word}s`) {
  return `${fmtNumber(count)} ${count === 1 ? word : pluralWord}`;
}

/** Percentage difference of a relative to b, signed. */
export function pctDiff(a, b) {
  if (!b) return 0;
  return ((a - b) / Math.abs(b)) * 100;
}
