import { NextResponse } from "next/server";
import { ensureTablesExist, listReminderRecipients } from "@/lib/db";
import { mailConfigured } from "@/lib/mailer";
import { sendDailyRecap } from "@/lib/reminder-run";
import { addDays, pakistanToday } from "@/lib/expense-parse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Runs once a day at 23:30 UTC - 4:30am in Pakistan (vercel.json). Emails
// each user who wants it a recap of the day that just ended: expenses
// recorded, Udhar Khata entries, subscriptions that were due or marked paid,
// and a nudge to add anything they forgot. Claimed in reminder_log before it
// is sent, so neither a retried run nor the app's own catch-up can send the
// same day's recap twice.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!mailConfigured()) return NextResponse.json({ ok: true, mailConfigured: false, emailed: 0 });

  await ensureTablesExist();
  // At 4:30am the Pakistan date has already moved on: the recap is for the day before.
  const date = addDays(pakistanToday(), -1);
  let emailed = 0;
  const errors: string[] = [];

  for (const user of await listReminderRecipients()) {
    const result = await sendDailyRecap(user, date);
    emailed += result.sent;
    errors.push(...result.errors);
  }

  if (errors.length) console.error(JSON.stringify({ evt: "cron_recap", errors }));
  return NextResponse.json({ ok: true, date, emailed, errors });
}
