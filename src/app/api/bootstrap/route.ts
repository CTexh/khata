import { NextResponse, after } from "next/server";
import { getSession } from "@/lib/auth";
import {
  categoryTotals,
  ensureTablesExist,
  getAccountFlags,
  getNotificationRecipient,
  listExpenses,
  listNotifications,
  listPeople,
  listSubscriptions,
  listUserCategories,
  forTheApp,
} from "@/lib/db";
import { listTrips } from "@/lib/trips-db";
import { sameDayBefore } from "@/lib/compare-period";
import { pushConfigured } from "@/lib/push";
import { sendAnythingDue } from "@/lib/reminder-run";

export const dynamic = "force-dynamic";

// A scheduled job is a best effort, not a promise: a run that lands while a
// new deployment is taking over is skipped, and that day's reminder would
// simply never arrive. So opening the app also sends anything whose time has
// passed today and that no one has sent yet. The claim in reminder_log makes
// that safe - whoever writes the row sends, once - and the work happens after
// the response, so nothing here slows the app down.
// Checked at most twice an hour per account on a given server.
const CATCH_UP_EVERY_MS = 30 * 60 * 1000;
const lastCatchUp = new Map<string, number>();

// The bell shows the most recent notifications and fetches the rest when it is
// opened; fifty full rows in the opening request is a lot of words to send to
// a phone that may never tap it.
const NOTIFICATIONS_PRIMED = 12;

function catchUpReminders(userId: string) {
  if (!pushConfigured()) return;
  const last = lastCatchUp.get(userId) ?? 0;
  if (Date.now() - last < CATCH_UP_EVERY_MS) return;
  lastCatchUp.set(userId, Date.now());
  after(async () => {
    try {
      const user = await getNotificationRecipient(userId);
      if (!user) return;
      const { sent, errors } = await sendAnythingDue(user);
      if (sent || errors.length) console.log(JSON.stringify({ evt: "reminder_catch_up", sent, errors }));
    } catch (err) {
      console.error(JSON.stringify({ evt: "reminder_catch_up", error: (err as Error).message.slice(0, 200) }));
    }
  });
}

// Everything the app shows when it opens, in one request: the pages used to
// send eight, each paying for its own function start, session check and
// database connection. The queries run in parallel here, beside the database,
// and each answer is keyed by the endpoint it stands in for, so the client
// cache stores it exactly as if that endpoint had been called.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // The month the browser is in, so the keys match the ones the pages build.
  const url = new URL(req.url);
  const now = new Date();
  const y = Number(url.searchParams.get("y")) || now.getFullYear();
  const askedMonth = Number(url.searchParams.get("m"));
  const m = askedMonth >= 1 && askedMonth <= 12 ? askedMonth : now.getMonth() + 1;
  const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
  // The browser's own day, so the "same days last month" comparison both
  // screens show is primed with exactly the key they will ask for.
  const askedDay = Number(url.searchParams.get("d"));
  const day = askedDay >= 1 && askedDay <= 31 ? askedDay : now.getDate();
  const through = sameDayBefore(new Date(y, m - 1, day), "month");
  const userId = session.userId;

  await ensureTablesExist();
  // Who this is, what they can see, and whether Trips is on: one row, one
  // question. Asked first, because whether to load trips at all depends on it.
  const account = await getAccountFlags(userId);
  const [trips, people, subscriptions, expensesThis, totalsThis, totalsPrev, categories, notifications] =
    await Promise.all([
      // Four queries, so they are not run for an account with Trips switched off.
      account?.tripsEnabled ? listTrips(userId) : Promise.resolve([]),
      listPeople(userId),
      listSubscriptions(userId),
      listExpenses(userId, { year: y, month: m }),
      categoryTotals(userId, { year: y, month: m }),
      // Only the same days of it, which is what the comparison needs. The whole
      // of last month used to be sent as well - hundreds of rows, for a figure
      // that is one number.
      categoryTotals(userId, { year: py, month: pm, through }),
      listUserCategories(userId),
      listNotifications(userId, NOTIFICATIONS_PRIMED),
    ]);

  const totals = (year: number, month: number, list: typeof totalsThis) => ({
    year,
    month,
    total: list.reduce((sum, c) => sum + c.total, 0),
    categories: list,
  });

  catchUpReminders(userId);

  return NextResponse.json(
    {
      data: {
        "/api/auth/me": {
          user: {
            id: userId,
            username: session.username,
            name: account?.name ?? null,
            isAdmin: session.isAdmin,
            aiAccess: Boolean(account?.aiAccess),
            tripsEnabled: Boolean(account?.tripsEnabled),
            createdAt: account?.createdAt ?? null,
          },
        },
        "/api/people": people,
        "/api/trips": trips,
        "/api/subscriptions": subscriptions,
        [`/api/expenses?year=${y}&month=${m}`]: expensesThis.map(forTheApp),
        [`/api/expenses/categories?year=${y}&month=${m}`]: totals(y, m, totalsThis),
        [`/api/expenses/categories?year=${py}&month=${pm}&through=${through}`]: totals(py, pm, totalsPrev),
        "/api/categories": { categories },
        "/api/notifications": notifications,
      },
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
