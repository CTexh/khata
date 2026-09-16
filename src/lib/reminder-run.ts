// Sending the reminders, in one place.
//
// The scheduled job calls this - and the app itself does too when it is
// opened, because no scheduler is a guarantee: a run that lands while a new
// deployment is taking over is simply skipped, and a reminder that never
// arrives is worse than one that arrives late.
//
// Sending twice is prevented by the claim rather than by who calls: the row
// in reminder_log is written first, and only whoever wrote it sends.
import {
  claimReminder,
  listExpensesInRange,
  listLedgerActivity,
  listLedgerPeople,
  listSubscriptions,
  releaseReminder,
  type NotificationRecipient,
} from "@/lib/db";
import { sendPush, type PushMessage } from "@/lib/push";
import {
  buildRecap,
  findDue,
  recapIsEmpty,
  summaryMonth,
} from "@/lib/reminders";
import {
  monthlySummaryMessage,
  recapMessage,
  subscriptionMessage,
  udharMessage,
} from "@/lib/reminder-messages";
import { addDays, pakistanMinutes, pakistanToday } from "@/lib/expense-parse";
import { fmtDateLabel } from "@/lib/format";

// The hours the reminders belong to, in Pakistan time.
export const EVENING_HOUR = 18;
export const RECAP_HOUR = 4;
export const RECAP_MINUTE = 30;

export type SendResult = { sent: number; errors: string[] };

// Claims the reminder, then notifies every device the account registered. The
// claim is released again if nothing could be delivered, so the next run
// tries again rather than the reminder being lost.
async function send(user: NotificationRecipient, key: string, message: PushMessage): Promise<boolean> {
  if (!(await claimReminder(user.id, key))) return false;
  const delivered = await sendPush(user.id, message);
  if (delivered) return true;
  await releaseReminder(user.id, key);
  return false;
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

  const pending: { key: string; message: PushMessage }[] = [];
  if (user.prefs.subscriptions) {
    pending.push(
      ...due.subsTomorrow.map((item) => ({ key: item.key, message: subscriptionMessage(item, "before") })),
      ...due.subsToday.map((item) => ({ key: item.key, message: subscriptionMessage(item, "due") }))
    );
  }
  if (user.prefs.udhar) {
    pending.push(
      ...due.reachOut.map((item) => ({ key: item.key, message: udharMessage(item) }))
    );
  }
  const summaryFor = summaryMonth(today);
  if (summaryFor && user.prefs.monthlySummary) {
    pending.push({ key: summaryFor.key, message: monthlySummaryMessage(summaryFor.month, summaryFor.key) });
  }

  for (const reminder of pending) {
    try {
      if (await send(user, reminder.key, reminder.message)) result.sent++;
    } catch (err) {
      result.errors.push(`${user.id.slice(0, 8)} ${reminder.key.split(":")[0]}: ${(err as Error).message.slice(0, 200)}`);
    }
  }
  return result;
}

// The 4:30am recap of the day that just ended - unless the day was empty, in
// which case there is nothing to recap and nothing is sent. The claim is
// taken first and kept either way, so a quiet day is settled once rather than
// rebuilt by every run.
export async function sendDailyRecap(user: NotificationRecipient, date: string): Promise<SendResult> {
  const result: SendResult = { sent: 0, errors: [] };
  if (!user.prefs.dailyRecap) return result;

  const key = `recap:${date}`;
  if (!(await claimReminder(user.id, key))) return result;
  try {
    const recap = await buildRecap(date, {
      expenses: (from, to) => listExpensesInRange(user.id, from, to),
      ledger: (from, to) => listLedgerActivity(user.id, from, to),
      subscriptions: () => listSubscriptions(user.id),
    });
    if (recapIsEmpty(recap)) return result;

    const spent = recap.expenses.reduce((sum, e) => sum + e.amount, 0);
    // Sent at 4:30am about the day before, so "Yesterday" is what it is -
    // unless a missed run is being caught up days later, when the date is
    // clearer.
    const day = date === addDays(pakistanToday(), -1) ? "Yesterday" : fmtDateLabel(date);
    const delivered = await sendPush(user.id, recapMessage(day, spent, recap.expenses.length, key));
    if (delivered) result.sent++;
    else await releaseReminder(user.id, key);
  } catch (err) {
    // Not sent after all: let the next run try again.
    await releaseReminder(user.id, key);
    result.errors.push(`${user.id.slice(0, 8)} recap: ${(err as Error).message.slice(0, 200)}`);
  }
  return result;
}

// What today still owes this account, by the clock in Pakistan. Used when the
// app is opened, so a run that never happened doesn't cost the user their
// reminder.
export async function sendAnythingDue(user: NotificationRecipient, now = new Date()): Promise<SendResult> {
  const minutes = pakistanMinutes(now);
  const today = pakistanToday(now);
  const out: SendResult = { sent: 0, errors: [] };

  if (minutes >= RECAP_HOUR * 60 + RECAP_MINUTE) {
    const recap = await sendDailyRecap(user, addDays(today, -1));
    out.sent += recap.sent;
    out.errors.push(...recap.errors);
  }
  if (minutes >= EVENING_HOUR * 60) {
    const evening = await sendEveningReminders(user, today);
    out.sent += evening.sent;
    out.errors.push(...evening.errors);
  }
  return out;
}
