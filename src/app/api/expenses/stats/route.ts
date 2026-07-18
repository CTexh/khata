import { NextResponse } from "next/server";
import { allTimeExpenseStats, yearlyExpenseTotals } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();

  const [yearly, allTime] = await Promise.all([
    yearlyExpenseTotals(session.userId, year),
    allTimeExpenseStats(session.userId),
  ]);

  return NextResponse.json({ yearly, allTime });
}
