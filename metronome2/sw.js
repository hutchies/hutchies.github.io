/*
 * Service worker: makes the metronome installable and fully usable offline.
 * Built by the `service-worker` plugin in vite.config.ts, which fills in the
 * file list and version below.
 *
 * - App files (hashed, so they never change) are precached and served from
 *   the cache.
 * - Page loads go to the network first so updates arrive promptly, falling
 *   back to the cached page when offline.
 * - Other origins (e.g. the group-sync server) are never touched.
 */
const VERSION = 'dd71ea08422d';
const PRECACHE = ["./","./apple-touch-icon.png","./assets/group.svelte-y_fzEyKe.js","./assets/index-Dpt7zW7v.js","./assets/index-gPa6jfmt.css","./assets/qrcode-DtWdxa9d.js","./assets/worklet-BgozDDDD.js","./favicon.png","./icon-192.png","./icon-512.png","./icon-maskable-512.png","./manifest.webmanifest"];
const CACHE = `metronome-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('metronome-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./', copy));
          }
          return res;
        })
        .catch(() => caches.match('./').then((r) => r || Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
