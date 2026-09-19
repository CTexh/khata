// What is due on a given day. No database or network here - the scheduled
// job gathers the data - so this runs under the scripts/ tests.
//
// Reminders are delivered as notifications (see lib/notify.ts):
// - a subscription, the evening before it is due and on the day if unpaid
// - someone who owes you, on the follow-up date you set
// - at 4am, a nudge to add any expenses missed the day before
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
