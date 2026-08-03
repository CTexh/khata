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
  let userId: string | null = null;
  const routineSecret = req.headers.get("x-routine-secret");
  const expectedSecret = "test-secret-123";

  // Debug: return the secret we received to see what's happening
  if (!routineSecret) {
    return NextResponse.json({ debug: "no secret header received", allHeaders: Object.fromEntries(req.headers.entries()) });
  }

  if (routineSecret !== expectedSecret) {
    return NextResponse.json({ debug: "secret mismatch", received: routineSecret, expected: expectedSecret });
  }

  // Secret matched, get walli user
  const walliUser = await findUserByUsername("walli");
  if (!walliUser) {
    return NextResponse.json({ error: "Admin user not found" }, { status: 500 });
  }
  userId = walliUser.id;

  const body = await req.json();
  const amount = Number(body.amount);
  const note = String(body.note ?? "").trim();
  const expenseDate = String(body.date ?? "").trim();
  const vendor = String(body.vendor ?? "").trim() || null;
  const category = String(body.category ?? "").trim() || null;

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const c = await db();
  const id = randomUUID();
  await c.execute({
    sql: "INSERT INTO expenses (id, user_id, amount, note, expense_date, created_at, vendor, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [id, userId, amount, note, expenseDate, new Date().toISOString(), vendor, category],
  });
  return NextResponse.json({ id }, { status: 201 });
}
