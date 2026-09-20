// Reading and writing trips. The money itself is never stored worked-out:
// rows say who deposited what, what was spent and who it was for, and
// lib/trip-split.ts turns that into balances on read. Editing one expense can
// therefore never leave a stale share behind.
//
// The tables and their schema gate live in lib/db.ts, next to the others.
import { randomUUID } from "node:crypto";
import { db, ensureTripTables } from "@/lib/db";
import { settlementPlan, tripState, type TripState, type Transfer } from "@/lib/trip-split";

export type TripStatus = "open" | "closed";

export type TripMember = { id: string; name: string; isMe: boolean; personId: string | null };
export type TripDeposit = { id: string; memberId: string; amount: number; note: string; createdAt: string };
export type TripSpend = {
  id: string;
  amount: number;
  vendor: string | null;
  note: string;
  category: string | null;
  spentAt: string;
  paidFrom: "pot" | "member";
  payerMemberId: string | null;
  participants: string[];
};
export type TripSettlement = {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  amount: number;
  paidAt: string | null;
  personId: string | null;
};

export type TripSummary = {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  status: TripStatus;
  createdAt: string;
  closedAt: string | null;
  members: TripMember[];
  totalSpent: number;
  potIn: number;
  potLeft: number;
  // Where the trip's owner stands: positive means the trip owes them.
  myNet: number;
};

export type TripDetail = TripSummary & {
  expenseId: string | null;
  deposits: TripDeposit[];
  expenses: TripSpend[];
  settlements: TripSettlement[];
  state: TripState;
  // What is still owed if the trip were settled up right now.
  settleUp: Transfer[];
};

const rowMember = (r: Record<string, unknown>): TripMember => ({
  id: r.id as string,
  name: r.name as string,
  isMe: Number(r.is_me) === 1,
  personId: (r.person_id as string | null) ?? null,
});

const rowDeposit = (r: Record<string, unknown>): TripDeposit => ({
  id: r.id as string,
  memberId: r.member_id as string,
  amount: Number(r.amount),
  note: (r.note as string) ?? "",
  createdAt: r.created_at as string,
});

const rowSettlement = (r: Record<string, unknown>): TripSettlement => ({
  id: r.id as string,
  fromMemberId: r.from_member_id as string,
  toMemberId: r.to_member_id as string,
  amount: Number(r.amount),
  paidAt: (r.paid_at as string | null) ?? null,
  personId: (r.person_id as string | null) ?? null,
});

function rowSpend(r: Record<string, unknown>, participants: string[]): TripSpend {
  return {
    id: r.id as string,
    amount: Number(r.amount),
    vendor: (r.vendor as string | null) ?? null,
    note: (r.note as string) ?? "",
    category: (r.category as string | null) ?? null,
    spentAt: r.spent_at as string,
    paidFrom: (r.paid_from as string) === "member" ? "member" : "pot",
    payerMemberId: (r.payer_member_id as string | null) ?? null,
    participants,
  };
}

export async function tripBelongsToUser(tripId: string, userId: string): Promise<boolean> {
  await ensureTripTables();
  const rs = await db().execute({ sql: "SELECT 1 FROM trips WHERE id = ? AND user_id = ?", args: [tripId, userId] });
  return rs.rows.length > 0;
}

export async function tripStatus(tripId: string): Promise<TripStatus | null> {
  const rs = await db().execute({ sql: "SELECT status FROM trips WHERE id = ?", args: [tripId] });
  const status = rs.rows[0]?.status as string | undefined;
  return status === "closed" ? "closed" : status === "open" ? "open" : null;
}

