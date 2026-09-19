// Sending the reminders, in one place.
//
// The scheduled job calls this - and the app itself does too when it is
// opened, because no scheduler is a guarantee: a run that lands while a new
// deployment is taking over is simply skipped, and a reminder that never
// arrives is worse than one that arrives late.
//
// Sending twice is prevented by the claim rather than by who calls: the row
// in reminder_log is written first, and only whoever wrote it sends. Once a
// reminder is in the outbox it counts as sent - getting it onto the phone,
// and trying again if that fails, is the outbox's job (lib/notify.ts).
import {
  claimReminder,
  listLedgerPeople,
  listSubscriptions,
  releaseReminder,
  type NotificationRecipient,
} from "@/lib/db";
import type { PushMessage } from "@/lib/push";
import { notify } from "@/lib/notify";
import { findDue, summaryMonth } from "@/lib/reminders";
import {
  missedExpensesMessage,
  monthlySummaryMessage,
  subscriptionMessage,
  udharMessage,
} from "@/lib/reminder-messages";
import { pakistanMinutes, pakistanToday } from "@/lib/expense-parse";

// The hours the reminders belong to, in Pakistan time.
export const EVENING_HOUR = 18;
export const MISSED_HOUR = 4;
// The morning nudge is about yesterday; past this hour it would only be noise.
const MISSED_UNTIL_HOUR = 10;

// How long each kind stays worth delivering to a phone. After that it stays
// in the bell but is no longer pushed.
const EVENING_VALID_MINUTES = 6 * 60; // until about midnight
const MISSED_VALID_MINUTES = 6 * 60; // until about 10am
const SUMMARY_VALID_MINUTES = 24 * 60;

export type SendResult = { sent: number; errors: string[] };

// Claims the reminder, then puts it in the outbox. The claim is released only
// if it could not even be written there, so the next run tries again.
async function send(
  user: NotificationRecipient,
  key: string,
  message: PushMessage,
  validForMinutes: number
): Promise<boolean> {
  if (!(await claimReminder(user.id, key))) return false;
  try {
    await notify(user.id, message, { validForMinutes });
    return true;
  } catch (err) {
    await releaseReminder(user.id, key);
    throw err;
  }
}

// Everything that goes out at 6pm: a subscription due tomorrow, one due today
// and still unpaid, a person to follow up with - and, on the 1st, last
// month's summary.
export async function sendEveningReminders(
  user: NotificationRecipient,
  today = pakistanToday()
): Promise<SendResult> {
  const result: SendResult = { sent: 0, errors: [] };

  const [subs, people] = await Promise.all([listSubscriptions(user.id), listLedgerPeople(user.id)]);
  const due = findDue(
    today,
    subs.map((s) => ({ ...s, active: Boolean(s.active) })),
    people
  );

  const pending: { key: string; message: PushMessage; valid: number }[] = [];
  if (user.prefs.subscriptions) {
    pending.push(
      ...due.subsTomorrow.map((item) => ({
        key: item.key,
        message: subscriptionMessage(item, "before"),
        valid: EVENING_VALID_MINUTES,
      })),
      ...due.subsToday.map((item) => ({
        key: item.key,
        message: subscriptionMessage(item, "due"),
        valid: EVENING_VALID_MINUTES,
      }))
    );
  }
  if (user.prefs.udhar) {
    pending.push(
      ...due.reachOut.map((item) => ({ key: item.key, message: udharMessage(item), valid: EVENING_VALID_MINUTES }))
    );
  }
  const summaryFor = summaryMonth(today);
  if (summaryFor && user.prefs.monthlySummary) {
    pending.push({
      key: summaryFor.key,
      message: monthlySummaryMessage(summaryFor.month, summaryFor.key),
      valid: SUMMARY_VALID_MINUTES,
    });
  }

  for (const reminder of pending) {
    try {
      if (await send(user, reminder.key, reminder.message, reminder.valid)) result.sent++;
    } catch (err) {
      result.errors.push(`${user.id.slice(0, 8)} ${reminder.key.split(":")[0]}: ${(err as Error).message.slice(0, 200)}`);
    }
  }
  return result;
}

// 4am: a nudge to add anything missed yesterday. Every day - the bank emails
// already cover card payments, and this is for everything they cannot see.
export async function sendMissedExpenseReminder(
  user: NotificationRecipient,
  today = pakistanToday()
): Promise<SendResult> {
  const result: SendResult = { sent: 0, errors: [] };
  if (!user.prefs.missedExpenses) return result;
  const key = `missed:${today}`;
  try {
    if (await send(user, key, missedExpensesMessage(key), MISSED_VALID_MINUTES)) result.sent++;
  } catch (err) {
    result.errors.push(`${user.id.slice(0, 8)} missed: ${(err as Error).message.slice(0, 200)}`);
  }
  return result;
}

// What today still owes this account, by the clock in Pakistan. Used by the
// scheduled job, and when the app is opened, so a run that never happened
// doesn't cost the user their reminder.
export async function sendAnythingDue(user: NotificationRecipient, now = new Date()): Promise<SendResult> {
  const minutes = pakistanMinutes(now);
  const today = pakistanToday(now);
  const out: SendResult = { sent: 0, errors: [] };

  if (minutes >= MISSED_HOUR * 60 && minutes < MISSED_UNTIL_HOUR * 60) {
    const missed = await sendMissedExpenseReminder(user, today);
    out.sent += missed.sent;
    out.errors.push(...missed.errors);
  }
  if (minutes >= EVENING_HOUR * 60) {
    const evening = await sendEveningReminders(user, today);
    out.sent += evening.sent;
    out.errors.push(...evening.errors);
  }
  return out;
}
