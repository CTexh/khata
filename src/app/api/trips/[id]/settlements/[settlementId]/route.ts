import { NextResponse } from "next/server";
import { markSettlementPaid } from "@/lib/trips-db";
import { requireTrip } from "../../../guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; settlementId: string }> };

// Ticking a payment off, or putting it back if it was ticked by mistake.
export async function PATCH(req: Request, { params }: Params) {
  const { id, settlementId } = await params;
  const guard = await requireTrip(id);
  if (guard instanceof NextResponse) return guard;
  const body = await req.json().catch(() => ({}));
  await markSettlementPaid(id, settlementId, body.paid !== false);
  return NextResponse.json({ success: true });
}
