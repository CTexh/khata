"use client";

import { useCallback, useEffect, useState } from "react";
import { Sheet } from "@/components/Sheet";
import { Switch } from "@/components/Switch";
import { fmtAgo } from "@/lib/format";
import {
  ensureRegistered,
  isIos,
  isStandalone,
  pushSupported,
  reconnect,
  rememberPushOff,
  toBytes,
} from "@/lib/push-client";

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
  missedExpenses: boolean;
  monthlySummary: boolean;
  importedExpenses: boolean;
};

const ALL_ON: Prefs = {
  subscriptions: true,
  udhar: true,
  missedExpenses: true,
  monthlySummary: true,
  importedExpenses: true,
};

// In the order they reach you during a day.
const KINDS: { key: keyof Prefs; title: string; hint: string }[] = [
  { key: "missedExpenses", title: "Missed-expense reminder", hint: "4am, to add anything you forgot yesterday." },
  {
    key: "importedExpenses",
    title: "New expenses from your bank",
    hint: "When one is added from a bank alert, and when one needs a category.",
  },
  { key: "subscriptions", title: "Subscriptions due", hint: "The evening before, and on the day if unpaid." },
  { key: "udhar", title: "Udhar follow-ups", hint: "On the follow-up date you set." },
  { key: "monthlySummary", title: "Monthly summary", hint: "On the 1st, for the month just gone." },
];

// How delivery to this device has been going, from the server's side.
type Health = { lastDeliveredAt: string | null; lastError: string | null; lastErrorAt: string | null };

// "5 min ago", "yesterday", "on Monday", "on 2 Sept".
function whenText(iso: string): string {
  const ago = fmtAgo(iso);
  if (ago === "Just now" || ago === "Yesterday") return ago.toLowerCase();
  return /ago$/.test(ago) ? ago : `on ${ago}`;
}

async function deviceHealth(endpoint: string): Promise<(Health & { registered: boolean }) | null> {
  const data = await fetch(`/api/push?endpoint=${encodeURIComponent(endpoint)}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return data?.thisDevice ?? null;
}


export function NotificationSettings({ onBack }: { onBack: () => void }) {
  const [device, setDevice] = useState<DeviceState>("loading");
  const [publicKey, setPublicKey] = useState("");
  const [prefs, setPrefs] = useState<Prefs>(ALL_ON);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [health, setHealth] = useState<Health | null>(null);

  const load = useCallback(async () => {
    const profile = await fetch("/api/profile", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (profile?.prefs) setPrefs({ ...ALL_ON, ...profile.prefs });

    if (!pushSupported()) {
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
    let existing = await registration?.pushManager.getSubscription();
    if (!existing) {
      setDevice("off");
      return;
    }
    // The browser still has a subscription; does the server? If iOS or the
    // push service dropped it, register it again now rather than showing a
    // switch that says "on" while nothing arrives.
    let status = await deviceHealth(existing.endpoint);
    if (status && !status.registered && (await ensureRegistered(true)) === "ok") {
      existing = await registration?.pushManager.getSubscription();
      status = existing ? await deviceHealth(existing.endpoint) : null;
    }
    setDevice(status?.registered ? "on" : "off");
    setHealth(status?.registered ? status : null);
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
      rememberPushOff(false);
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
      // Off means off: the app will not quietly register this device again.
      rememberPushOff(true);
      setDevice("off");
      setHealth(null);
    } finally {
      setBusy(false);
    }
  };

  // A new registration with the push service, for a device that has stopped
  // receiving - then one notification, so it proves itself.
  const reconnectDevice = async () => {
    setBusy(true);
    setNote("");
    try {
      if (!(await reconnect())) throw new Error("reconnect failed");
      await fetch("/api/push/test", { method: "POST" }).catch(() => null);
      setNote("Reconnected, and sent one to check.");
      await load();
    } catch {
      setNote("Couldn't reconnect. Try switching it off and on again.");
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

        {device === "on" && health && <DeviceHealth health={health} busy={busy} onReconnect={reconnectDevice} />}

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

// Whether notifications are actually reaching this device. A failure newer
// than the last delivery means they have stopped - and says so, with the fix
// one tap away, instead of the switch saying "on" while nothing arrives.
function DeviceHealth({ health, busy, onReconnect }: { health: Health; busy: boolean; onReconnect: () => void }) {
  const failing =
    health.lastError &&
    health.lastErrorAt &&
    (!health.lastDeliveredAt || health.lastErrorAt > health.lastDeliveredAt);
  if (failing) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] font-semibold" style={{ color: "var(--bad)" }} role="status">
          Stopped reaching this device {whenText(health.lastErrorAt!)}.
        </p>
        <button type="button" className="btn btn-ghost !min-h-9 !py-1.5 !px-3.5 !text-[13px] shrink-0" disabled={busy} onClick={onReconnect}>
          Reconnect
        </button>
      </div>
    );
  }
  return (
    <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>
      {health.lastDeliveredAt
        ? `Last delivered ${whenText(health.lastDeliveredAt)}.`
        : "Nothing delivered to this device yet."}
    </p>
  );
}