// Every trip this account has, with enough worked out for the list: what was
// spent, what is left in the pot, and where the owner stands. Four queries
// whatever the number of trips.
export async function listTrips(userId: string): Promise<TripSummary[]> {
  await ensureTripTables();
  const c = await db();
  const [trips, members, deposits, expenses] = await Promise.all([
    c.execute({
      sql: `SELECT id, name, start_date, end_date, status, created_at, closed_at FROM trips
            WHERE user_id = ? ORDER BY (status = 'closed'), COALESCE(start_date, created_at) DESC`,
      args: [userId],
    }),
    c.execute({
      sql: `SELECT m.* FROM trip_members m JOIN trips t ON t.id = m.trip_id
            WHERE t.user_id = ? ORDER BY m.is_me DESC, m.created_at`,
      args: [userId],
    }),
    c.execute({
      sql: `SELECT d.trip_id, d.member_id, d.amount FROM trip_deposits d JOIN trips t ON t.id = d.trip_id
            WHERE t.user_id = ?`,
      args: [userId],
    }),
    c.execute({
      sql: `SELECT e.id, e.trip_id, e.amount, e.paid_from, e.payer_member_id,
                   (SELECT GROUP_CONCAT(s.member_id) FROM trip_expense_shares s WHERE s.expense_id = e.id) AS shares
            FROM trip_expenses e JOIN trips t ON t.id = e.trip_id WHERE t.user_id = ?`,
      args: [userId],
    }),
  ]);

  const byTrip = <T>(rows: Record<string, unknown>[], make: (r: Record<string, unknown>) => T) => {
    const map = new Map<string, T[]>();
    for (const r of rows) {
      const key = r.trip_id as string;
      const list = map.get(key) ?? [];
      list.push(make(r));
      map.set(key, list);
    }
    return map;
  };

  const memberRows = byTrip(members.rows as unknown as Record<string, unknown>[], rowMember);
  const depositRows = byTrip(deposits.rows as unknown as Record<string, unknown>[], (r) => ({
    memberId: r.member_id as string,
    amount: Number(r.amount),
  }));
  const expenseRows = byTrip(expenses.rows as unknown as Record<string, unknown>[], (r) => ({
    amount: Number(r.amount),
    paidFrom: ((r.paid_from as string) === "member" ? "member" : "pot") as "pot" | "member",
    payerMemberId: (r.payer_member_id as string | null) ?? null,
    participants: String(r.shares ?? "").split(",").filter(Boolean),
  }));

  return trips.rows.map((r) => {
    const id = r.id as string;
    const tripMembers = memberRows.get(id) ?? [];
    const state = tripState({
      members: tripMembers,
      deposits: depositRows.get(id) ?? [],
      expenses: expenseRows.get(id) ?? [],
    });
    const me = tripMembers.find((m) => m.isMe);
    return {
      id,
      name: r.name as string,
      startDate: (r.start_date as string | null) ?? null,
      endDate: (r.end_date as string | null) ?? null,
      status: (r.status as string) === "closed" ? "closed" : "open",
      createdAt: r.created_at as string,
      closedAt: (r.closed_at as string | null) ?? null,
      members: tripMembers,
      totalSpent: state.totalSpent,
      potIn: state.potIn,
      potLeft: state.potLeft,
      myNet: state.members.find((m) => m.memberId === me?.id)?.net ?? 0,
    } satisfies TripSummary;
  });
}

