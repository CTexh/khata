import { NextResponse } from "next/server";
import { deleteExpenseRow, deleteLedgerTransactions } from "@/lib/db";
import { deleteTrip, getTrip, reopenTrip, tripWriteBacks, updateTrip } from "@/lib/trips-db";
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

// Deleting a trip at any point - a trip started by mistake does not have to be
// closed first. `?undo=1` also takes back what closing it wrote elsewhere: the
// expense in Mera Khata and the Udhar Khata entries. Without it they stay, on
// the reading that the money really did change hands.
export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  const guard = await requireTrip(id);
  if (guard instanceof NextResponse) return guard;

  const undo = new URL(req.url).searchParams.get("undo") === "1";
  const written = undo ? await tripWriteBacks(id) : { expenseId: null, txIds: [] };
  await deleteTrip(id);
  if (written.expenseId) await deleteExpenseRow(guard.userId, written.expenseId).catch(() => undefined);
  await deleteLedgerTransactions(guard.userId, written.txIds).catch(() => undefined);
  return NextResponse.json({ success: true, undone: undo });
}
