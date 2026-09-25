// Apply the saved theme and view before first paint to avoid a flash. A separate file (not inline) so the page's
// Content Security Policy can allow scripts from this site only.
try {
  var t = JSON.parse(localStorage.getItem('tch.theme.v1'));
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  document.documentElement.dataset.mode = JSON.parse(localStorage.getItem('tch.mode.v1')) === 'simple' ? 'simple' : 'detailed';
} catch (e) {}
