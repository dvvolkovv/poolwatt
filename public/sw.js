// §25 "Офлайн-режим: последний известный баланс и QR для зарядки".
//
// Deliberately small. Money screens must never answer from a cache: a stale
// balance shown as current is worse than an error. So navigations are
// network-first with one fallback — the offline screen, which says out loud
// that its figure is the last one seen and when.
//
// The locale arrives as a query parameter on the script URL, which makes one
// registration per language: /sw.js?locale=ru caches the Russian offline
// screen, /sw.js?locale=sk the Slovak one.

const LOCALE = new URL(self.location.href).searchParams.get("locale") || "en";
const SHELL = `poolwatt-shell-v1-${LOCALE}`;
const OFFLINE = `/${LOCALE}/app/offline`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) =>
        cache.addAll([OFFLINE, "/manifest.webmanifest", "/icon-192.png"]),
      )
      .catch(() => {
        // One missing asset must not leave the worker uninstalled.
      }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Build output never changes under a given URL: cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icon-")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  if (request.mode !== "navigate") return;

  event.respondWith(
    fetch(request).catch(() =>
      caches.match(OFFLINE).then((hit) => hit ?? Response.error()),
    ),
  );
});