// One trip, in full: everything the trip screen shows, including where
// everyone stands and what it would take to settle up right now.
export async function getTrip(userId: string, tripId: string): Promise<TripDetail | null> {
  await ensureTripTables();
  const c = await db();
  const rs = await c.execute({
    sql: `SELECT id, name, start_date, end_date, status, created_at, closed_at, expense_id
          FROM trips WHERE id = ? AND user_id = ?`,
    args: [tripId, userId],
  });
  const trip = rs.rows[0];
  if (!trip) return null;

  const [members, deposits, expenses, shares, settlements] = await Promise.all([
    c.execute({ sql: "SELECT * FROM trip_members WHERE trip_id = ? ORDER BY is_me DESC, created_at", args: [tripId] }),
    c.execute({ sql: "SELECT * FROM trip_deposits WHERE trip_id = ? ORDER BY created_at DESC", args: [tripId] }),
    c.execute({ sql: "SELECT * FROM trip_expenses WHERE trip_id = ? ORDER BY spent_at DESC, created_at DESC", args: [tripId] }),
    c.execute({
      sql: `SELECT s.expense_id, s.member_id FROM trip_expense_shares s
            JOIN trip_expenses e ON e.id = s.expense_id WHERE e.trip_id = ?`,
      args: [tripId],
    }),
    c.execute({ sql: "SELECT * FROM trip_settlements WHERE trip_id = ? ORDER BY created_at", args: [tripId] }),
  ]);

  const participants = new Map<string, string[]>();
  for (const r of shares.rows) {
    const key = r.expense_id as string;
    participants.set(key, [...(participants.get(key) ?? []), r.member_id as string]);
  }

  const tripMembers = members.rows.map((r) => rowMember(r as unknown as Record<string, unknown>));
  const tripDeposits = deposits.rows.map((r) => rowDeposit(r as unknown as Record<string, unknown>));
  const tripExpenses = expenses.rows.map((r) =>
    rowSpend(r as unknown as Record<string, unknown>, participants.get(r.id as string) ?? [])
  );
  const state = tripState({ members: tripMembers, deposits: tripDeposits, expenses: tripExpenses });
  const me = tripMembers.find((m) => m.isMe);

  return {
    id: tripId,
    name: trip.name as string,
    startDate: (trip.start_date as string | null) ?? null,
    endDate: (trip.end_date as string | null) ?? null,
    status: (trip.status as string) === "closed" ? "closed" : "open",
    createdAt: trip.created_at as string,
    closedAt: (trip.closed_at as string | null) ?? null,
    expenseId: (trip.expense_id as string | null) ?? null,
    members: tripMembers,
    deposits: tripDeposits,
    expenses: tripExpenses,
    settlements: settlements.rows.map((r) => rowSettlement(r as unknown as Record<string, unknown>)),
    state,
    settleUp: settlementPlan(state.members, state.potLeft),
    totalSpent: state.totalSpent,
    potIn: state.potIn,
    potLeft: state.potLeft,
    myNet: state.members.find((m) => m.memberId === me?.id)?.net ?? 0,
  };
}

// A trip and everyone on it, in one batch. The owner is always a member -
// they are on the trip too, and the settle-up has to know where they stand.
export async function createTrip(
  userId: string,
  opts: { name: string; startDate?: string | null; endDate?: string | null; myName: string; memberNames: string[] }
): Promise<string> {
  await ensureTripTables();
  const c = await db();
  const id = randomUUID();
  const now = new Date().toISOString();
  const names = [opts.myName, ...opts.memberNames];
  await c.batch(
    [
      {
        sql: `INSERT INTO trips (id, user_id, name, start_date, end_date, status, created_at)
              VALUES (?, ?, ?, ?, ?, 'open', ?)`,
        args: [id, userId, opts.name, opts.startDate ?? null, opts.endDate ?? null, now],
      },
      ...names.map((name, i) => ({
        sql: `INSERT INTO trip_members (id, trip_id, name, is_me, person_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)`,
        args: [randomUUID(), id, name, i === 0 ? 1 : 0, now],
      })),
    ],
    "write"
  );
  return id;
}

export async function updateTrip(
  tripId: string,
  fields: { name?: string; startDate?: string | null; endDate?: string | null }
): Promise<void> {
  const sets: string[] = [];
  const args: (string | null)[] = [];
  if (fields.name !== undefined) {
    sets.push("name = ?");
    args.push(fields.name);
  }
  if (fields.startDate !== undefined) {
    sets.push("start_date = ?");
    args.push(fields.startDate);
  }
  if (fields.endDate !== undefined) {
    sets.push("end_date = ?");
    args.push(fields.endDate);
  }
  if (!sets.length) return;
  await db().execute({ sql: `UPDATE trips SET ${sets.join(", ")} WHERE id = ?`, args: [...args, tripId] });
}

export async function deleteTrip(tripId: string): Promise<void> {
  const c = await db();
  await c.batch(
    [
      {
        sql: `DELETE FROM trip_expense_shares WHERE expense_id IN (SELECT id FROM trip_expenses WHERE trip_id = ?)`,
        args: [tripId],
      },
      { sql: "DELETE FROM trip_expenses WHERE trip_id = ?", args: [tripId] },
      { sql: "DELETE FROM trip_deposits WHERE trip_id = ?", args: [tripId] },
      { sql: "DELETE FROM trip_settlements WHERE trip_id = ?", args: [tripId] },
      { sql: "DELETE FROM trip_members WHERE trip_id = ?", args: [tripId] },
      { sql: "DELETE FROM trips WHERE id = ?", args: [tripId] },
    ],
    "write"
  );
}

