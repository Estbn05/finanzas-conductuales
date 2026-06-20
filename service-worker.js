const CACHE_PREFIX = "finanzas-conductuales-";
const CACHE_NAME = `${CACHE_PREFIX}20260620-day-total-v29`;
const APP_SHELL = [
  "./",
  "index.html",
  "styles.css?v=20260620-day-total-v29",
  "app.js?v=20260620-day-total-v29",
  "finance-core.js?v=20260620-day-total-v29",
  "sync-client.js?v=20260620-day-total-v29",
  "sync-config.js?v=20260620-day-total-v29",
  "vendor/supabase-2.108.1.min.js?v=20260620-day-total-v29",
  "manifest.webmanifest?v=20260620-day-total-v29",
  "assets/icon.svg?v=20260620-day-total-v29",
  "assets/icon-192.png?v=20260620-day-total-v29",
  "assets/icon-512.png?v=20260620-day-total-v29",
  "assets/apple-touch-icon.png?v=20260620-day-total-v29"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || new URL("./#registrar-gasto", self.location.href).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const target = new URL(targetUrl, self.location.href);
      for (const client of clientList) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === target.origin && clientUrl.pathname === target.pathname) {
          return client.navigate(target.href).then((navigatedClient) => (navigatedClient || client).focus());
        }
      }
      return self.clients.openWindow(target.href);
    })
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
