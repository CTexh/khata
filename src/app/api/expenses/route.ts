import { NextResponse } from "next/server";
import { db, listExpenses, findUserByUsername } from "@/lib/db";
import { getSession, verifyRoutineSecret } from "@/lib/auth";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

// The automated email-sync routine has no session — it authenticates with
// x-routine-secret instead and always acts as the "walli" account. Shared by
// GET and POST so both paths resolve identity the exact same way.
async function resolveUserId(req: Request): Promise<string | NextResponse> {
  const session = await getSession();
  if (session) return session.userId;

  if (verifyRoutineSecret(req.headers.get("x-routine-secret"))) {
    const walliUser = await findUserByUsername("walli");
    if (!walliUser) {
      return NextResponse.json({ error: "Admin user not found" }, { status: 500 });
    }
    return walliUser.id;
  }

  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}

export async function GET(req: Request) {
  const resolved = await resolveUserId(req);
  if (resolved instanceof NextResponse) return resolved;
  const userId = resolved;

  const url = new URL(req.url);
  const now = new Date();
  const year = Number(url.searchParams.get("year")) || now.getFullYear();
  const monthParam = url.searchParams.get("month");
  const month = monthParam ? Number(monthParam) : undefined;

  const expenses = await listExpenses(userId, { year, month });
  return NextResponse.json(expenses);
}

export async function POST(req: Request) {
  const resolved = await resolveUserId(req);
  if (resolved instanceof NextResponse) return resolved;
  const userId = resolved;

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
