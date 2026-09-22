// Pages visited in this session, in order, with their titles and scroll positions. Powers the "Back to …"
// button on every page and returns you to where you were (for example the source registry on Methodology).
// Held in memory only: every new visit starts with an empty trail.

const trail = []; // { href, path, title, scrollY }

const hrefOf = (loc) => {
  const qs = new URLSearchParams(loc.query).toString();
  return `#${loc.path}${qs ? `?${qs}` : ''}`;
};

/**
 * Called before a page renders. Records the step and returns the scroll position to restore when the step is
 * a return to the previous page (the Back button or the browser's back), otherwise null.
 */
export function enterPage(loc) {
  const h = hrefOf(loc);
  const cur = trail[trail.length - 1];
  if (cur) cur.scrollY = window.scrollY;
  const prev = trail[trail.length - 2];
  if (prev && prev.href === h) {
    trail.pop();
    return prev.scrollY ?? null;
  }
  if (cur && cur.path === loc.path) {
    cur.href = h; // same page with new filters or section: not a new step
    return null;
  }
  trail.push({ href: h, path: loc.path, title: '', scrollY: 0 });
  if (trail.length > 50) trail.shift();
  return null;
}

/** Called once the page has its title. */
export function titlePage(title) {
  const cur = trail[trail.length - 1];
  if (cur) cur.title = title || 'Home';
}

/** The page visited before the current one, or null when this is the first page of the visit. */
export function previousPage() {
  const cur = trail[trail.length - 1];
  for (let i = trail.length - 2; i >= 0; i--) {
    if (!cur || trail[i].path !== cur.path) return trail[i];
  }
  return null;
}
