import { NextResponse, after } from "next/server";
import { getSession } from "@/lib/auth";
import {
  categoryTotals,
  ensureTablesExist,
  findUserById,
  getNotificationRecipient,
  listExpenses,
  listNotifications,
  listPeople,
  listSubscriptions,
  listUserCategories,
  userHasAi,
} from "@/lib/db";
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
  const userId = session.userId;

  await ensureTablesExist();
  const [user, aiAccess, people, subscriptions, expensesThis, expensesPrev, totalsThis, totalsPrev, categories, notifications] = await Promise.all([
    findUserById(userId),
    userHasAi(userId),
    listPeople(userId),
    listSubscriptions(userId),
    listExpenses(userId, { year: y, month: m }),
    listExpenses(userId, { year: py, month: pm }),
    categoryTotals(userId, { year: y, month: m }),
    categoryTotals(userId, { year: py, month: pm }),
    listUserCategories(userId),
    listNotifications(userId),
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
            name: user?.name ?? null,
            isAdmin: session.isAdmin,
            aiAccess,
            createdAt: user?.created_at ?? null,
          },
        },
        "/api/people": people,
        "/api/subscriptions": subscriptions,
        [`/api/expenses?year=${y}&month=${m}`]: expensesThis,
        [`/api/expenses?year=${py}&month=${pm}`]: expensesPrev,
        [`/api/expenses/categories?year=${y}&month=${m}`]: totals(y, m, totalsThis),
        [`/api/expenses/categories?year=${py}&month=${pm}`]: totals(py, pm, totalsPrev),
        "/api/categories": { categories },
        "/api/notifications": notifications,
      },
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
