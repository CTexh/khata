import { NextResponse } from "next/server";
import { addTripExpense, getTrip } from "@/lib/trips-db";
import { parseSpend, requireTrip } from "../../guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Trip spending. It never touches Mera Khata: what the trip costs you is only
// known once it is closed, and until then most of what is spent is other
// people's money.
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const guard = await requireTrip(id, { mustBeOpen: true });
  if (guard instanceof NextResponse) return guard;

  const parsed = parseSpend(await req.json().catch(() => ({})));
  if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });

  const trip = await getTrip(guard.userId, id);
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  const known = new Set(trip.members.map((m) => m.id));
  if (parsed.participants.some((p) => !known.has(p))) {
    return NextResponse.json({ error: "Someone on that list isn't on this trip" }, { status: 400 });
  }
  if (parsed.paidFrom === "member" && !known.has(parsed.payerMemberId ?? "")) {
    return NextResponse.json({ error: "Whoever paid isn't on this trip" }, { status: 400 });
  }

  const expenseId = await addTripExpense(id, parsed);
  return NextResponse.json({ id: expenseId }, { status: 201 });
}
