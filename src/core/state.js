// Small client-side state: the compare tray (in memory, so each page load starts empty) and the theme and
// currency preferences (localStorage when available; the site works without it).

const COMPARE_KEY = 'tch.compare.v1';
const THEME_KEY = 'tch.theme.v1';
const CURRENCY_KEY = 'tch.currency.v1';
export const MAX_COMPARE = 4;

function read(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or storage blocked: keep the in-memory value only */
  }
}

// Every page load starts clean (Version 10): the compare picks live in memory only, so a refresh or a new visit
// begins with an empty comparison. Picks kept by earlier versions (localStorage in V1–V6, sessionStorage in
// V7–V9) are removed. Theme and currency are display preferences and stay in localStorage.
for (const storage of ['localStorage', 'sessionStorage']) {
  try {
    window[storage].removeItem(COMPARE_KEY);
  } catch {
    /* storage blocked */
  }
}

const listeners = new Set();
let compare = [];

function emit() {
  listeners.forEach((fn) => fn(compare));
}

export const compareTray = {
  get ids() {
    return [...compare];
  },
  has: (id) => compare.includes(id),
  /** Returns false when the tray is full. */
  add(id) {
    if (compare.includes(id)) return true;
    if (compare.length >= MAX_COMPARE) return false;
    compare = [...compare, id];
    emit();
    return true;
  },
  remove(id) {
    compare = compare.filter((x) => x !== id);
    emit();
  },
  toggle(id) {
    return compareTray.has(id) ? (compareTray.remove(id), true) : compareTray.add(id);
  },
  set(ids) {
    compare = [...new Set(ids)].slice(0, MAX_COMPARE);
    emit();
  },
  clear() {
    compare = [];
    emit();
  },
  /** Drop ids that no longer exist in the dataset. */
  prune(valid) {
    const next = compare.filter((id) => valid.has(id));
    if (next.length !== compare.length) {
      compare = next;
      emit();
    }
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/** Display currency chosen by the reader; the site default comes from data/meta/currencies.json. */
export const currencyPref = {
  get(fallback) {
    const value = read(CURRENCY_KEY, null);
    return typeof value === 'string' ? value : fallback;
  },
  set(code) {
    write(CURRENCY_KEY, code);
  },
};

export const theme = {
  get() {
    return read(THEME_KEY, 'system');
  },
  set(value) {
    write(THEME_KEY, value);
    theme.apply(value);
  },
  apply(value = theme.get()) {
    const root = document.documentElement;
    if (value === 'light' || value === 'dark') root.dataset.theme = value;
    else delete root.dataset.theme;
  },
  /** The theme actually shown right now. */
  effective() {
    const value = theme.get();
    if (value === 'light' || value === 'dark') return value;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  },
};
