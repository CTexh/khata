// The service worker does two jobs: it receives push notifications - a phone
// can only get them through one - and it keeps the app openable without a
// connection.
//
// What is cached is the app itself: the HTML shell and the build's static
// files. Never /api/, because a stale balance shown as if it were current is
// worse than no balance at all; the pages read their own cached copy of that
// data from localStorage and show it as what it is.

const SHELL = "khata-shell-v1";
const ASSETS = "khata-assets-v1";
const KEEP = [SHELL, ASSETS];
// The pages someone can land on from the Home Screen or a notification.
const SHELL_PAGES = ["/", "/expenses", "/udhar-khata", "/subscriptions", "/trips"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // One missing page must not stop the rest being cached.
      await Promise.all(SHELL_PAGES.map((page) => cache.add(page).catch(() => {})));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

const isAsset = (url) =>
  url.pathname.startsWith("/_next/static/") ||
  url.pathname.startsWith("/icon") ||
  url.pathname.startsWith("/favicon") ||
  url.pathname === "/apple-touch-icon.png" ||
  url.pathname === "/manifest.json";

// A build's static files are served from the cache straight away, and fetched
// again in the background so the copy is fresh next time. In a production
// build the name carries a hash of the contents, so this changes nothing; in
// development the names are reused, and without the background fetch the app
// would keep serving whatever was cached first.
async function fromCache(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  const fresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone()).catch(() => {});
      return response;
    })
    .catch(() => null);
  if (hit) return hit;
  const response = await fresh;
  if (response) return response;
  throw new Error("offline");
}

// A page is always fetched fresh when there is a connection; the cached copy
// is what stands in when there is not.
async function fromNetworkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    // A redirect (to /login, say) is an answer about this moment, not a page
    // worth keeping.
    if (response.ok && !response.redirected) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch (err) {
    const hit = (await cache.match(request)) ?? (await cache.match("/"));
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Data is never served from here: the app knows how old its own copy is.
  if (url.pathname.startsWith("/api/")) return;

  if (isAsset(url)) {
    event.respondWith(fromCache(request).catch(() => fetch(request)));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(fromNetworkFirst(request));
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "Khata";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // Same tag replaces an earlier notification about the same thing rather
    // than stacking a second copy.
    tag: payload.tag || "khata",
    data: { url: payload.url || "/" },
  };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // The number on the app icon: how many notifications are unseen in the
      // bell, sent with each one. For the app on the Home Screen, iOS 16.4+.
      setBadge(payload.badge),
      // An app that is open refreshes its bell, rather than waiting to be
      // reopened before the new one is listed.
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((windows) => windows.forEach((w) => w.postMessage({ type: "khata:notification" }))),
    ])
  );
});

function setBadge(count) {
  const nav = self.navigator;
  if (typeof count !== "number" || !nav || !nav.setAppBadge) return Promise.resolve();
  return (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge()).catch(() => {});
}

// The push service can replace this device's subscription on its own - it
// expired, or was renewed. Register the new one straight away, so Khata keeps
// reaching this device instead of finding out at the next send that it
// cannot. (The app also checks this itself whenever it is opened.)
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const next = event.newSubscription || (old && (await self.registration.pushManager.subscribe(old.options)));
      if (!next) return;
      const json = next.toJSON();
      await fetch("/api/push", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
    })().catch(() => {})
  );
});

// Tapping a notification brings the app forward on the page it is about,
// rather than opening yet another window.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url === target && "focus" in client) return client.focus();
      }
      for (const client of windows) {
        if ("navigate" in client && "focus" in client) return client.navigate(target).then((c) => c && c.focus());
      }
      return self.clients.openWindow(target);
    })
  );
});
