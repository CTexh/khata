import { NextResponse } from "next/server";
import {
  db,
  listExpenses,
  findUserByUsername,
  ensureCategoryTables,
  resolveExpenseCategory,
  upsertVendorRule,
} from "@/lib/db";
import { getSession, verifyRoutineSecret } from "@/lib/auth";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

type Caller = { userId: string; viaRoutine: boolean };

// The automated email-sync routine has no session — it authenticates with
// x-routine-secret instead and always acts as the "walli" account. Shared by
// GET and POST so both paths resolve identity the exact same way.
//
// `viaRoutine` matters for categorisation: a category typed by a human is an
// instruction worth remembering for that payee, whereas one scraped out of a
// bank email is just a guess and must not be learned from.
async function resolveCaller(req: Request): Promise<Caller | NextResponse> {
  const session = await getSession();
  if (session) return { userId: session.userId, viaRoutine: false };

  if (verifyRoutineSecret(req.headers.get("x-routine-secret"))) {
    const walliUser = await findUserByUsername("walli");
    if (!walliUser) {
      return NextResponse.json({ error: "Admin user not found" }, { status: 500 });
    }
    return { userId: walliUser.id, viaRoutine: true };
  }

  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}

export async function GET(req: Request) {
  const resolved = await resolveCaller(req);
  if (resolved instanceof NextResponse) return resolved;
  const { userId } = resolved;

  const url = new URL(req.url);
  const now = new Date();
  const year = Number(url.searchParams.get("year")) || now.getFullYear();
  const monthParam = url.searchParams.get("month");
  const month = monthParam ? Number(monthParam) : undefined;

  const expenses = await listExpenses(userId, { year, month });
  return NextResponse.json(expenses);
}

export async function POST(req: Request) {
  const resolved = await resolveCaller(req);
  if (resolved instanceof NextResponse) return resolved;
  const { userId, viaRoutine } = resolved;

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

  await ensureCategoryTables();
  const resolvedCategory = await resolveExpenseCategory({
    userId,
    vendor,
    note,
    provided: category,
    // A category typed into the form is a decision; one scraped from a bank
    // email is only a suggestion the rules are allowed to overrule.
    explicit: !viaRoutine,
  });

  const c = await db();
  const id = randomUUID();
  await c.execute({
    sql: "INSERT INTO expenses (id, user_id, amount, note, expense_date, expense_datetime, created_at, vendor, category, vendor_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      id,
      userId,
      amount,
      note,
      expenseDate,
      expenseDateTime,
      new Date().toISOString(),
      vendor,
      resolvedCategory.category,
      resolvedCategory.vendorKey || null,
    ],
  });

  // A human picking a category for a payee teaches it permanently.
  if (!viaRoutine && category && resolvedCategory.vendorKey) {
    await upsertVendorRule(userId, resolvedCategory.vendorKey, resolvedCategory.category ?? category);
  }
  return NextResponse.json({ id, category: resolvedCategory.category }, { status: 201 });
}
