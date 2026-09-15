import { NextResponse } from "next/server";
import {
  ensureTablesExist,
  listExpensesInRange,
  listLedgerActivity,
  listReminderRecipients,
  listSubscriptions,
  markRemindersSent,
  unsentReminders,
} from "@/lib/db";
import { mailConfigured, sendMail } from "@/lib/mailer";
import { buildRecap, dailyRecapEmail } from "@/lib/reminders";
import { addDays, pakistanToday } from "@/lib/expense-parse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const APP_URL = process.env.APP_URL ?? "https://khata-delta.vercel.app";

// Runs once a day at 23:30 UTC - 4:30am in Pakistan (vercel.json). Emails
// each user with reminders on a recap of the day that just ended: expenses
// recorded, Udhar Khata entries, subscriptions that were due or marked paid,
// and a nudge to add anything they forgot. Logged once sent, so a retried run
// never sends the same day's recap twice.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!mailConfigured()) return NextResponse.json({ ok: true, mailConfigured: false, emailed: 0 });

  await ensureTablesExist();
  // At 4:30am the Pakistan date has already moved on: the recap is for the day before.
  const date = addDays(pakistanToday(), -1);
  const key = `recap:${date}`;
  let emailed = 0;
  const errors: string[] = [];

  for (const user of await listReminderRecipients()) {
    try {
      if (!(await unsentReminders(user.id, [key])).has(key)) continue;
      const recap = await buildRecap(date, {
        expenses: (from, to) => listExpensesInRange(user.id, from, to),
        ledger: (from, to) => listLedgerActivity(user.id, from, to),
        subscriptions: () => listSubscriptions(user.id),
      });
      await sendMail({ to: user.email, ...dailyRecapEmail({ name: user.name || user.username, recap, appUrl: APP_URL }) });
      await markRemindersSent(user.id, [key]);
      emailed++;
    } catch (err) {
      errors.push(`${user.id.slice(0, 8)}: ${(err as Error).message.slice(0, 200)}`);
    }
  }

  if (errors.length) console.error(JSON.stringify({ evt: "cron_recap", errors }));
  return NextResponse.json({ ok: true, date, emailed, errors });
}
