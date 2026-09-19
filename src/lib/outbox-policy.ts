// When the outbox tries again after a failed delivery: soon at first, then
// less often, until the notification is too old to be worth sending. Kept
// apart from lib/notify.ts, which needs the database, so it can be tested on
// its own.
export function nextAttemptDelayMs(attempts: number): number {
  const minutes = [5, 15, 30, 60][attempts - 1] ?? 120;
  return minutes * 60 * 1000;
}
