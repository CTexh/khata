import { NextResponse } from "next/server";
import {
  categoryTotals,
  ensureMonthlySubscriptionsExpense,
  ensureTablesExist,
  listLedgerPeople,
  listReminderRecipients,
  listSubscriptions,
  listUserIds,
  markRemindersSent,
  todayYMD,
  tomorrowYMD,
  unsentReminders,
} from "@/lib/db";
import { mailConfigured, sendMail } from "@/lib/mailer";
import {
  findDue,
  monthlySummaryEmail,
  subscriptionReminderEmail,
  summaryMonth,
  udharReminderEmail,
  type ReminderEmail,
} from "@/lib/reminders";
import { pakistanToday } from "@/lib/expense-parse";
import { MONTH_NAMES } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const APP_URL = process.env.APP_URL ?? "https://khata-delta.vercel.app";

// Runs once a day at 13:00 UTC - 6pm in Pakistan (vercel.json).
// 1. On the last day of a month, adds that month's "Subscriptions" expense to
//    Mera Khata for every user. ensureMonthlySubscriptionsExpense checks for an
//    existing one first, so a retried call never adds it twice.
// 2. Emails each user who has saved an address, one email per reminder: a
//    subscription due tomorrow, one due today and still unpaid, someone to
//    follow up with today, and on the 1st last month's summary. Each is logged
//    once sent, so a retried run never sends it again.
// Guarded by CRON_SECRET, which Vercel sends as a bearer token; the route is
// excluded from the session check in proxy.ts, as a cron caller has no session.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureTablesExist();
  const errors: string[] = [];

  // Month-end subscriptions expense.
  const utcToday = todayYMD();
  const monthEnd = tomorrowYMD().slice(0, 7) !== utcToday.slice(0, 7);
  let added = 0;
  if (monthEnd) {
    const [year, month] = utcToday.split("-").map(Number);
    for (const userId of await listUserIds()) {
      try {
        const subs = await listSubscriptions(userId);
        const activeTotal = subs.filter((s) => s.active).reduce((sum, s) => sum + s.amount, 0);
        if (await ensureMonthlySubscriptionsExpense(userId, year, month, activeTotal)) added++;
      } catch (err) {
        errors.push(`expense ${userId.slice(0, 8)}: ${(err as Error).message}`);
      }
    }
  }

  // Email reminders.
  let emailed = 0;
  if (mailConfigured()) {
    const today = pakistanToday();
    const summaryFor = summaryMonth(today);
    for (const user of await listReminderRecipients()) {
      try {
        const name = user.name || user.username;
        const [subs, people] = await Promise.all([listSubscriptions(user.id), listLedgerPeople(user.id)]);
        const due = findDue(
          today,
          subs.map((s) => ({ ...s, active: Boolean(s.active) })),
          people
        );

        // Built lazily, so only emails that still need sending do any work.
        const pending: { key: string; build: () => Promise<ReminderEmail> }[] = [];
        // Each kind of email is opt-out in Profile settings.
        if (user.prefs.subscriptions) pending.push(
          ...due.subsTomorrow.map((item) => ({
            key: item.key,
            build: async () => subscriptionReminderEmail({ name, item, stage: "before", appUrl: APP_URL }),
          })),
          ...due.subsToday.map((item) => ({
            key: item.key,
            build: async () => subscriptionReminderEmail({ name, item, stage: "due", appUrl: APP_URL }),
          }))
        );
        if (user.prefs.udhar) pending.push(
          ...due.reachOut.map((item) => ({
            key: item.key,
            build: async () => udharReminderEmail({ name, item, appUrl: APP_URL }),
          }))
        );
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
                  total: totals.reduce((s, c) => s + c.total, 0),
                  count: totals.reduce((s, c) => s + c.count, 0),
                  top: totals.map((c) => ({ category: c.category, total: c.total })),
                },
                owed: { total: owing.reduce((s, p) => s + p.balance, 0), people: owing.length },
                appUrl: APP_URL,
              });
            },
          });
        }

        const fresh = await unsentReminders(user.id, pending.map((p) => p.key));
        for (const reminder of pending) {
          if (!fresh.has(reminder.key)) continue;
          try {
            await sendMail({ to: user.email, ...(await reminder.build()) });
            await markRemindersSent(user.id, [reminder.key]);
            emailed++;
          } catch (err) {
            errors.push(`email ${user.id.slice(0, 8)} ${reminder.key.split(":")[0]}: ${(err as Error).message.slice(0, 200)}`);
          }
        }
      } catch (err) {
        errors.push(`email ${user.id.slice(0, 8)}: ${(err as Error).message.slice(0, 200)}`);
      }
    }
  }

  if (errors.length) console.error(JSON.stringify({ evt: "cron_daily", errors }));
  return NextResponse.json({ ok: true, monthEnd, added, emailed, mailConfigured: mailConfigured(), errors });
}
