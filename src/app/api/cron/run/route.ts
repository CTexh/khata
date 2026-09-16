import { NextResponse } from "next/server";
import {
  ensureMonthlySubscriptionsExpense,
  ensureTablesExist,
  listReminderRecipients,
  listSubscriptions,
  listUserIds,
} from "@/lib/db";
import { mailConfigured } from "@/lib/mailer";
import { EVENING_HOUR, sendAnythingDue } from "@/lib/reminder-run";
import { addDays, pakistanMinutes, pakistanToday } from "@/lib/expense-parse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The scheduled job, in one endpoint that is safe to call as often as anyone
// likes. It doesn't assume it is being called at a particular minute: it asks
// what the clock in Pakistan says, and sends whatever today owes and nobody
// has sent yet. Each email is claimed in reminder_log before it goes out, so
// calling this every ten minutes sends each one exactly once.
//
// That is deliberate. A cron job is a single moment: miss it - a deployment
// taking over, a delayed trigger, an error - and the email is gone for good.
// Something that can be asked repeatedly turns a missed minute into a few
// minutes' delay. It is called by GitHub Actions on a schedule, by Vercel's
// own cron jobs, and as a last resort when the app is opened.
//
// Guarded by CRON_SECRET; the route is excluded from the session check in
// proxy.ts, as a scheduled caller has no session.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureTablesExist();
  const today = pakistanToday();
  const minutes = pakistanMinutes();
  const errors: string[] = [];

  // On the evening of the last day of the month, this month's subscriptions
  // land in Mera Khata as one expense. Checked for first, so repeat calls
  // never add it twice.
  let added = 0;
  const monthEnd = addDays(today, 1).slice(0, 7) !== today.slice(0, 7);
  if (monthEnd && minutes >= EVENING_HOUR * 60) {
    const [year, month] = today.split("-").map(Number);
    for (const userId of await listUserIds()) {
      try {
        const subs = await listSubscriptions(userId);
        const activeTotal = subs.filter((s) => s.active).reduce((sum, s) => sum + s.amount, 0);
        if (await ensureMonthlySubscriptionsExpense(userId, year, month, activeTotal)) added++;
      } catch (err) {
        errors.push(`expense ${userId.slice(0, 8)}: ${(err as Error).message.slice(0, 200)}`);
      }
    }
  }

  let emailed = 0;
  if (mailConfigured()) {
    for (const user of await listReminderRecipients()) {
      try {
        const result = await sendAnythingDue(user);
        emailed += result.sent;
        errors.push(...result.errors);
      } catch (err) {
        errors.push(`email ${user.id.slice(0, 8)}: ${(err as Error).message.slice(0, 200)}`);
      }
    }
  }

  if (errors.length) console.error(JSON.stringify({ evt: "cron_run", errors }));
  else if (emailed || added) console.log(JSON.stringify({ evt: "cron_run", today, emailed, added }));
  return NextResponse.json({ ok: true, today, emailed, added, mailConfigured: mailConfigured(), errors });
}
