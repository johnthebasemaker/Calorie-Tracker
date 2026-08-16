/* Service worker: cache the app shell so the tracker opens offline.
   Bump CACHE when you change any shell file. */
const CACHE = 'macros-v1';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './foods.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  /* Never cache Open Food Facts lookups — they should be live or fail fast. */
  if (new URL(req.url).origin !== self.location.origin) return;

  /* Stale-while-revalidate: instant offline start, and an edited file is
     picked up on the next launch instead of being cached forever. */
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit || caches.match('./index.html'));
      return hit || net;
    })
  );
});
