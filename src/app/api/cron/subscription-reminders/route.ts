import { NextResponse } from "next/server";
import {
  ensureTablesExist,
  listUsersForReminders,
  listSubscriptions,
  listExpenses,
  ensureMonthlySubscriptionsExpense,
  markReminderSent,
  todayYMD,
  tomorrowYMD,
} from "@/lib/db";
import { sendWhatsAppReminder, sendWhatsAppMonthlyReport } from "@/lib/whatsapp";
import { fmtRs, MONTH_NAMES } from "@/lib/format";

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

  // Last day of the month iff tomorrow rolls into a new month - this is
  // what triggers the month-end subscriptions expense + WhatsApp report
  // below, without needing a separate cron entry in vercel.json.
  const isLastDayOfMonth = tomorrow.slice(0, 7) !== today.slice(0, 7);
  const [todayYear, todayMonth] = today.split("-").map(Number);

  let remindersSent = 0;
  let monthEndReportsSent = 0;
  const errors: string[] = [];
  for (const user of recipients) {
    const subs = await listSubscriptions(user.id);
    for (const sub of subs) {
      if (!sub.active || sub.paid_this_period) continue;

      if (sub.current_due_date === today && !sub.reminder_due_today_sent) {
        const result = await sendWhatsAppReminder(user.phone, sub.name, fmtRs(sub.amount), "today");
        if (result.ok) {
          await markReminderSent(sub.current_payment_id, "due_today");
          remindersSent++;
        } else {
          errors.push(`${sub.name} (due today): ${result.error}`);
        }
      } else if (sub.current_due_date === tomorrow && !sub.reminder_day_before_sent) {
        const result = await sendWhatsAppReminder(user.phone, sub.name, fmtRs(sub.amount), "tomorrow");
        if (result.ok) {
          await markReminderSent(sub.current_payment_id, "day_before");
          remindersSent++;
        } else {
          errors.push(`${sub.name} (due tomorrow): ${result.error}`);
        }
      }
    }

    if (isLastDayOfMonth) {
      const activeTotal = subs.filter((s) => s.active).reduce((sum, s) => sum + s.amount, 0);
      const added = await ensureMonthlySubscriptionsExpense(user.id, todayYear, todayMonth, activeTotal);

      if (user.phone) {
        const monthExpenses = await listExpenses(user.id, { year: todayYear, month: todayMonth });
        const monthTotal = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
        const result = await sendWhatsAppMonthlyReport(
          user.phone,
          `${MONTH_NAMES[todayMonth - 1]} ${todayYear}`,
          fmtRs(monthTotal)
        );
        if (result.ok) {
          monthEndReportsSent++;
        } else {
          errors.push(`month-end report (added subscriptions expense: ${added}): ${result.error}`);
        }
      }
    }
  }

  return NextResponse.json({ ok: true, remindersSent, monthEndReportsSent, errors });
}
