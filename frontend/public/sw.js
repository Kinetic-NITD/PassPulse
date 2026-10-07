/* PassPulse service worker — minimal offline shell + asset cache. */

const CACHE = "passpulse-v1";
const SHELL = ["/", "/login", "/scanner", "/admin", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => { }))
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
            )
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // Never cache or intercept API calls — always go to network
    if (url.pathname.startsWith("/api/")) return;

    // Never touch cross-origin requests (backend is on a different domain)
    if (url.origin !== self.location.origin) return;

    // Navigation requests: network-first, fall back to cached shell
    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request).catch(() => caches.match("/").then((r) => r || Response.error()))
        );
        return;
    }

    // Static assets: cache-first, fill cache in background
    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;
            return fetch(request).then((response) => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => { });
                }
                return response;
            });
        })
    );
});