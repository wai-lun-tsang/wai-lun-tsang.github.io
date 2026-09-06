// Bump this on every release so the service worker script's bytes change —
// browsers only check for SW updates by diffing this file, so an unchanged
// sw.js (even if app.js/index.html changed) means updates are silently ignored.
const SW_VERSION = "v2";
const CACHE_NAME = `ginkgobooks-shell-${SW_VERSION}`;
const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for this origin's shell files: while you're actively developing,
// "always try to get the latest version, fall back to cache only if offline" is far
// safer than cache-first, which can silently strand you on an old build indefinitely.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isShellFile = url.origin === self.location.origin;

  if (isShellFile) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  }
});