export async function addTripMember(tripId: string, name: string): Promise<string> {
  const id = randomUUID();
  await db().execute({
    sql: `INSERT INTO trip_members (id, trip_id, name, is_me, person_id, created_at) VALUES (?, ?, ?, 0, NULL, ?)`,
    args: [id, tripId, name, new Date().toISOString()],
  });
  return id;
}

// How much of the trip a member is tangled up in. Someone who has deposited
// money or is on an expense cannot simply be removed - the sums would change
// underneath everyone else.
export async function memberInvolvement(tripId: string, memberId: string): Promise<number> {
  const c = await db();
  const rs = await c.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM trip_deposits WHERE trip_id = ? AND member_id = ?) +
            (SELECT COUNT(*) FROM trip_expenses WHERE trip_id = ? AND payer_member_id = ?) +
            (SELECT COUNT(*) FROM trip_expense_shares s JOIN trip_expenses e ON e.id = s.expense_id
             WHERE e.trip_id = ? AND s.member_id = ?) AS n`,
    args: [tripId, memberId, tripId, memberId, tripId, memberId],
  });
  return Number(rs.rows[0]?.n ?? 0);
}

export async function removeTripMember(tripId: string, memberId: string): Promise<void> {
  await db().execute({
    sql: "DELETE FROM trip_members WHERE id = ? AND trip_id = ? AND is_me = 0",
    args: [memberId, tripId],
  });
}

export async function memberBelongsToTrip(tripId: string, memberId: string): Promise<boolean> {
  const rs = await db().execute({
    sql: "SELECT 1 FROM trip_members WHERE id = ? AND trip_id = ?",
    args: [memberId, tripId],
  });
  return rs.rows.length > 0;
}

export async function addTripDeposit(
  tripId: string,
  opts: { memberId: string; amount: number; note?: string }
): Promise<string> {
  const id = randomUUID();
  await db().execute({
    sql: `INSERT INTO trip_deposits (id, trip_id, member_id, amount, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, tripId, opts.memberId, opts.amount, opts.note ?? "", new Date().toISOString()],
  });
  return id;
}

export async function deleteTripDeposit(tripId: string, depositId: string): Promise<void> {
  await db().execute({ sql: "DELETE FROM trip_deposits WHERE id = ? AND trip_id = ?", args: [depositId, tripId] });
}

export type TripSpendInput = {
  amount: number;
  vendor: string | null;
  note: string;
  category: string | null;
  spentAt: string;
  paidFrom: "pot" | "member";
  payerMemberId: string | null;
  participants: string[];
};

