// Sending the reminder emails, in one place.
//
// The two Vercel cron jobs call this - 6pm for what is due, 4:30am for the
// recap of the day before. The app calls it too, when it is opened after
// those times, because a cron job on the free plan is not a guarantee: a run
// that lands while a new deployment is taking over is simply skipped, and a
// recap that never arrives is worse than one that arrives late.
//
// Sending twice is prevented by the claim rather than by who calls: the row
// in reminder_log is written first, and only whoever wrote it sends.
import {
  categoryTotals,
  claimReminder,
  listExpensesInRange,
  listLedgerActivity,
  listLedgerPeople,
  listSubscriptions,
  releaseReminder,
  type ReminderRecipient,
} from "@/lib/db";
import { mailConfigured, sendMail } from "@/lib/mailer";
import {
  buildRecap,
  dailyRecapEmail,
  recapIsEmpty,
  findDue,
  monthlySummaryEmail,
  subscriptionReminderEmail,
  summaryMonth,
  udharReminderEmail,
  type ReminderEmail,
} from "@/lib/reminders";
import { addDays, pakistanMinutes, pakistanToday } from "@/lib/expense-parse";
import { MONTH_NAMES } from "@/lib/format";

export const APP_URL = process.env.APP_URL ?? "https://khata-delta.vercel.app";

// The hours the emails belong to, in Pakistan time.
export const EVENING_HOUR = 18;
export const RECAP_HOUR = 4;
export const RECAP_MINUTE = 30;

export type SendResult = { sent: number; errors: string[] };

async function send(user: ReminderRecipient, key: string, build: () => Promise<ReminderEmail>): Promise<boolean> {
  if (!(await claimReminder(user.id, key))) return false;
  try {
    await sendMail({ to: user.email, ...(await build()) });
    return true;
  } catch (err) {
    // Not sent after all: let the next run try again.
    await releaseReminder(user.id, key);
    throw err;
  }
}

// Everything that goes out at 6pm: a subscription due tomorrow, one due today
// and still unpaid, a person to follow up with - and, on the 1st, last
// month's summary.
export async function sendEveningReminders(user: ReminderRecipient, today = pakistanToday()): Promise<SendResult> {
  const result: SendResult = { sent: 0, errors: [] };
  if (!mailConfigured()) return result;

  const name = user.name || user.username;
  const [subs, people] = await Promise.all([listSubscriptions(user.id), listLedgerPeople(user.id)]);
  const due = findDue(
    today,
    subs.map((s) => ({ ...s, active: Boolean(s.active) })),
    people
  );

  // Built lazily, so only an email that still needs sending does any work.
  const pending: { key: string; build: () => Promise<ReminderEmail> }[] = [];
  if (user.prefs.subscriptions) {
    pending.push(
      ...due.subsTomorrow.map((item) => ({
        key: item.key,
        build: async () => subscriptionReminderEmail({ name, item, stage: "before" as const, appUrl: APP_URL }),
      })),
      ...due.subsToday.map((item) => ({
        key: item.key,
        build: async () => subscriptionReminderEmail({ name, item, stage: "due" as const, appUrl: APP_URL }),
      }))
    );
  }
  if (user.prefs.udhar) {
    pending.push(
      ...due.reachOut.map((item) => ({
        key: item.key,
        build: async () => udharReminderEmail({ name, item, appUrl: APP_URL }),
      }))
    );
  }
  const summaryFor = summaryMonth(today);
  if (summaryFor && user.prefs.monthlySummary) {
    pending.push({
      key: summaryFor.key,
      build: async () => {
        const totals = await categoryTotals(user.id, { year: summaryFor.year, month: summaryFor.month });
        const owing = people.filter((p) => p.balance >= 0.005);
        return monthlySummaryEmail({
          name,
          summary: {
            label: `${MONTH_NAMES[summaryFor.month - 1]} ${summaryFor.year}`,
            total: totals.reduce((sum, c) => sum + c.total, 0),
            count: totals.reduce((sum, c) => sum + c.count, 0),
            top: totals.map((c) => ({ category: c.category, total: c.total })),
          },
          owed: { total: owing.reduce((sum, p) => sum + p.balance, 0), people: owing.length },
          appUrl: APP_URL,
        });
      },
    });
  }

  for (const reminder of pending) {
    try {
      if (await send(user, reminder.key, reminder.build)) result.sent++;
    } catch (err) {
      result.errors.push(`${user.id.slice(0, 8)} ${reminder.key.split(":")[0]}: ${(err as Error).message.slice(0, 200)}`);
    }
  }
  return result;
}

// The 4:30am recap of the day that just ended - unless the day was empty, in
// which case there is nothing to recap and no email goes out. The claim is
// taken first and kept either way, so the day is settled once: neither a
// second run nor the app's catch-up rebuilds it.
export async function sendDailyRecap(user: ReminderRecipient, date: string): Promise<SendResult> {
  const result: SendResult = { sent: 0, errors: [] };
  if (!mailConfigured() || !user.prefs.dailyRecap) return result;

  const key = `recap:${date}`;
  if (!(await claimReminder(user.id, key))) return result;
  try {
    const recap = await buildRecap(date, {
      expenses: (from, to) => listExpensesInRange(user.id, from, to),
      ledger: (from, to) => listLedgerActivity(user.id, from, to),
      subscriptions: () => listSubscriptions(user.id),
    });
    if (recapIsEmpty(recap)) return result;
    await sendMail({
      to: user.email,
      ...dailyRecapEmail({ name: user.name || user.username, recap, appUrl: APP_URL }),
    });
    result.sent++;
  } catch (err) {
    // Not sent after all: let the next run try again.
    await releaseReminder(user.id, key);
    result.errors.push(`${user.id.slice(0, 8)} recap: ${(err as Error).message.slice(0, 200)}`);
  }
  return result;
}

// What today still owes this account, by the clock in Pakistan. Used when the
// app is opened, so a cron run that never happened doesn't cost the user
// their reminder.
export async function sendAnythingDue(user: ReminderRecipient, now = new Date()): Promise<SendResult> {
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
