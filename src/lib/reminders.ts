// What is due on a given day, and what a day's recap contains. No database or
// network here - the scheduled job gathers the data - so this runs under the
// scripts/ tests.
//
// Reminders are delivered as notifications (see lib/push.ts):
// - a subscription, the evening before it is due and on the day if unpaid
// - someone who owes you, on the follow-up date you set
// - a recap of the day before, each morning
// - on the 1st, the month just ended
import { addDays } from "./expense-parse.ts";

export type ReminderSubscription = {
  id: string;
  name: string;
  amount: number;
  active: boolean;
  due_day: number;
  current_period: string; // YYYY-MM
  current_due_date: string; // YYYY-MM-DD
  paid_this_period: boolean;
};

export type ReminderPerson = { id: string; name: string; balance: number; dueDate: string | null };

export type SummaryData = {
  label: string; // "August 2026"
  total: number;
  count: number;
  top: { category: string; total: number }[];
};

// One reminder, with the key that stops it being sent twice.
export type ReminderItem = { key: string; id: string; name: string; amount: number; date: string };

export type DueReminders = {
  subsTomorrow: ReminderItem[];
  subsToday: ReminderItem[];
  reachOut: ReminderItem[];
};

// A subscription already paid this month is next due next month.
export function nextDueAfter(period: string, dueDay: number): string {
  const [y, m] = period.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(dueDay, last)).padStart(2, "0")}`;
}

export function findDue(today: string, subs: ReminderSubscription[], people: ReminderPerson[]): DueReminders {
  const tomorrow = addDays(today, 1);
  const subsTomorrow: ReminderItem[] = [];
  const subsToday: ReminderItem[] = [];
  for (const s of subs) {
    if (!s.active) continue;
    const upcoming = s.paid_this_period ? nextDueAfter(s.current_period, s.due_day) : s.current_due_date;
    const item = (when: string, stage: string): ReminderItem => ({
      key: `sub:${s.id}:${when}:${stage}`,
      id: s.id,
      name: s.name,
      amount: s.amount,
      date: when,
    });
    if (upcoming === tomorrow) subsTomorrow.push(item(upcoming, "before"));
    if (!s.paid_this_period && s.current_due_date === today) subsToday.push(item(today, "due"));
  }
  const reachOut = people
    .filter((p) => p.dueDate === today && p.balance >= 0.005)
    .map((p) => ({ key: `udhar:${p.id}:${today}`, id: p.id, name: p.name, amount: p.balance, date: today }));
  return { subsTomorrow, subsToday, reachOut };
}

// The monthly summary goes out on the 1st, about the month just ended.
export function summaryMonth(today: string): { year: number; month: number; key: string } | null {
  const [y, m, d] = today.split("-").map(Number);
  if (d !== 1) return null;
  const year = m === 1 ? y - 1 : y;
  const month = m === 1 ? 12 : m - 1;
  return { year, month, key: `summary:${year}-${String(month).padStart(2, "0")}` };
}

/* ---------- the daily recap ---------- */

// The UTC instants a Pakistan calendar day starts and ends, for comparing with
// created_at / paid_at timestamps (Pakistan is UTC+5 all year).
export function pakistanDayWindow(date: string): { from: string; to: string } {
  const start = Date.parse(`${date}T00:00:00+05:00`);
  return { from: new Date(start).toISOString(), to: new Date(start + 86_400_000).toISOString() };
}

export type RecapData = {
  date: string; // the Pakistan day being summarised
  expenses: { label: string; amount: number }[];
  ledger: { name: string; amount: number }[]; // positive = lent, negative = paid back
  subsDue: { name: string; amount: number; paid: boolean }[];
  subsPaid: { name: string; amount: number }[]; // marked paid that day
};

// A day on which nothing at all was recorded - no expense, no Udhar Khata
// entry, no subscription due or paid - has nothing worth an email. The nudge
// to add what you forgot only means something when something happened.
export function recapIsEmpty(recap: RecapData): boolean {
  return (
    recap.expenses.length === 0 &&
    recap.ledger.length === 0 &&
    recap.subsDue.length === 0 &&
    recap.subsPaid.length === 0
  );
}

type RecapSources = {
  expenses: (fromDate: string, toDate: string) => Promise<{ amount: number; vendor?: string | null; note: string; category?: string | null }[]>;
  ledger: (fromIso: string, toIso: string) => Promise<{ name: string; amount: number }[]>;
  subscriptions: () => Promise<
    { name: string; amount: number; active: boolean | number; history: { due_date: string; paid_at: string | null }[] }[]
  >;
};

// Gathers one day's recap. The data comes through `sources`, so this stays
// free of the database and can be tested on its own.
export async function buildRecap(date: string, sources: RecapSources): Promise<RecapData> {
  const { from, to } = pakistanDayWindow(date);
  const [expenses, ledger, subs] = await Promise.all([
    sources.expenses(date, date),
    sources.ledger(from, to),
    sources.subscriptions(),
  ]);
  return {
    date,
    expenses: expenses.map((e) => {
      const note = e.note.replace(/^(WhatsApp|Assistant):\s*/, "");
      const what = e.vendor || note || "Expense";
      return { label: e.category ? `${what} · ${e.category}` : what, amount: e.amount };
    }),
    ledger: ledger.map((l) => ({ name: l.name, amount: l.amount })),
    subsDue: subs.flatMap((s) =>
      s.history.filter((h) => h.due_date === date).map((h) => ({ name: s.name, amount: s.amount, paid: Boolean(h.paid_at) }))
    ),
    subsPaid: subs.flatMap((s) =>
      s.history
        .filter((h) => h.paid_at && h.paid_at >= from && h.paid_at < to)
        .map(() => ({ name: s.name, amount: s.amount }))
    ),
  };
}
