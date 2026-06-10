const CACHE_PREFIX = "finanzas-conductuales-";
const CLEANUP_RELEASE = "20260610-auth-unblock";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX)).map((key) => caches.delete(key)))
      )
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then((clients) =>
        Promise.all(
          clients.map((client) => {
            const url = new URL(client.url);
            url.searchParams.set("pwa-cleanup", CLEANUP_RELEASE);
            return client.navigate(url.href);
          })
        )
      )
  );
});
