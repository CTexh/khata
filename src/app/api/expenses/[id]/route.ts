import { NextResponse } from "next/server";
import { db, getExpense } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  const existing = await getExpense(id, session.userId);
  if (!existing) return NextResponse.json({ error: "Expense not found" }, { status: 404 });

  const body = await req.json();
  const amount = Number(body.amount);
  const note = String(body.note ?? "").trim();
  const expenseDate = String(body.date ?? "").trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const c = await db();
  await c.execute({
    sql: "UPDATE expenses SET amount = ?, note = ?, expense_date = ? WHERE id = ? AND user_id = ?",
    args: [amount, note, expenseDate, id, session.userId],
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  const existing = await getExpense(id, session.userId);
  if (!existing) return NextResponse.json({ error: "Expense not found" }, { status: 404 });

  const c = await db();
  await c.execute({
    sql: "DELETE FROM expenses WHERE id = ? AND user_id = ?",
    args: [id, session.userId],
  });
  return NextResponse.json({ ok: true });
}
