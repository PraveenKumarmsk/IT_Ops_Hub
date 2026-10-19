/* IT Ops Hub — service worker.  Bump VERSION on every release so installed apps update. */
const VERSION = "v1.1.0";
const CACHE = "ithub-" + VERSION;
const SHELL = [
  "./", "index.html", "manifest.json",
  "modules/planner.html", "modules/cmdnotes.html", "modules/ops.html",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png", "icons/icon.svg"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("ithub-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => { if (e.data === "SKIP_WAITING") self.skipWaiting(); });

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never touch the Google Sheet backend: live data must always come from the network.
  if (/(^|\.)script\.google(usercontent)?\.com$/.test(url.hostname) || /(^|\.)googleusercontent\.com$/.test(url.hostname)) return;
  if (!/^https?:$/.test(url.protocol)) return;

  // Pages: network first (so a new release shows up), fall back to cache when offline.
  if (req.mode === "navigate" || (url.origin === location.origin && /\.html$/.test(url.pathname))) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match("index.html") || caches.match("./")))
    );
    return;
  }

  // Everything else (icons, fonts, CDN libraries): cache first, refresh in the background.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
