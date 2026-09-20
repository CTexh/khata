import { NextResponse } from "next/server";
import { deleteExpenseRow, deleteLedgerTransactions } from "@/lib/db";
import { deleteTrip, getTrip, reopenTrip, updateTrip } from "@/lib/trips-db";
import { DATE, requireTrip } from "../guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const guard = await requireTrip(id);
  if (guard instanceof NextResponse) return guard;
  const trip = await getTrip(guard.userId, id);
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  return NextResponse.json(trip);
}

// Rename, change the dates, or reopen a closed trip. Reopening takes back the
// expense the close wrote into Mera Khata, so closing again cannot count the
// trip twice.
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const guard = await requireTrip(id);
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => ({}));
  if (body.status === "open") {
    const undone = await reopenTrip(id);
    if (undone.expenseId) await deleteExpenseRow(guard.userId, undone.expenseId).catch(() => undefined);
    await deleteLedgerTransactions(guard.userId, undone.txIds).catch(() => undefined);
    return NextResponse.json({ success: true });
  }

  const fields: { name?: string; startDate?: string | null; endDate?: string | null } = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 80);
    if (!name) return NextResponse.json({ error: "Give the trip a name" }, { status: 400 });
    fields.name = name;
  }
  for (const key of ["startDate", "endDate"] as const) {
    if (body[key] === undefined) continue;
    const value = String(body[key] ?? "").trim() || null;
    if (value && !DATE.test(value)) return NextResponse.json({ error: "That date doesn't look right" }, { status: 400 });
    fields[key] = value;
  }
  await updateTrip(id, fields);
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const guard = await requireTrip(id);
  if (guard instanceof NextResponse) return guard;
  await deleteTrip(id);
  return NextResponse.json({ success: true });
}
