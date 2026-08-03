import { NextResponse } from "next/server";
import { db, listExpenses, findUserByUsername } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const now = new Date();
  const year = Number(url.searchParams.get("year")) || now.getFullYear();
  const monthParam = url.searchParams.get("month");
  const month = monthParam ? Number(monthParam) : undefined;

  const expenses = await listExpenses(session.userId, { year, month });
  return NextResponse.json(expenses);
}

export async function POST(req: Request) {
  const session = await getSession();
  let userId: string;

  if (session) {
    // Normal signed-in user creating an expense from the UI
    userId = session.userId;
  } else {
    // No session — allow the automated routine to post as walli via a shared secret
    const routineSecret = req.headers.get("x-routine-secret");
    const expectedSecret = process.env.ROUTINE_SECRET ?? "test-secret-123";
    if (routineSecret !== expectedSecret) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const walliUser = await findUserByUsername("walli");
    if (!walliUser) {
      return NextResponse.json({ error: "Admin user not found" }, { status: 500 });
    }
    userId = walliUser.id;
  }

  const body = await req.json();
  const amount = Number(body.amount);
  const note = String(body.note ?? "").trim();
  let expenseDateTime = String(body.expense_datetime ?? body.date ?? "").trim();
  const vendor = String(body.vendor ?? "").trim() || null;
  const category = String(body.category ?? "").trim() || null;

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
  }

  // Handle both ISO datetime and date-only formats
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?)?$/.test(expenseDateTime)) {
    return NextResponse.json({ error: "Invalid date/time format" }, { status: 400 });
  }

  // If only date provided (no time), add T00:00:00Z
  if (!/T/.test(expenseDateTime)) {
    expenseDateTime = expenseDateTime + "T00:00:00Z";
  }

  // Extract date part for backward compatibility
  const expenseDate = expenseDateTime.substring(0, 10);

  const c = await db();
  const id = randomUUID();
  await c.execute({
    sql: "INSERT INTO expenses (id, user_id, amount, note, expense_date, expense_datetime, created_at, vendor, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [id, userId, amount, note, expenseDate, expenseDateTime, new Date().toISOString(), vendor, category],
  });
  return NextResponse.json({ id }, { status: 201 });
}
