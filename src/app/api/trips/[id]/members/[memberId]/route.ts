import { NextResponse } from "next/server";
import { memberBelongsToTrip, memberInvolvement, removeTripMember } from "@/lib/trips-db";
import { requireTrip } from "../../../guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; memberId: string }> };

// Removing someone only works while they are on nothing. Once they have put
// money in or shared an expense, taking them out would silently change what
// everyone else owes.
export async function DELETE(_req: Request, { params }: Params) {
  const { id, memberId } = await params;
  const guard = await requireTrip(id, { mustBeOpen: true });
  if (guard instanceof NextResponse) return guard;

  if (!(await memberBelongsToTrip(id, memberId))) {
    return NextResponse.json({ error: "They're not on this trip" }, { status: 404 });
  }
  if (await memberInvolvement(id, memberId)) {
    return NextResponse.json(
      { error: "They've already put money in or shared an expense. Remove those first." },
      { status: 409 }
    );
  }
  await removeTripMember(id, memberId);
  return NextResponse.json({ success: true });
}
