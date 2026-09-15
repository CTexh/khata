import { NextResponse } from "next/server";
import {
  ensureMonthlySubscriptionsExpense,
  ensureTablesExist,
  listSubscriptions,
  listUserIds,
  todayYMD,
  tomorrowYMD,
} from "@/lib/db";

export const dynamic = "force-dynamic";

// Runs once a day (vercel.json). On the last day of a month it adds that
// month's "Subscriptions" expense to Mera Khata for every user - the total of
// their active subscriptions. ensureMonthlySubscriptionsExpense checks for an
// existing one first, so a retried call never adds it twice.
// Guarded by CRON_SECRET, which Vercel sends as a bearer token; the route is
// excluded from the session check in proxy.ts, as a cron caller has no session.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = todayYMD();
  // The last day of the month is the day whose tomorrow is in another month.
  if (tomorrowYMD().slice(0, 7) === today.slice(0, 7)) {
    return NextResponse.json({ ok: true, monthEnd: false });
  }

  await ensureTablesExist();
  const [year, month] = today.split("-").map(Number);
  let added = 0;
  const errors: string[] = [];
  for (const userId of await listUserIds()) {
    try {
      const subs = await listSubscriptions(userId);
      const activeTotal = subs.filter((s) => s.active).reduce((sum, s) => sum + s.amount, 0);
      if (await ensureMonthlySubscriptionsExpense(userId, year, month, activeTotal)) added++;
    } catch (err) {
      errors.push(`${userId.slice(0, 8)}: ${(err as Error).message}`);
    }
  }
  return NextResponse.json({ ok: true, monthEnd: true, added, errors });
}
