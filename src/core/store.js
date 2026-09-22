// Data access layer. Everything the UI reads comes through here, so moving from
// static JSON files to an API later only changes this module.

const BASE = 'generated/';
const cache = new Map();

export class DataError extends Error {
  constructor(message, { path, status } = {}) {
    super(message);
    this.name = 'DataError';
    this.path = path;
    this.status = status;
  }
}

/** Fetch a generated JSON file once; later calls reuse the same promise. */
export function getJSON(path) {
  if (!cache.has(path)) {
    // 'no-cache': the browser checks with the server every page load, so data is never out of date
    const request = fetch(BASE + path, { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new DataError(`Could not load ${path} (HTTP ${res.status})`, { path, status: res.status });
        return res.json();
      })
      .catch((err) => {
        cache.delete(path); // allow a retry after a failure
        if (err instanceof DataError) throw err;
        throw new DataError(`Could not load ${path}. ${err.message}`, { path });
      });
    cache.set(path, request);
  }
  return cache.get(path);
}

export const store = {
  ready: false,
  core: null,
  devices: [],
  chipsets: [],
  documents: [],
  deviceById: new Map(),
  chipsetById: new Map(),
  docById: new Map(),
  brandById: new Map(),
  sourceById: new Map(),
  metricById: new Map(),
  categoryById: new Map(),
  classById: new Map(),
  facetById: new Map(),
  profileById: new Map(),
  scoreCategoryById: new Map(),
};

const index = (list, key = 'id') => new Map(list.map((item) => [item[key], item]));

export async function loadCore() {
  if (store.ready) return store;
  const [core, devices, chipsets, documents] = await Promise.all([
    getJSON('core.json'),
    getJSON('index/devices.json'),
    getJSON('index/chipsets.json'),
    getJSON('index/documents.json'),
  ]);
  Object.assign(store, { core, devices, chipsets, documents });
  store.deviceById = index(devices);
  store.chipsetById = index(chipsets);
  store.docById = index(documents);
  store.brandById = index(core.brands);
  store.sourceById = index(core.sources);
  store.metricById = index(core.metrics);
  store.categoryById = index(core.categories);
  store.classById = index(core.taxonomy.evidenceClasses);
  store.facetById = index(core.taxonomy.facets);
  store.profileById = index(core.scoring.profiles);
  store.scoreCategoryById = index(core.scoring.categories);
  store.ready = true;
  return store;
}

export const loadDevice = (id) => getJSON(`devices/${encodeURIComponent(id)}.json`);
export const loadChipset = (id) => getJSON(`chipsets/${encodeURIComponent(id)}.json`);
export const loadSource = (id) => getJSON(`sources/${encodeURIComponent(id)}.json`);
export const loadSearchIndex = () => getJSON('index/search.json');
export const loadHeadToHead = () => getJSON('index/head-to-head.json');
export const loadCoverage = () => getJSON('index/coverage.json');

// ---------------------------------------------------------------- lookups
export const brandName = (id) => store.brandById.get(id)?.name ?? id;

export function sourceName(id) {
  if (id === 'platform') return 'Platform analysis';
  return store.sourceById.get(id)?.name ?? id;
}

/** "Samsung Galaxy S26 Ultra" — prefix the brand unless the model name already contains it. */
export function deviceTitle(row) {
  if (!row) return '';
  const brand = brandName(row.brand);
  return row.name.toLowerCase().startsWith(brand.toLowerCase()) ? row.name : `${brand} ${row.name}`;
}

export const metricDef = (id) => store.metricById.get(id);
export const categoryDef = (id) => store.categoryById.get(id);

/** "36 smartphones", "4 smartwatches", "1 tablet": uses the category's own plural name. */
export function categoryCount(n, categoryId) {
  const cat = store.categoryById.get(categoryId);
  if (!cat) return `${n} devices`;
  return `${n} ${(n === 1 ? cat.singular : cat.name).toLowerCase()}`;
}

/** Launch price in a given currency (lowest listed configuration). */
export function priceIn(row, currency) {
  const prices = (row?.prices ?? []).filter((p) => p.currency === currency).map((p) => p.amount);
  return prices.length ? Math.min(...prices) : null;
}

/** Scoring metric list for a score category, honouring per-device-category overrides. */
export function scoreMetricsFor(scoreCategory, deviceCategory) {
  const lists = scoreCategory.metrics;
  return lists[deviceCategory] ?? lists.default ?? [];
}
