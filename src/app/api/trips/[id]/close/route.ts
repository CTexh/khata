import { NextResponse } from "next/server";
import { insertExpense, resolveExpenseCategory, writeLedgerEntries, type LedgerWrite } from "@/lib/db";
import { closeTrip, getTrip, setMemberPerson } from "@/lib/trips-db";
import { POT } from "@/lib/trip-split";
import { requireTrip } from "../../guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Closing a trip: work out the fewest payments that square everyone up, write
// them down so the list stays put while it is ticked off, and - if asked -
// hand the ones involving you to Udhar Khata and book what the trip cost you
// in Mera Khata.
//
// Only your share goes into Mera Khata. What you paid out is mostly other
// people's money coming back to you, and counting that as your spending would
// make every trip look like a disaster.
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const guard = await requireTrip(id, { mustBeOpen: true });
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => ({}));
  const addToMyExpenses = body.addToMyExpenses !== false;
  const pushToUdhar = Boolean(body.pushToUdhar);
  const category = String(body.category ?? "").trim() || null;

  const trip = await getTrip(guard.userId, id);
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  const me = trip.members.find((m) => m.isMe);
  const byId = new Map(trip.members.map((m) => [m.id, m]));

  // Money coming back out of the pot is cash already sitting there, not a debt
  // between two people, so it is never handed to Udhar Khata.
  const mine = trip.settleUp.filter(
    (t) => t.from !== POT && me && (t.from === me.id || t.to === me.id) && t.amount > 0
  );

  // One ledger write per settlement, so each one can remember the transaction
  // it created - that is what lets reopening the trip take it back out again.
  const personFor = new Map<string, string>();
  const txFor = new Map<string, string>();
  if (pushToUdhar) {
    for (const transfer of mine) {
      const otherId = transfer.from === me!.id ? transfer.to : transfer.from;
      const other = byId.get(otherId);
      if (!other) continue;
      // They owe you: money lent. You owe them: the ledger holds it the other
      // way round, as a negative balance.
      const amount = transfer.to === me!.id ? transfer.amount : -transfer.amount;
      const entry: LedgerWrite = other.personId
        ? { personId: other.personId, amount }
        : { newName: other.name, amount };
      const written = await writeLedgerEntries(guard.userId, [entry], `Trip: ${trip.name}`);
      const personId = other.personId ?? written.createdPeople[0] ?? null;
      if (personId) {
        personFor.set(otherId, personId);
        if (!other.personId) await setMemberPerson(otherId, personId).catch(() => undefined);
      }
      if (written.txIds[0]) txFor.set(otherId, written.txIds[0]);
    }
  }

  let expenseId: string | null = null;
  const myShare = me ? trip.state.members.find((m) => m.memberId === me.id)?.share ?? 0 : 0;
  if (addToMyExpenses && myShare > 0) {
    const note = `Trip: ${trip.name}`;
    const resolved = await resolveExpenseCategory({
      userId: guard.userId,
      vendor: trip.name,
      note,
      provided: category,
      explicit: true,
    });
    const day = trip.endDate ?? new Date().toISOString().slice(0, 10);
    expenseId = await insertExpense({
      userId: guard.userId,
      amount: myShare,
      note,
      expenseDateTime: `${day}T12:00:00Z`,
      vendor: trip.name,
      category: resolved.category,
      vendorKey: resolved.vendorKey,
    });
  }

  await closeTrip(
    id,
    trip.settleUp.map((t) => {
      const other = t.from === me?.id ? t.to : t.from;
      return {
        fromMemberId: t.from,
        toMemberId: t.to,
        amount: t.amount,
        personId: personFor.get(other) ?? null,
        txId: txFor.get(other) ?? null,
      };
    }),
    expenseId
  );

  return NextResponse.json({
    settlements: trip.settleUp.length,
    sentToUdhar: pushToUdhar ? mine.length : 0,
    myShare,
    expenseId,
  });
}
