import { NextResponse } from "next/server";
import {
  ensureTablesExist,
  listUsersForReminders,
  listSubscriptions,
  markReminderSent,
  todayYMD,
  tomorrowYMD,
} from "@/lib/db";
import { sendWhatsAppReminder } from "@/lib/whatsapp";
import { fmtRs } from "@/lib/format";

export const dynamic = "force-dynamic";

// Triggered once a day by the Vercel Cron Job configured in vercel.json.
// Vercel signs cron requests with `Authorization: Bearer $CRON_SECRET` when
// that env var is set on the project - this is the sole guard for this
// route (it's carved out of the session-based proxy.ts auth entirely, same
// as /api/auth/*, since a session doesn't make sense for a cron caller).
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureTablesExist();

  const today = todayYMD();
  const tomorrow = tomorrowYMD();
  const recipients = await listUsersForReminders();

  let remindersSent = 0;
  for (const user of recipients) {
    const subs = await listSubscriptions(user.id);
    for (const sub of subs) {
      if (!sub.active || sub.paid_this_period) continue;

      if (sub.current_due_date === today && !sub.reminder_due_today_sent) {
        const ok = await sendWhatsAppReminder(user.phone, sub.name, fmtRs(sub.amount), "today");
        if (ok) {
          await markReminderSent(sub.current_payment_id, "due_today");
          remindersSent++;
        }
      } else if (sub.current_due_date === tomorrow && !sub.reminder_day_before_sent) {
        const ok = await sendWhatsAppReminder(user.phone, sub.name, fmtRs(sub.amount), "tomorrow");
        if (ok) {
          await markReminderSent(sub.current_payment_id, "day_before");
          remindersSent++;
        }
      }
    }
  }

  return NextResponse.json({ ok: true, remindersSent });
}
