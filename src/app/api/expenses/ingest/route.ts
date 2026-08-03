import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

interface IngestExpense {
  amount: number;
  note: string;
  expense_date: string;
  payment_method?: string;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  if (!Array.isArray(body.expenses)) {
    return NextResponse.json({ error: "Expected expenses array" }, { status: 400 });
  }

  const expenses = body.expenses as IngestExpense[];
  const c = await db();
  let created = 0;
  let skipped = 0;

  for (const exp of expenses) {
    const amount = Number(exp.amount);
    let note = String(exp.note ?? "").trim();

    if (exp.payment_method) {
      note = note ? `${note} (${exp.payment_method})` : exp.payment_method;
    }

    const expenseDate = String(exp.expense_date ?? "").trim();

    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) continue;

    // Check for duplicate: same amount, date, and note
    const rs = await c.execute({
      sql: "SELECT id FROM expenses WHERE user_id = ? AND amount = ? AND expense_date = ? AND note = ?",
      args: [session.userId, amount, expenseDate, note],
    });

    if (rs.rows.length > 0) {
      skipped++;
      continue;
    }

    // Create new expense
    const id = randomUUID();
    await c.execute({
      sql: "INSERT INTO expenses (id, user_id, amount, note, expense_date, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: [id, session.userId, amount, note, expenseDate, new Date().toISOString()],
    });
    created++;
  }

  return NextResponse.json({
    success: true,
    created,
    skipped,
    total: expenses.length,
    message: `Ingested ${created} new expenses, skipped ${skipped} duplicate(s)`,
  });
}
