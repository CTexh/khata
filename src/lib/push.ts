// Push notifications, the same way the emails work: the scheduled job decides
// what is due, and this delivers it to whichever devices have agreed to
// receive it.
//
// A notification is sent with VAPID keys, which identify this app to the
// phone's push service (Apple's for an iPhone, Google's for an Android). No
// third party is involved and nothing is paid for. Without the keys in the
// environment, push is simply off - the emails carry on as before.
import webpush from "web-push";
import { deletePushSubscription, listPushSubscriptions, type PushSubscriptionRow } from "@/lib/db";

// How a notification should read, going by what a phone actually shows: the
// app's name and icon are already in the header, so the title is the news
// itself - short, specific, no "Khata" - and the body carries the figures.
// Both are kept well inside what a lock screen shows before it truncates.
export type PushMessage = { title: string; body: string; url?: string; tag?: string };

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

// Sends to every device this account has registered. A device whose
// subscription the push service reports as gone (404/410 - the app was
// deleted, or the browser dropped it) is removed, so it isn't tried again.
export async function sendPush(userId: string, message: PushMessage): Promise<number> {
  if (!pushConfigured()) return 0;
  const devices = await listPushSubscriptions(userId);
  if (!devices.length) return 0;
  configure();

  const payload = JSON.stringify(message);
  let delivered = 0;
  await Promise.all(
    devices.map(async (device: PushSubscriptionRow) => {
      try {
        await webpush.sendNotification(
          { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
          payload,
          { TTL: 12 * 60 * 60 }
        );
        delivered++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await deletePushSubscription(device.endpoint);
          return;
        }
        console.error(
          JSON.stringify({ evt: "push", status: status ?? null, error: (err as Error).message.slice(0, 200) })
        );
      }
    })
  );
  return delivered;
}
