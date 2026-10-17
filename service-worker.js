const CACHE_NAME = 'tunewave-shell-v54';
const APP_SHELL = [
  './', './index.html', './style.css', './app.js', './config.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('tunewave-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never cache API queries or music streams; they must stay live and online.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // Configuration contains public service URLs that may change after a provider is deployed.
  // Use network-first so changing config.js does not leave installed PWAs on a stale bridge URL.
  if (url.pathname.endsWith('/config.js') || url.pathname.endsWith('/app.js') || url.pathname.endsWith('/style.css')) {
    // Keep configuration and executable UI assets network-first so a PWA cannot
    // keep running a broken old search script after a new deployment.
    event.respondWith(fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (url.pathname.endsWith('/app.js')) return caches.match('./app.js');
      if (url.pathname.endsWith('/style.css')) return caches.match('./style.css');
      return undefined;
    }));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy)); return response;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok && url.origin === self.location.origin) { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(request, copy)); }
    return response;
  })));
});
