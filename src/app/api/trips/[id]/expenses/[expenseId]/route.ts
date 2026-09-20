import { NextResponse } from "next/server";
import { deleteTripExpense, expenseBelongsToTrip, getTrip, updateTripExpense } from "@/lib/trips-db";
import { parseSpend, requireTrip } from "../../../guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; expenseId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const { id, expenseId } = await params;
  const guard = await requireTrip(id, { mustBeOpen: true });
  if (guard instanceof NextResponse) return guard;
  if (!(await expenseBelongsToTrip(id, expenseId))) {
    return NextResponse.json({ error: "That expense isn't on this trip" }, { status: 404 });
  }

  const parsed = parseSpend(await req.json().catch(() => ({})));
  if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });

  const trip = await getTrip(guard.userId, id);
  const known = new Set(trip?.members.map((m) => m.id) ?? []);
  if (parsed.participants.some((p) => !known.has(p))) {
    return NextResponse.json({ error: "Someone on that list isn't on this trip" }, { status: 400 });
  }
  if (parsed.paidFrom === "member" && !known.has(parsed.payerMemberId ?? "")) {
    return NextResponse.json({ error: "Whoever paid isn't on this trip" }, { status: 400 });
  }

  await updateTripExpense(id, expenseId, parsed);
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id, expenseId } = await params;
  const guard = await requireTrip(id, { mustBeOpen: true });
  if (guard instanceof NextResponse) return guard;
  await deleteTripExpense(id, expenseId);
  return NextResponse.json({ success: true });
}
