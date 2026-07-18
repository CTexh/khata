import { NextResponse } from "next/server";
import { yearlyExpenseTotals } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();

  const yearly = await yearlyExpenseTotals(session.userId, year);
  return NextResponse.json({ yearly });
}