// An expense and the people it was split between, in one batch: a half-written
// expense would quietly change everyone's share.
export async function addTripExpense(tripId: string, input: TripSpendInput): Promise<string> {
  const id = randomUUID();
  const c = await db();
  await c.batch(
    [
      {
        sql: `INSERT INTO trip_expenses (id, trip_id, amount, vendor, note, category, spent_at, paid_from, payer_member_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          tripId,
          input.amount,
          input.vendor,
          input.note,
          input.category,
          input.spentAt,
          input.paidFrom,
          input.paidFrom === "member" ? input.payerMemberId : null,
          new Date().toISOString(),
        ],
      },
      ...input.participants.map((memberId) => ({
        sql: "INSERT INTO trip_expense_shares (expense_id, member_id) VALUES (?, ?)",
        args: [id, memberId],
      })),
    ],
    "write"
  );
  return id;
}

export async function updateTripExpense(tripId: string, expenseId: string, input: TripSpendInput): Promise<void> {
  const c = await db();
  await c.batch(
    [
      {
        sql: `UPDATE trip_expenses SET amount = ?, vendor = ?, note = ?, category = ?, spent_at = ?, paid_from = ?, payer_member_id = ?
              WHERE id = ? AND trip_id = ?`,
        args: [
          input.amount,
          input.vendor,
          input.note,
          input.category,
          input.spentAt,
          input.paidFrom,
          input.paidFrom === "member" ? input.payerMemberId : null,
          expenseId,
          tripId,
        ],
      },
      { sql: "DELETE FROM trip_expense_shares WHERE expense_id = ?", args: [expenseId] },
      ...input.participants.map((memberId) => ({
        sql: "INSERT INTO trip_expense_shares (expense_id, member_id) VALUES (?, ?)",
        args: [expenseId, memberId],
      })),
    ],
    "write"
  );
}

export async function deleteTripExpense(tripId: string, expenseId: string): Promise<void> {
  const c = await db();
  await c.batch(
    [
      { sql: "DELETE FROM trip_expense_shares WHERE expense_id = ?", args: [expenseId] },
      { sql: "DELETE FROM trip_expenses WHERE id = ? AND trip_id = ?", args: [expenseId, tripId] },
    ],
    "write"
  );
}

export async function expenseBelongsToTrip(tripId: string, expenseId: string): Promise<boolean> {
  const rs = await db().execute({
    sql: "SELECT 1 FROM trip_expenses WHERE id = ? AND trip_id = ?",
    args: [expenseId, tripId],
  });
  return rs.rows.length > 0;
}

// Closing a trip freezes what is owed into rows of its own, so the list stays
// put even as it is ticked off. `expenseId` is the Mera Khata expense written
// for the owner's share, kept so reopening can take it back out again.
export async function closeTrip(
  tripId: string,
  transfers: { fromMemberId: string; toMemberId: string; amount: number; personId?: string | null; txId?: string | null }[],
  expenseId: string | null
): Promise<void> {
  const c = await db();
  const now = new Date().toISOString();
  await c.batch(
    [
      { sql: "DELETE FROM trip_settlements WHERE trip_id = ?", args: [tripId] },
      ...transfers.map((t) => ({
        sql: `INSERT INTO trip_settlements (id, trip_id, from_member_id, to_member_id, amount, paid_at, person_id, tx_id, created_at)
              VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        args: [randomUUID(), tripId, t.fromMemberId, t.toMemberId, t.amount, t.personId ?? null, t.txId ?? null, now],
      })),
      {
        sql: "UPDATE trips SET status = 'closed', closed_at = ?, expense_id = ? WHERE id = ?",
        args: [now, expenseId, tripId],
      },
    ],
    "write"
  );
}

// Back to an open trip: the settle-up list goes, and so do the two things the
// close wrote elsewhere - the expense in Mera Khata and any Udhar Khata
// entries - so closing it again cannot count them twice.
export async function reopenTrip(tripId: string): Promise<{ expenseId: string | null; txIds: string[] }> {
  const c = await db();
  const [trip, settlements] = await Promise.all([
    c.execute({ sql: "SELECT expense_id FROM trips WHERE id = ?", args: [tripId] }),
    c.execute({ sql: "SELECT tx_id FROM trip_settlements WHERE trip_id = ? AND tx_id IS NOT NULL", args: [tripId] }),
  ]);
  const expenseId = (trip.rows[0]?.expense_id as string | null) ?? null;
  const txIds = settlements.rows.map((r) => r.tx_id as string);
  await c.batch(
    [
      { sql: "DELETE FROM trip_settlements WHERE trip_id = ?", args: [tripId] },
      { sql: "UPDATE trips SET status = 'open', closed_at = NULL, expense_id = NULL WHERE id = ?", args: [tripId] },
    ],
    "write"
  );
  return { expenseId, txIds };
}

export async function markSettlementPaid(tripId: string, settlementId: string, paid: boolean): Promise<void> {
  await db().execute({
    sql: "UPDATE trip_settlements SET paid_at = ? WHERE id = ? AND trip_id = ?",
    args: [paid ? new Date().toISOString() : null, settlementId, tripId],
  });
}

export async function linkSettlementToPerson(settlementId: string, personId: string): Promise<void> {
  await db().execute({ sql: "UPDATE trip_settlements SET person_id = ? WHERE id = ?", args: [personId, settlementId] });
}

// Ties a trip member to a borrower in Udhar Khata, so what a closed trip
// hands over lands against the same person next time.
export async function setMemberPerson(memberId: string, personId: string): Promise<void> {
  await db().execute({ sql: "UPDATE trip_members SET person_id = ? WHERE id = ?", args: [personId, memberId] });
}
