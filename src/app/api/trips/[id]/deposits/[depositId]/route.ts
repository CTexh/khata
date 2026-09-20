import { NextResponse } from "next/server";
import { deleteTripDeposit } from "@/lib/trips-db";
import { requireTrip } from "../../../guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; depositId: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  const { id, depositId } = await params;
  const guard = await requireTrip(id, { mustBeOpen: true });
  if (guard instanceof NextResponse) return guard;
  await deleteTripDeposit(id, depositId);
  return NextResponse.json({ success: true });
}
