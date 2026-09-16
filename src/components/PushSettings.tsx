"use client";

import { useCallback, useEffect, useState } from "react";

// Notifications on the phone itself, through the browser's push service. The
// switch lives here because everything it touches is per-device: the
// permission, the subscription and the service worker all belong to the
// browser this is running in, not to the account.
//
// On an iPhone this only works from the app on the Home Screen - Apple does
// not offer push to a page in a Safari tab - so that case is explained rather
// than shown as a switch that cannot work.

type State =
  | "loading"
  | "unsupported" // no service worker or push in this browser
  | "needs-install" // an iPhone in Safari, not on the Home Screen
  | "unavailable" // the server has no keys configured
  | "blocked" // permission denied in the browser's settings
  | "off"
  | "on";

const isIos = () =>
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac, but has a touchscreen.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true);

// The key arrives base64url-encoded; the browser wants the raw bytes.
function toBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function PushSettings() {
  const [state, setState] = useState<State>("loading");
  const [publicKey, setPublicKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      // An iPhone in a Safari tab has no PushManager at all; on the Home
      // Screen it does. Say which it is.
      setState(isIos() && !isStandalone() ? "needs-install" : "unsupported");
      return;
    }
    const res = await fetch("/api/push", { cache: "no-store" }).catch(() => null);
    const data = res && res.ok ? await res.json().catch(() => null) : null;
    if (!data?.available) {
      setState("unavailable");
      return;
    }
    setPublicKey(data.publicKey ?? "");
    if (Notification.permission === "denied") {
      setState("blocked");
      return;
    }
    const registration = await navigator.serviceWorker.getRegistration();
    const existing = await registration?.pushManager.getSubscription();
    setState(existing && data.devices > 0 ? "on" : "off");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const enable = async () => {
    setBusy(true);
    setNote("");
    try {
      // The permission prompt must come from a tap, which is why this runs
      // here rather than on load.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: toBytes(publicKey),
        }));
      const json = subscription.toJSON();
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      if (!res.ok) throw new Error("save failed");
      setState("on");
      setNote("This device will get reminders.");
    } catch {
      setNote("Couldn't turn notifications on. Try again, or check this site's settings in your browser.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setNote("");
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch(`/api/push?endpoint=${encodeURIComponent(subscription.endpoint)}`, { method: "DELETE" });
        await subscription.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setNote(
        data.delivered
          ? `Sent to ${data.delivered} ${data.delivered === 1 ? "device" : "devices"}. It should appear in a moment.`
          : "No device is registered yet - turn notifications on first."
      );
    } catch {
      setNote("Couldn't send that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const hint = {
    loading: "Checking this device…",
    unsupported: "This browser can't show notifications.",
    "needs-install": "On iPhone, add Khata to your Home Screen first (Share → Add to Home Screen), then open it from there.",
    unavailable: "Notifications aren't switched on for this app yet.",
    blocked: "Notifications are blocked for this site. Allow them in your browser's settings for Khata, then come back.",
    off: "Reminders on this device's lock screen, as well as by email.",
    on: "This device is registered. Reminders will appear here.",
  }[state];

  const switchable = state === "on" || state === "off";

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div>
        <p className="text-[15px] font-bold">Push notifications</p>
        <p className="text-[13px] mt-0.5" style={{ color: "var(--muted)" }}>
          {hint}
        </p>
      </div>

      {switchable && (
        <label className="flex items-center justify-between gap-3 min-h-11 cursor-pointer">
          <span className="text-[15px] font-semibold">Notify this device</span>
          <input
            type="checkbox"
            className="h-6 w-6 accent-[var(--accent)] cursor-pointer"
            checked={state === "on"}
            disabled={busy}
            onChange={(e) => (e.target.checked ? enable() : disable())}
          />
        </label>
      )}

      {state === "on" && (
        <button type="button" className="btn btn-ghost" onClick={test} disabled={busy}>
          {busy ? "Sending…" : "Send a test notification"}
        </button>
      )}

      {note && (
        <p className="text-[12.5px]" style={{ color: "var(--muted)" }} role="status">
          {note}
        </p>
      )}
    </div>
  );
}
