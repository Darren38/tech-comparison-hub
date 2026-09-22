// Fresh files on every load (Version 10).
//
// Hosts such as GitHub Pages let browsers keep the site's files for about ten minutes, so a visitor could get an
// old script or data file after an update. This worker asks the server again for every file of this site
// ("no-cache": the browser must check before using its copy; unchanged files come back as a quick 304).
//
// It deliberately leaves everything else alone: the AI model files from Hugging Face and jsDelivr, fonts and the
// exchange-rate service are other origins and pass straight through, so a downloaded model is not fetched again.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  // a page request can't be copied with new options, so it is fetched again by address
  const fresh = request.mode === 'navigate' ? fetch(request.url, { cache: 'no-cache' }) : fetch(request, { cache: 'no-cache' });
  event.respondWith(fresh.catch(() => fetch(request)));
});
