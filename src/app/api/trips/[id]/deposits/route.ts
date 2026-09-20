import { NextResponse } from "next/server";
import { addTripDeposit, memberBelongsToTrip } from "@/lib/trips-db";
import { requireTrip } from "../../guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Money into the pot. The deposits are the trip's budget - there is no budget
// figure to set separately, because what was actually handed over is the only
// number that can be settled against.
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const guard = await requireTrip(id, { mustBeOpen: true });
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => ({}));
  const amount = Number(body.amount);
  const memberId = String(body.memberId ?? "").trim();
  const note = String(body.note ?? "").trim().slice(0, 140);

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
  }
  if (!(await memberBelongsToTrip(id, memberId))) {
    return NextResponse.json({ error: "They're not on this trip" }, { status: 400 });
  }

  const depositId = await addTripDeposit(id, { memberId, amount: Math.round(amount * 100) / 100, note });
  return NextResponse.json({ id: depositId }, { status: 201 });
}
