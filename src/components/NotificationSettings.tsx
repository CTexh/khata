"use client";

import { useCallback, useEffect, useState } from "react";
import { Sheet } from "@/components/Sheet";

// Everything about reminders in one place: whether this device gets them, and
// which ones you want.
//
// The device half is per-device by nature - the permission, the subscription
// and the service worker all belong to the browser this is running in, not to
// the account - so each phone or computer is switched on separately. Which
// kinds you want is per-account, and follows you everywhere.
//
// On an iPhone this only works from the app on the Home Screen: Apple does not
// offer notifications to a page in a Safari tab. That case is explained rather
// than shown as a switch that cannot work.

type DeviceState =
  | "loading"
  | "unsupported" // no service worker or push in this browser
  | "needs-install" // an iPhone in Safari, not on the Home Screen
  | "unavailable" // this account can't use them yet
  | "blocked" // permission denied in the browser's settings
  | "off"
  | "on";

type Prefs = {
  subscriptions: boolean;
  udhar: boolean;
  dailyRecap: boolean;
  monthlySummary: boolean;
};

const ALL_ON: Prefs = { subscriptions: true, udhar: true, dailyRecap: true, monthlySummary: true };

// In the order they reach you during a day.
const KINDS: { key: keyof Prefs; title: string; hint: string }[] = [
  { key: "subscriptions", title: "Subscriptions due", hint: "6pm the day before, and again on the day if it's still unpaid." },
  { key: "udhar", title: "Udhar follow-ups", hint: "6pm on the date you set for someone who owes you." },
  { key: "dailyRecap", title: "Daily recap", hint: "4:30am, covering the day just gone - skipped when nothing happened." },
  { key: "monthlySummary", title: "Monthly summary", hint: "On the 1st, what last month came to." },
];

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

function Switch({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 min-h-11 cursor-pointer">
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold">{label}</span>
        {hint && (
          <span className="block text-[12.5px] mt-0.5" style={{ color: "var(--muted)" }}>
            {hint}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        className="h-6 w-6 mt-0.5 shrink-0 accent-[var(--accent)] cursor-pointer"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

export function NotificationSettings({ onBack }: { onBack: () => void }) {
  const [device, setDevice] = useState<DeviceState>("loading");
  const [publicKey, setPublicKey] = useState("");
  const [prefs, setPrefs] = useState<Prefs>(ALL_ON);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const profile = await fetch("/api/profile", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (profile?.prefs) setPrefs({ ...ALL_ON, ...profile.prefs });

    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      // An iPhone in a Safari tab has no PushManager at all; on the Home
      // Screen it does. Say which it is.
      setDevice(isIos() && !isStandalone() ? "needs-install" : "unsupported");
      return;
    }
    const data = await fetch("/api/push", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (!data?.available) {
      setDevice("unavailable");
      return;
    }
    setPublicKey(data.publicKey ?? "");
    if (Notification.permission === "denied") {
      setDevice("blocked");
      return;
    }
    const registration = await navigator.serviceWorker.getRegistration();
    const existing = await registration?.pushManager.getSubscription();
    setDevice(existing && data.devices > 0 ? "on" : "off");
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
        setDevice(permission === "denied" ? "blocked" : "off");
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
      setDevice("on");
      setNote("This device will get reminders, even with the app closed.");
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
      setDevice("off");
    } finally {
      setBusy(false);
    }
  };

  // Each kind saves as it is switched, so there is nothing to submit.
  const setKind = async (key: keyof Prefs, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefs: { [key]: value } }),
    }).catch(() => null);
    if (!res?.ok) {
      setPrefs(prefs);
      setNote("Couldn't save that. Check your connection and try again.");
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
          : "No device is registered yet - turn this device on first."
      );
    } catch {
      setNote("Couldn't send that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // One of every reminder, spaced out, so they can be seen on the lock screen
  // the way they will actually arrive.
  const preview = async () => {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const data = await res.json().catch(() => ({}));
      const seconds = Math.round(((data.startsInMs ?? 0) + (data.samples - 1) * (data.everyMs ?? 0)) / 1000);
      setNote(
        data.samples
          ? `Lock your phone now - ${data.samples} samples arrive over the next ${seconds} seconds, one at a time.`
          : "Couldn't send those. Try again."
      );
    } catch {
      setNote("Couldn't send those. Try again.");
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
    off: "Reminders arrive on this device's lock screen, even when the app is closed.",
    on: "This device is registered. Reminders arrive even when the app is closed.",
  }[device];

  const switchable = device === "on" || device === "off";

  return (
    <Sheet title="Notifications" onClose={onBack}>
      <div className="card p-4 flex flex-col gap-3">
        <div>
          <p className="text-[15px] font-bold">This device</p>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--muted)" }}>
            {hint}
          </p>
        </div>

        {switchable && (
          <Switch
            label="Notify this device"
            checked={device === "on"}
            disabled={busy}
            onChange={(v) => (v ? enable() : disable())}
          />
        )}

        {device === "on" && (
          <>
            <button type="button" className="btn btn-ghost" onClick={test} disabled={busy}>
              {busy ? "Sending…" : "Send a test notification"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={preview} disabled={busy}>
              Preview every reminder
            </button>
            <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>
              Sends one of each - a subscription due tomorrow and one due today, an Udhar follow-up, a daily recap and a
              monthly summary - a few seconds apart, so you can lock the phone and see them arrive.
            </p>
          </>
        )}

        {note && (
          <p className="text-[12.5px]" style={{ color: "var(--muted)" }} role="status">
            {note}
          </p>
        )}
      </div>

      <div className="card p-4 flex flex-col gap-3">
        <div>
          <p className="text-[15px] font-bold">What to send</p>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--muted)" }}>
            Saved as you switch them, and used on every device you register.
          </p>
        </div>
        {KINDS.map((kind) => (
          <Switch
            key={kind.key}
            label={kind.title}
            hint={kind.hint}
            checked={prefs[kind.key]}
            onChange={(v) => setKind(kind.key, v)}
          />
        ))}
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-primary" onClick={onBack}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
