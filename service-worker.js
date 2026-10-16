
const CACHE_NAME = "tunewave-shell-v2";

const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
      .catch(error => console.error("TuneWave shell cache failed:", error))
  );

  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith("tunewave-") && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );

  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Only handle requests for this website.
  if (url.origin !== self.location.origin) return;

  // Never cache API responses or music streams.
  if (url.pathname.startsWith("/api/")) return;

  // Only cache the app shell files listed above.
  const isShellFile = SHELL_FILES.some(file => {
    const shellUrl = new URL(file, self.location.href);
    return url.pathname === shellUrl.pathname;
  });

  if (!isShellFile) return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();

          event.waitUntil(
            caches.open(CACHE_NAME).then(cache =>
              cache.put(request, copy)
            )
          );
        }

        return response;
      });
    })
  );
});
