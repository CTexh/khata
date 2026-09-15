// What goes into a user's daily reminder email, and how it reads. No database
// or network here - the daily job gathers the data, this decides what is due
// and writes the email - so it runs under the scripts/ tests.
import { fmtRs, fmtDateLabel } from "./format.ts";
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

// One line in the email, with the key that stops it being sent twice.
export type ReminderItem = { key: string; name: string; amount: number; date: string };

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
      name: s.name,
      amount: s.amount,
      date: when,
    });
    if (upcoming === tomorrow) subsTomorrow.push(item(upcoming, "before"));
    if (!s.paid_this_period && s.current_due_date === today) subsToday.push(item(today, "due"));
  }
  const reachOut = people
    .filter((p) => p.dueDate === today && p.balance >= 0.005)
    .map((p) => ({ key: `udhar:${p.id}:${today}`, name: p.name, amount: p.balance, date: today }));
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

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type ReminderEmail = { subject: string; text: string; html: string };

// One email a day at most, holding everything due. Returns null when there is
// nothing to say.
export function buildReminderEmail(o: {
  name: string;
  today: string;
  due: DueReminders;
  summary: SummaryData | null;
  owed: { total: number; people: number } | null;
  appUrl: string;
}): ReminderEmail | null {
  const { subsTomorrow, subsToday, reachOut } = o.due;
  if (!subsTomorrow.length && !subsToday.length && !reachOut.length && !o.summary) return null;

  type Section = { title: string; lines: string[] };
  const sections: Section[] = [];
  if (subsToday.length) {
    sections.push({ title: "Subscriptions due today", lines: subsToday.map((s) => `${s.name}: ${fmtRs(s.amount)}`) });
  }
  if (subsTomorrow.length) {
    sections.push({ title: "Due tomorrow", lines: subsTomorrow.map((s) => `${s.name}: ${fmtRs(s.amount)}`) });
  }
  if (reachOut.length) {
    sections.push({
      title: "Reach out today",
      lines: reachOut.map((p) => `${p.name} owes you ${fmtRs(p.amount)}`),
    });
  }
  if (o.summary) {
    const lines = o.summary.count
      ? [
          `Spent ${fmtRs(o.summary.total)} across ${o.summary.count} ${o.summary.count === 1 ? "expense" : "expenses"}`,
          ...o.summary.top.slice(0, 3).map((c) => `${c.category}: ${fmtRs(c.total)}`),
        ]
      : ["No expenses recorded."];
    if (o.owed && o.owed.total >= 0.005) {
      lines.push(`Still owed to you: ${fmtRs(o.owed.total)} by ${o.owed.people} ${o.owed.people === 1 ? "person" : "people"}`);
    }
    sections.push({ title: `Your ${o.summary.label}`, lines });
  }

  const parts: string[] = [];
  if (subsToday.length) parts.push(subsToday.length === 1 ? `${subsToday[0].name} due today` : `${subsToday.length} subscriptions due today`);
  if (subsTomorrow.length) parts.push(subsTomorrow.length === 1 ? `${subsTomorrow[0].name} due tomorrow` : `${subsTomorrow.length} due tomorrow`);
  if (reachOut.length) parts.push(reachOut.length === 1 ? `reach out to ${reachOut[0].name}` : `${reachOut.length} people to reach out to`);
  if (o.summary) parts.push(`your ${o.summary.label} summary`);
  const subject = `Khata: ${parts.join(", ")}`;
  const hello = o.name ? `Hi ${o.name},` : "Hi,";

  const text = [
    hello,
    "",
    ...sections.flatMap((s) => [s.title, ...s.lines.map((l) => `- ${l}`), ""]),
    `Open Khata: ${o.appUrl}`,
    "",
    `Sent ${fmtDateLabel(o.today)}. Turn these emails off in Khata > Edit profile.`,
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#eef1f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0b0d14">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:20px;padding:24px">
<p style="margin:0 0 4px;font-size:13px;color:#5a6275">Khata</p>
<p style="margin:0 0 16px;font-size:17px;font-weight:700">${escapeHtml(hello)}</p>
${sections
  .map(
    (s) => `<p style="margin:16px 0 6px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#5a6275">${escapeHtml(s.title)}</p>
${s.lines.map((l) => `<p style="margin:0 0 4px;font-size:15px">${escapeHtml(l)}</p>`).join("\n")}`
  )
  .join("\n")}
<p style="margin:24px 0 0"><a href="${escapeHtml(o.appUrl)}" style="display:inline-block;background:#2a78d6;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:999px">Open Khata</a></p>
<p style="margin:20px 0 0;font-size:12px;color:#5a6275">Turn these emails off in Khata &rsaquo; Edit profile.</p>
</div></body></html>`;

  return { subject, text, html };
}

export function validEmail(raw: string): boolean {
  return raw.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw);
}
