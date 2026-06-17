const CACHE_PREFIX = "finanzas-conductuales-";
const CACHE_NAME = `${CACHE_PREFIX}20260617-home-minimal`;
const APP_SHELL = [
  "./",
  "index.html",
  "styles.css?v=20260617-home-minimal",
  "app.js?v=20260617-home-minimal",
  "finance-core.js?v=20260617-home-minimal",
  "sync-client.js?v=20260617-home-minimal",
  "sync-config.js?v=20260617-home-minimal",
  "vendor/supabase-2.108.1.min.js?v=20260617-home-minimal",
  "manifest.webmanifest?v=20260617-home-minimal",
  "assets/icon.svg",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          if (response.ok && new URL(request.url).origin === self.location.origin) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match("./").then((fallback) => fallback || caches.match("index.html")))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request)
        .then((response) => {
          const copy = response.clone();
          if (response.ok && new URL(request.url).origin === self.location.origin) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          if (request.mode === "navigate") {
            return caches.match("./").then((fallback) => fallback || caches.match("index.html"));
          }
          throw new Error("Offline asset unavailable");
        });
    })
  );
});
