// Trip money: splitting a bill, working out where everyone stands, and the
// shortest set of payments that squares the group up.
//
// Every sum here is done in paisa as whole numbers, and only turned back into
// rupees at the end. Splitting Rs 1,000 three ways in floating point leaves
// 0.3333… each and a balance that never quite reaches zero; in paisa it is
// 33,334 + 33,333 + 33,333, which adds back to exactly what was spent.
//
// This file is pure - no database, no dates, no app - so scripts/test-trip-split.ts
// can run it straight from node.

export type TripMemberInput = { id: string };
export type TripDepositInput = { memberId: string; amount: number };
export type TripExpenseInput = {
  amount: number;
  // Out of the common pot, or from one person's own pocket.
  paidFrom: "pot" | "member";
  payerMemberId?: string | null;
  // Who it was for. Empty means everyone on the trip.
  participants: string[];
};

export type MemberState = {
  memberId: string;
  // What they put into the pot.
  deposited: number;
  // What they paid for out of their own pocket.
  paidOutOfPocket: number;
  // Their share of everything the trip spent.
  share: number;
  // Positive: the trip owes them. Negative: they owe the trip.
  net: number;
};

export type TripState = {
  members: MemberState[];
  potIn: number;
  potSpent: number;
  potLeft: number;
  totalSpent: number;
};

// `from` is a member id, or "pot" when the money comes out of what is left in
// the kitty rather than from a person.
export const POT = "pot";
export type Transfer = { from: string; to: string; amount: number };

const paisa = (rupees: number) => Math.round((Number(rupees) || 0) * 100);
const rupees = (p: number) => p / 100;

// Divides an amount between people to the last paisa. The remainder - never
// more than a few paisa - goes to the first members in the list, so the same
// expense always splits the same way and the parts always add back to the whole.
export function splitEqually(amount: number, memberIds: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!memberIds.length) return out;
  const total = paisa(amount);
  const base = Math.trunc(total / memberIds.length);
  let left = total - base * memberIds.length;
  // A negative total (a refund) hands its remainder out the same way.
  const step = left < 0 ? -1 : 1;
  for (const id of memberIds) {
    const extra = left !== 0 ? step : 0;
    out[id] = rupees(base + extra);
    left -= extra;
  }
  return out;
}

// Where everyone stands right now. Deposits and out-of-pocket payments count
// in someone's favour; their share of the spending counts against them.
export function tripState(input: {
  members: TripMemberInput[];
  deposits: TripDepositInput[];
  expenses: TripExpenseInput[];
}): TripState {
  const ids = input.members.map((m) => m.id);
  const known = new Set(ids);
  const zero = () => Object.fromEntries(ids.map((id) => [id, 0])) as Record<string, number>;
  const deposited = zero();
  const paidOutOfPocket = zero();
  const share = zero();

  let potIn = 0;
  for (const d of input.deposits) {
    if (!known.has(d.memberId)) continue;
    const amount = paisa(d.amount);
    deposited[d.memberId] += amount;
    potIn += amount;
  }

  let potSpent = 0;
  let totalSpent = 0;
  for (const e of input.expenses) {
    const amount = paisa(e.amount);
    totalSpent += amount;
    if (e.paidFrom === "pot") {
      potSpent += amount;
    } else if (e.payerMemberId && known.has(e.payerMemberId)) {
      paidOutOfPocket[e.payerMemberId] += amount;
    }
    // No one ticked means it was for the whole group.
    const chosen = e.participants.filter((id) => known.has(id));
    const between = chosen.length ? chosen : ids;
    if (!between.length) continue;
    const parts = splitEqually(rupees(amount), between);
    for (const id of between) share[id] += paisa(parts[id]);
  }

  return {
    members: ids.map((id) => ({
      memberId: id,
      deposited: rupees(deposited[id]),
      paidOutOfPocket: rupees(paidOutOfPocket[id]),
      share: rupees(share[id]),
      net: rupees(deposited[id] + paidOutOfPocket[id] - share[id]),
    })),
    potIn: rupees(potIn),
    potSpent: rupees(potSpent),
    potLeft: rupees(potIn - potSpent),
    totalSpent: rupees(totalSpent),
  };
}

// The fewest payments that leave everyone square. Whatever is still in the pot
// is handed back first - it is cash already sitting there - and only then do
// the people who owe pay the people who are owed, biggest to biggest.
export function settlementPlan(members: MemberState[], potLeft: number): Transfer[] {
  // Biggest first, and for equal amounts the order the trip lists them in, so
  // the same trip always produces the same list.
  const creditors = members
    .map((m, i) => ({ id: m.memberId, amount: paisa(m.net), i }))
    .filter((m) => m.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.i - b.i);
  const debtors = members
    .map((m, i) => ({ id: m.memberId, amount: -paisa(m.net), i }))
    .filter((m) => m.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.i - b.i);

  const transfers: Transfer[] = [];
  let pot = Math.max(0, paisa(potLeft));
  for (const creditor of creditors) {
    if (pot <= 0) break;
    const amount = Math.min(pot, creditor.amount);
    if (amount <= 0) continue;
    transfers.push({ from: POT, to: creditor.id, amount: rupees(amount) });
    creditor.amount -= amount;
    pot -= amount;
  }

  let d = 0;
  for (const creditor of creditors) {
    while (creditor.amount > 0 && d < debtors.length) {
      const debtor = debtors[d];
      if (debtor.amount <= 0) {
        d++;
        continue;
      }
      const amount = Math.min(debtor.amount, creditor.amount);
      transfers.push({ from: debtor.id, to: creditor.id, amount: rupees(amount) });
      debtor.amount -= amount;
      creditor.amount -= amount;
      if (debtor.amount <= 0) d++;
    }
  }
  return transfers;
}

// What the trip actually cost one person: their share of the spending. This is
// what goes into Mera Khata when a trip is closed - not what they paid out,
// which the others pay back.
export function costToMember(state: TripState, memberId: string): number {
  return state.members.find((m) => m.memberId === memberId)?.share ?? 0;
}
