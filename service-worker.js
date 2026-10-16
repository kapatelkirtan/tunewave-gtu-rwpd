const CACHE = 'tunewave-shell-v3';
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest', '/service-worker.js',
  '/assets/tunewave.svg', '/assets/cover-placeholder.svg',
  '/assets/icon-192.png', '/assets/icon-512.png', '/assets/apple-touch-icon.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('tunewave-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Network-first for navigation so users get the latest app, with an offline shell fallback.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put('/index.html', response.clone()));
      return response;
    }).catch(() => caches.match('/index.html')));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok && (url.pathname.endsWith('.html') || url.pathname.endsWith('.webmanifest') || url.pathname.startsWith('/assets/') || url.pathname === '/service-worker.js')) {
      const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  })));
});
