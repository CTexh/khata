import { NextResponse } from "next/server";
import { categoryTotals } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Spending grouped by category. Omit `month` for a whole-year breakdown.
// `through=YYYY-MM-DD` stops at that day, so the same days of an earlier
// period can be compared with a period still running.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();
  const monthParam = url.searchParams.get("month");
  const month = monthParam ? Number(monthParam) : undefined;
  const throughParam = url.searchParams.get("through") ?? "";
  const through = /^\d{4}-\d{2}-\d{2}$/.test(throughParam) ? throughParam : undefined;

  const categories = await categoryTotals(session.userId, { year, month, through });
  const total = categories.reduce((s, c) => s + c.total, 0);

  return NextResponse.json({ year, month: month ?? null, through: through ?? null, total, categories });
}
