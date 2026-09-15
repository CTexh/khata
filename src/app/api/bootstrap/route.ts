import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  categoryTotals,
  ensureTablesExist,
  findUserById,
  listExpenses,
  listPeople,
  listSubscriptions,
  listUserCategories,
} from "@/lib/db";

export const dynamic = "force-dynamic";

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
  const [user, people, subscriptions, expensesThis, expensesPrev, totalsThis, totalsPrev, categories] = await Promise.all([
    findUserById(userId),
    listPeople(userId),
    listSubscriptions(userId),
    listExpenses(userId, { year: y, month: m }),
    listExpenses(userId, { year: py, month: pm }),
    categoryTotals(userId, { year: y, month: m }),
    categoryTotals(userId, { year: py, month: pm }),
    listUserCategories(userId),
  ]);

  const totals = (year: number, month: number, list: typeof totalsThis) => ({
    year,
    month,
    total: list.reduce((sum, c) => sum + c.total, 0),
    categories: list,
  });

  return NextResponse.json(
    {
      data: {
        "/api/auth/me": {
          user: {
            id: userId,
            username: session.username,
            name: user?.name ?? null,
            isAdmin: session.isAdmin,
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
      },
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
