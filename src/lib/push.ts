// Push notifications: the scheduled job decides what is due, and this
// delivers it to whichever devices have agreed to receive it. They are how
// Khata reminds you of anything - there is no email.
//
// A notification is sent with VAPID keys, which identify this app to the
// phone's push service (Apple's for an iPhone, Google's for an Android). No
// third party is involved and nothing is paid for. Without the keys in the
// environment, push is simply off and nothing is delivered.
import webpush from "web-push";
import {
  deletePushSubscription,
  listPushSubscriptions,
  recordDeviceDelivery,
  type PushSubscriptionRow,
} from "@/lib/db";

// How a notification should read, going by what a phone actually shows: the
// app's name and icon are already in the header, so the title is the news
// itself - short, specific, no "Khata" - and the body carries the figures.
// Both are kept well inside what a lock screen shows before it truncates.
export type PushMessage = { title: string; body: string; url?: string; tag?: string };

// What actually goes to the device: the message, plus the unread count for
// the app icon's badge.
export type PushPayload = PushMessage & { badge?: number };

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
// Apple requires a contact for the app sending the push; any mailto: or https:
// address of the app's owner does.
const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:khata@example.com";

export function pushConfigured(): boolean {
  return Boolean(PUBLIC_KEY && PRIVATE_KEY);
}

export function pushPublicKey(): string {
  return PUBLIC_KEY;
}

let ready = false;
function configure() {
  if (ready) return;
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  ready = true;
}

export type DeliveryResult = { devices: number; delivered: number; error: string | null };

// Hands one notification to every device this account has registered - and
// only that. Keeping it in the bell and trying again later are the outbox's
// job (lib/notify.ts); this is the part that talks to Apple and Google.
//
// A device whose push service reports it gone (404/410 - the app was
// deleted, or the browser dropped it) is removed, so it isn't tried again.
// Every other outcome is written against the device, for the health line in
// Settings.
export async function deliverToDevices(
  userId: string,
  payload: PushPayload,
  ttlSeconds: number
): Promise<DeliveryResult> {
  if (!pushConfigured()) return { devices: 0, delivered: 0, error: "push is not configured" };
  const devices = await listPushSubscriptions(userId);
  if (!devices.length) return { devices: 0, delivered: 0, error: "no device registered" };
  configure();

  const body = JSON.stringify(payload);
  const ttl = Math.max(60, Math.min(12 * 60 * 60, Math.round(ttlSeconds)));
  let delivered = 0;
  let lastError: string | null = null;
  await Promise.all(
    devices.map(async (device: PushSubscriptionRow) => {
      try {
        await webpush.sendNotification(
          { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
          body,
          { TTL: ttl }
        );
        delivered++;
        await recordDeviceDelivery(device.endpoint, null).catch(() => {});
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await deletePushSubscription(device.endpoint);
          lastError = lastError ?? "device no longer registered";
          return;
        }
        const message = `${status ?? "network"}: ${(err as Error).message.slice(0, 160)}`;
        lastError = message;
        await recordDeviceDelivery(device.endpoint, message).catch(() => {});
        console.error(JSON.stringify({ evt: "push", status: status ?? null, error: message }));
      }
    })
  );
  return { devices: devices.length, delivered, error: delivered ? null : lastError };
}
