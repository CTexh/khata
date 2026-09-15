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
import { buildReminderEmail, findDue, summaryMonth, type DueReminders } from "@/lib/reminders";
import { pakistanToday } from "@/lib/expense-parse";
import { MONTH_NAMES } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const APP_URL = process.env.APP_URL ?? "https://khata-delta.vercel.app";

// Runs once a day at 04:00 UTC - 9am in Pakistan (vercel.json).
// 1. On the last day of a month, adds that month's "Subscriptions" expense to
//    Mera Khata for every user. ensureMonthlySubscriptionsExpense checks for an
//    existing one first, so a retried call never adds it twice.
// 2. Emails each user who has saved an address one reminder: subscriptions due
//    tomorrow or today, Udhar reach-out dates, and on the 1st last month's
//    summary. Every item is logged when sent, so nothing goes out twice.
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
        const [subs, people] = await Promise.all([listSubscriptions(user.id), listLedgerPeople(user.id)]);
        const found = findDue(
          today,
          subs.map((s) => ({ ...s, active: Boolean(s.active) })),
          people
        );
        const keys = [
          ...found.subsTomorrow,
          ...found.subsToday,
          ...found.reachOut,
        ].map((i) => i.key);
        if (summaryFor) keys.push(summaryFor.key);
        const fresh = await unsentReminders(user.id, keys);
        if (!fresh.size) continue;

        const due: DueReminders = {
          subsTomorrow: found.subsTomorrow.filter((i) => fresh.has(i.key)),
          subsToday: found.subsToday.filter((i) => fresh.has(i.key)),
          reachOut: found.reachOut.filter((i) => fresh.has(i.key)),
        };
        let summary = null;
        let owed = null;
        if (summaryFor && fresh.has(summaryFor.key)) {
          const totals = await categoryTotals(user.id, { year: summaryFor.year, month: summaryFor.month });
          summary = {
            label: `${MONTH_NAMES[summaryFor.month - 1]} ${summaryFor.year}`,
            total: totals.reduce((s, c) => s + c.total, 0),
            count: totals.reduce((s, c) => s + c.count, 0),
            top: totals.map((c) => ({ category: c.category, total: c.total })),
          };
          const owing = people.filter((p) => p.balance >= 0.005);
          owed = { total: owing.reduce((s, p) => s + p.balance, 0), people: owing.length };
        }

        const email = buildReminderEmail({ name: user.name || user.username, today, due, summary, owed, appUrl: APP_URL });
        if (!email) continue;
        await sendMail({ to: user.email, ...email });
        await markRemindersSent(user.id, [...fresh]);
        emailed++;
      } catch (err) {
        errors.push(`email ${user.id.slice(0, 8)}: ${(err as Error).message}`);
      }
    }
  }

  if (errors.length) console.error(JSON.stringify({ evt: "cron_daily", errors }));
  return NextResponse.json({ ok: true, monthEnd, added, emailed, mailConfigured: mailConfigured(), errors });
}
