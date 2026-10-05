/* FitCoach service worker: shows push notifications (even when the app is closed), handles taps and
   call actions, and keeps the app shell available offline. Registered from src/index.js as /sw.js?api=<API URL>. */
const API_BASE = new URL(self.location.href).searchParams.get("api") || "";
const SHELL_CACHE = "fitcoach-shell-v2";
const ASSET_CACHE = "fitcoach-assets-v2";

// Install: keep a copy of the app shell and its main scripts/styles so FitCoach opens with no connection.
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      const shell = await caches.open(SHELL_CACHE);
      await shell.addAll(["/index.html", "/manifest.json", "/icons/icon-192.png"]);
      const manifest = await (await fetch("/asset-manifest.json", { cache: "no-store" })).json();
      const assets = await caches.open(ASSET_CACHE);
      await assets.addAll((manifest.entrypoints || []).map((p) => `/${p.replace(/^\//, "")}`));
    } catch { /* first visit offline or dev server — runtime caching below still applies */ }
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (![SHELL_CACHE, ASSET_CACHE].includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Page loads: network first, falling back to the last good copy of the app shell when offline.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(SHELL_CACHE)).put("/index.html", res.clone());
        return res;
      } catch {
        return (await caches.match("/index.html")) || Response.error();
      }
    })());
    return;
  }
  // Built scripts, styles, fonts and icons have content-hashed names: serve from cache, fetch once.
  if (url.origin === self.location.origin && (url.pathname.startsWith("/static/") || url.pathname.startsWith("/icons/"))) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(ASSET_CACHE)).put(req, res.clone());
      return res;
    })());
    return;
  }
  // Google Fonts: stale-while-revalidate so text looks right offline.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => { if (res.ok || res.type === "opaque") cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })());
  }
});

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data && event.data.text() }; }
  const isCall = d.kind === "call";
  event.waitUntil(self.registration.showNotification(d.title || "FitCoach", {
    body: d.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: d.tag || undefined,
    renotify: Boolean(d.tag),
    requireInteraction: Boolean(d.requireInteraction),
    vibrate: isCall ? [400, 200, 400, 200, 400, 200, 400] : [120],
    actions: Array.isArray(d.actions) ? d.actions.slice(0, 2) : [],
    timestamp: Date.now(),
    data: { url: d.url || "/", decline: d.decline_url || null },
  }));
});

self.addEventListener("notificationclick", (event) => {
  const { url, decline } = event.notification.data || {};
  event.notification.close();
  if (event.action === "decline" && decline) {
    event.waitUntil(fetch(`${API_BASE}${decline}`, { method: "POST" }).catch(() => {}));
    return;
  }
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const win of wins) {
      if (new URL(win.url).origin === self.location.origin) {
        win.postMessage({ type: "navigate", url });   // let the open app route without reloading
        return win.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
