import { NextResponse } from "next/server";
import { addTripMember, getTrip } from "@/lib/trips-db";
import { requireTrip } from "../../guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Someone joining part-way through. They share only what they are ticked on
// from here, so nothing already recorded moves.
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const guard = await requireTrip(id, { mustBeOpen: true });
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 60);
  if (!name) return NextResponse.json({ error: "Who is joining?" }, { status: 400 });

  const trip = await getTrip(guard.userId, id);
  if (trip?.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
    return NextResponse.json({ error: `${name} is already on this trip` }, { status: 400 });
  }
  const memberId = await addTripMember(id, name);
  return NextResponse.json({ id: memberId }, { status: 201 });
}
