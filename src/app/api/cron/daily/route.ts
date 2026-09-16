import { NextResponse } from "next/server";
import {
  ensureMonthlySubscriptionsExpense,
  ensureTablesExist,
  listReminderRecipients,
  listSubscriptions,
  listUserIds,
  todayYMD,
  tomorrowYMD,
} from "@/lib/db";
import { mailConfigured } from "@/lib/mailer";
import { sendEveningReminders } from "@/lib/reminder-run";
import { pakistanToday } from "@/lib/expense-parse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Runs once a day at 13:00 UTC - 6pm in Pakistan (vercel.json).
// 1. On the last day of a month, adds that month's "Subscriptions" expense to
//    Mera Khata for every user. ensureMonthlySubscriptionsExpense checks for an
//    existing one first, so a retried call never adds it twice.
// 2. Emails each user who has saved an address the reminders they asked for:
//    a subscription due tomorrow, one due today and still unpaid, someone to
//    follow up with today, and on the 1st last month's summary. Each is
//    claimed in reminder_log before sending, so a retried run - or the app's
//    own catch-up - never sends it again.
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
    for (const user of await listReminderRecipients()) {
      try {
        const result = await sendEveningReminders(user, today);
        emailed += result.sent;
        errors.push(...result.errors);
      } catch (err) {
        errors.push(`email ${user.id.slice(0, 8)}: ${(err as Error).message.slice(0, 200)}`);
      }
    }
  }

  if (errors.length) console.error(JSON.stringify({ evt: "cron_daily", errors }));
  return NextResponse.json({ ok: true, monthEnd, added, emailed, mailConfigured: mailConfigured(), errors });
}
