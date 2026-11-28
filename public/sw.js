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
//
// Registered on the /<locale>/app screens (and by the Android shell, which
// opens /app), but its scope is the site root — so this worker answers for
// the landing page and the cabinet too. That is what made the bug of
// 2026-11-28 so bad: the owner could not open the main page at all.
//
// What went wrong, and the three rules that came out of it:
//
//   1. **Only a successful answer may be cached.** The old worker stored
//      whatever came back, including the 404 and 503 a browser collects in
//      the seconds while the site is being rebuilt. Build files are read
//      cache-first and never revalidated, so that 404 stayed in the cache
//      for good and the phone got an empty answer instead of the page code,
//      reload after reload.
//   2. **A cached answer that is not OK is not an answer.** Caches poisoned
//      before this fix must heal themselves, not wait for the person to find
//      the "clear site data" button.
//   3. **The cache name carries a version.** Bumping it drops everything the
//      previous worker stored — including the poison — on activate.

const LOCALE = new URL(self.location.href).searchParams.get("locale") || "en";
const SHELL = `poolwatt-shell-v2-${LOCALE}`;
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

/** Ответ, который можно отдать странице и положить в кэш. */
function usable(response) {
  return Boolean(response) && response.ok && response.type !== "opaque";
}

function fetchAndStore(request) {
  return fetch(request).then((response) => {
    if (usable(response)) {
      const copy = response.clone();
      caches.open(SHELL).then((cache) => cache.put(request, copy));
    }
    return response;
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Build output never changes under a given URL: cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icon-")) {
    event.respondWith(
      caches
        .match(request)
        .catch(() => undefined)
        .then((hit) => (usable(hit) ? hit : fetchAndStore(request))),
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
