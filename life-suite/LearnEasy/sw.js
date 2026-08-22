// Bump this on every release so browsers that already cached an older version
// actually notice the file changed and fetch fresh files instead of serving stale ones.
const CACHE_NAME = 'learneasy-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './db.js',
  './calc.js',
  './ui-common.js',
  './ui-progress.js',
  './ui-marks.js',
  './ui-settings.js',
  './main.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first: always try to fetch the latest version first (this app changes often
// during development), and only fall back to the cache if the network is unavailable.
// This trades a little offline-freshness for making sure updates are never masked.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
      return resp;
    }).catch(() => caches.match(event.request))
  );
});
