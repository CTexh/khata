// The browser side of notifications, shared by Settings (switching them on
// and off, reconnecting) and the bell (keeping this device registered and the
// app icon's badge current).

export const isIos = () =>
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac, but has a touchscreen.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

export const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true);

export const pushSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

// The key arrives base64url-encoded; the browser wants the raw bytes.
export function toBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// Someone who switched notifications off on this device meant it: nothing
// below may quietly switch them back on.
const OFF_KEY = "khata-push-off";
export function rememberPushOff(off: boolean) {
  try {
    if (off) localStorage.setItem(OFF_KEY, "1");
    else localStorage.removeItem(OFF_KEY);
  } catch {}
}
function pushTurnedOff(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) === "1";
  } catch {
    return false;
  }
}

async function saveSubscription(sub: PushSubscription): Promise<boolean> {
  const json = sub.toJSON();
  const res = await fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  }).catch(() => null);
  return Boolean(res?.ok);
}

async function publicKey(): Promise<string | null> {
  const cfg = await fetch("/api/push", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return cfg?.available && cfg.publicKey ? (cfg.publicKey as string) : null;
}

// Installs the service worker, which is what lets the app open without a
// connection - and, separately, what receives notifications. It used to be
// registered only by someone opening notification settings, so most phones
// never had one at all.
export async function installWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch {
    // A browser that refuses it (private mode, say) simply goes online-only.
  }
}

// Keeps this device registered. iOS can drop a registration without telling
// anyone - after the app is re-added to the Home Screen, or an update - and
// until now Khata only found out the next time it tried to send, and then
// stopped sending, silently. So on opening, the app checks: if this browser
// has notifications allowed but lost its subscription, it subscribes again;
// if it still has one the server no longer knows, it registers it again.
// At most every six hours unless forced, and never for a device someone
// switched off.
const CHECKED_KEY = "khata-push-checked";
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export async function ensureRegistered(force = false): Promise<"ok" | "skipped" | "failed"> {
  if (!pushSupported() || Notification.permission !== "granted" || pushTurnedOff()) return "skipped";
  if (!force) {
    try {
      const last = Number(localStorage.getItem(CHECKED_KEY) ?? 0);
      if (Date.now() - last < CHECK_EVERY_MS) return "skipped";
    } catch {}
  }
  const registration = await navigator.serviceWorker.getRegistration();
  // Never switched on in this browser: nothing to keep alive.
  if (!registration) return "skipped";

  let sub = await registration.pushManager.getSubscription();
  if (sub) {
    const known = await fetch(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (!known) return "failed";
    if (!known.thisDevice?.registered && !(await saveSubscription(sub))) return "failed";
  } else {
    const key = await publicKey();
    if (!key) return "failed";
    try {
      sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) });
    } catch {
      return "failed";
    }
    if (!(await saveSubscription(sub))) return "failed";
  }
  try {
    localStorage.setItem(CHECKED_KEY, String(Date.now()));
  } catch {}
  return "ok";
}

// Starts this device's registration afresh - for when delivery to it has
// stopped working. A new subscription gets a new address with the push
// service, which is usually what fixes it.
export async function reconnect(): Promise<boolean> {
  if (!pushSupported()) return false;
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const old = await registration.pushManager.getSubscription();
  if (old) {
    await fetch(`/api/push?endpoint=${encodeURIComponent(old.endpoint)}`, { method: "DELETE" }).catch(() => null);
    await old.unsubscribe().catch(() => false);
  }
  const key = await publicKey();
  if (!key) return false;
  const sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) });
  rememberPushOff(false);
  return saveSubscription(sub);
}

// The number on the app icon: the unread count in the bell. On an iPhone this
// works for the app on the Home Screen, from iOS 16.4.
export function setAppBadge(count: number) {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    const done = count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.();
    done?.catch(() => {});
  } catch {}
}
