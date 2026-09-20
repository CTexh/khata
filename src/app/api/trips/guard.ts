// What every trip route has to do first: check the caller is signed in, that
// the trip is theirs, and - for anything that changes money - that the trip is
// still open. A closed trip has a settle-up list built from its numbers, so
// letting an expense in behind it would make that list a lie.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { tripBelongsToUser, tripStatus, type TripSpendInput } from "@/lib/trips-db";

export async function requireTrip(
  tripId: string,
  opts: { mustBeOpen?: boolean } = {}
): Promise<{ userId: string } | NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await tripBelongsToUser(tripId, session.userId))) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  if (opts.mustBeOpen && (await tripStatus(tripId)) !== "open") {
    return NextResponse.json({ error: "This trip is closed. Reopen it to make changes." }, { status: 409 });
  }
  return { userId: session.userId };
}

export const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The body of an expense, checked. `participants` is who it was split between;
// an empty list means everyone on the trip, which is what most expenses are.
export function parseSpend(body: Record<string, unknown>): TripSpendInput | string {
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return "Amount must be a positive number";

  const spentAtRaw = String(body.spentAt ?? "").trim();
  if (spentAtRaw && !DATE.test(spentAtRaw) && Number.isNaN(Date.parse(spentAtRaw))) return "That date doesn't look right";
  const spentAt = spentAtRaw ? (DATE.test(spentAtRaw) ? `${spentAtRaw}T12:00:00Z` : spentAtRaw) : new Date().toISOString();

  const paidFrom = body.paidFrom === "member" ? "member" : "pot";
  const payerMemberId = String(body.payerMemberId ?? "").trim() || null;
  if (paidFrom === "member" && !payerMemberId) return "Say who paid for this";

  const participants = Array.isArray(body.participants)
    ? [...new Set(body.participants.map((p) => String(p)).filter(Boolean))]
    : [];

  return {
    amount: Math.round(amount * 100) / 100,
    vendor: String(body.vendor ?? "").trim() || null,
    note: String(body.note ?? "").trim(),
    category: String(body.category ?? "").trim() || null,
    spentAt,
    paidFrom,
    payerMemberId,
    participants,
  };
}
