// The service worker exists for one reason: a phone can only receive a push
// notification through one. It deliberately does not cache or intercept
// anything else - the app is served fresh, as before.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
