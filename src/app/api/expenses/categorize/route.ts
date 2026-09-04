import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureCategoryTables, resolveExpenseCategory } from "@/lib/db";

export const dynamic = "force-dynamic";

// Suggests a category for a vendor/note the user is currently typing, so the
// Log-expense form can fill it in ahead of them. Read-only: nothing is saved
// and nothing is learned until the expense itself is submitted.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const vendor = String(body.vendor ?? "").trim() || null;
  const note = String(body.note ?? "").trim() || null;

  if (!vendor && !note) return NextResponse.json({ category: null, source: "none" });

  await ensureCategoryTables();
  const resolved = await resolveExpenseCategory({
    userId: session.userId,
    vendor,
    note,
    provided: null,
  });

  return NextResponse.json({ category: resolved.category, source: resolved.source });
}
