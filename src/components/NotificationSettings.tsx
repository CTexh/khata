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
  importedExpenses: boolean;
};

const ALL_ON: Prefs = {
  subscriptions: true,
  udhar: true,
  dailyRecap: true,
  monthlySummary: true,
  importedExpenses: true,
};

// In the order they reach you during a day.
const KINDS: { key: keyof Prefs; title: string; hint: string }[] = [
  { key: "subscriptions", title: "Subscriptions due", hint: "The evening before, and on the day if unpaid." },
  { key: "udhar", title: "Udhar follow-ups", hint: "On the follow-up date you set." },
  { key: "dailyRecap", title: "Daily recap", hint: "4:30am, on days with activity." },
  { key: "monthlySummary", title: "Monthly summary", hint: "On the 1st, for the month just gone." },
  { key: "importedExpenses", title: "New expenses from your bank", hint: "When one is added from a bank alert." },
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
      // One notification straight away, so switching it on proves itself
      // rather than leaving you to wonder until 6pm.
      await fetch("/api/push/test", { method: "POST" }).catch(() => null);
      setNote("Sent one now - that is how reminders will look.");
    } catch {
      setNote("Couldn't turn them on. Try again, or check this site's settings.");
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
      setNote("Couldn't save that. Try again.");
    }
  };

  const hint = {
    loading: "Checking…",
    unsupported: "This browser can't show notifications.",
    "needs-install": "Add Khata to your Home Screen first, then open it from there.",
    unavailable: "Not available on this account yet.",
    blocked: "Blocked in your browser settings. Allow Khata, then come back.",
    off: "Reminders arrive on the lock screen, even with the app closed.",
    on: "Registered. Reminders arrive even with the app closed.",
  }[device];

  const switchable = device === "on" || device === "off";
  // The switch is in place from the first frame, disabled until we know what
  // to show. Revealing it a moment later would change the panel's height just
  // as it finishes opening.
  const showSwitch = switchable || device === "loading";

  return (
    <Sheet title="Notifications" onClose={onBack}>
      <div className="card p-4 flex flex-col gap-3">
        <div>
          <p className="text-[15px] font-bold">This device</p>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--muted)" }}>
            {hint}
          </p>
        </div>

        {showSwitch && (
          <Switch
            label="Notify this device"
            checked={device === "on"}
            disabled={busy || !switchable}
            onChange={(v) => (v ? enable() : disable())}
          />
        )}

        {note && (
          <p className="text-[12.5px]" style={{ color: "var(--muted)" }} role="status">
            {note}
          </p>
        )}
      </div>

      <div className="card p-4 flex flex-col gap-3">
        <p className="text-[15px] font-bold">What to send</p>
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
