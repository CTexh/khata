import { NextResponse } from "next/server";
import { categoryTotals } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Spending grouped by category. Omit `month` for a whole-year breakdown.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();
  const monthParam = url.searchParams.get("month");
  const month = monthParam ? Number(monthParam) : undefined;

  const categories = await categoryTotals(session.userId, { year, month });
  const total = categories.reduce((s, c) => s + c.total, 0);

  return NextResponse.json({ year, month: month ?? null, total, categories });
}
