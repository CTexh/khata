// The outbox: how every notification in Khata is sent.
//
// A notification is written down first and delivered second. Written down, it
// is in the bell at once - on every device, whether or not this one has
// notifications switched on, and whatever the phone's push service says.
// Delivered, it lights up the phone; and if delivery fails, the scheduled job
// that runs every fifteen minutes tries again, until it gets through or is
// too old to be worth sending.
//
// Before this, a notification existed only if it reached a phone the first
// time: a hiccup at Apple's end, or a phone that had not switched
// notifications on yet, and it was as if it had never been sent.
import {
  claimForDelivery,
  createNotification,
  dueNotifications,
  markNotificationDelivered,
  markNotificationExpired,
  markNotificationRetry,
  unreadNotificationCount,
  type OutboxRow,
} from "@/lib/db";
import { deliverToDevices, type PushMessage } from "@/lib/push";
import { nextAttemptDelayMs } from "@/lib/outbox-policy";

type Outcome = "delivered" | "retry" | "expired" | "skipped";

async function attempt(row: OutboxRow, now = new Date()): Promise<Outcome> {
  const expires = Date.parse(row.expiresAt);
  if (!Number.isFinite(expires) || expires <= now.getTime()) {
    await markNotificationExpired(row.id);
    return "expired";
  }
  // Someone else - the cron job, or this same notification's first attempt -
  // is already sending it.
  if (!(await claimForDelivery(row.id, now.toISOString()))) return "skipped";

  const badge = await unreadNotificationCount(row.userId).catch(() => undefined);
  const result = await deliverToDevices(
    row.userId,
    { title: row.title, body: row.body, url: row.url ?? undefined, tag: row.tag ?? undefined, badge },
    (expires - now.getTime()) / 1000
  );
  if (result.delivered > 0) {
    await markNotificationDelivered(row.id);
    return "delivered";
  }

  const attempts = row.attempts + 1;
  const next = now.getTime() + nextAttemptDelayMs(attempts);
  if (next >= expires) {
    await markNotificationExpired(row.id);
    return "expired";
  }
  await markNotificationRetry(row.id, attempts, new Date(next).toISOString(), result.error);
  return "retry";
}

// Sends a notification to one account: into the bell now, and to its devices
// now if that works, later if it does not. `validForMinutes` is how long it
// stays worth delivering.
export async function notify(
  userId: string,
  message: PushMessage,
  { validForMinutes }: { validForMinutes: number }
): Promise<OutboxRow> {
  const expiresAt = new Date(Date.now() + validForMinutes * 60 * 1000).toISOString();
  const row = await createNotification(userId, message, expiresAt);
  try {
    await attempt(row);
  } catch (err) {
    // It is safely in the outbox; the next scheduled run will deliver it.
    console.error(JSON.stringify({ evt: "notify", error: (err as Error).message.slice(0, 200) }));
  }
  return row;
}

// Delivers whatever is waiting: called every fifteen minutes by the scheduled
// job, and straight away for one account when it registers a device, so what
// piled up while it had none arrives now rather than at the next run.
export async function deliverPending(
  opts: { userId?: string; limit?: number } = {}
): Promise<{ delivered: number; retrying: number; expired: number }> {
  const now = new Date();
  const rows = await dueNotifications(now.toISOString(), opts.limit ?? 100, opts.userId);
  const counts = { delivered: 0, retrying: 0, expired: 0 };
  for (const row of rows) {
    try {
      const outcome = await attempt(row, now);
      if (outcome === "delivered") counts.delivered++;
      else if (outcome === "retry") counts.retrying++;
      else if (outcome === "expired") counts.expired++;
    } catch (err) {
      console.error(JSON.stringify({ evt: "deliver_pending", error: (err as Error).message.slice(0, 200) }));
    }
  }
  return counts;
}
