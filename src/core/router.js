// Hash router: works on any static host (GitHub Pages, S3, a USB stick served by Python)
// without server-side rewrite rules. URLs look like #/device/samsung-galaxy-s26-ultra?tab=specs

export function parseLocation(hash = window.location.hash) {
  const raw = hash.replace(/^#/, '') || '/';
  // "/methodology#scoring" (an in-page anchor after a route) means the "scoring" section of that page
  const [routePart, anchor] = raw.split('#');
  const [pathPart, queryPart = ''] = routePart.split('?');
  const path = '/' + pathPart.split('/').filter(Boolean).map(decodeURIComponent).join('/');
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  if (anchor && !query.section) query.section = anchor;
  return { path, query, segments: path.split('/').filter(Boolean) };
}

/** Build an href. `query` values that are empty are dropped. */
export function href(path, query) {
  const qs = query
    ? new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()
    : '';
  return `#${path}${qs ? `?${qs}` : ''}`;
}

export function navigate(path, query, { replace = false } = {}) {
  const target = href(path, query);
  if (replace) window.history.replaceState(null, '', target);
  else window.location.hash = target.slice(1);
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Update the query string without adding a history entry or re-rendering the page. */
export function setQuery(query) {
  const { path } = parseLocation();
  window.history.replaceState(null, '', href(path, query));
}

export function matchRoute(routes, path) {
  for (const route of routes) {
    const match = route.pattern.exec(path);
    if (match) return { route, params: match.slice(1).map((v) => (v === undefined ? undefined : decodeURIComponent(v))) };
  }
  return null;
}

let refresher = null;

export function startRouter(onChange) {
  let last = null;
  const keyOf = (loc) => `${loc.path}?${new URLSearchParams(loc.query)}`;
  const handle = () => {
    const loc = parseLocation();
    const key = keyOf(loc);
    if (key === last) return;
    const samePath = last && last.split('?')[0] === loc.path;
    last = key;
    onChange(loc, { samePath });
  };
  refresher = () => {
    const loc = parseLocation();
    last = keyOf(loc);
    onChange(loc, { samePath: true }); // keep the scroll position
  };
  window.addEventListener('hashchange', handle);
  handle();
}

/** Re-render the current page in place (e.g. after the display currency changes). */
export function refreshRoute() {
  refresher?.();
}
