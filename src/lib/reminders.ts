// Reminder emails: what is due on a given day, and how each email reads. No
// database or network here - the scheduled jobs gather the data - so this
// runs under the scripts/ tests.
//
// Every reminder is its own email, linking to the record it is about:
// - a subscription, the evening before it is due and on the day if unpaid
// - someone who owes you, on the follow-up date you set
// - on the 1st, a summary of the month just ended
import { fmtRs } from "./format.ts";
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

export function validEmail(raw: string): boolean {
  return raw.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw);
}

/* ---------- the emails ---------- */

export type ReminderEmail = { subject: string; text: string; html: string };

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// "Wednesday, 16 September 2026"
export function longDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

type Section = { title?: string; rows: [string, string][]; empty?: string };

type Layout = {
  eyebrow: string;
  heading: string;
  greeting: string;
  intro: string;
  rows?: [string, string][];
  sections?: Section[];
  button: { label: string; url: string };
  note: string;
  manageUrl: string;
};

// One consistent, table-based layout: email clients ignore most modern CSS,
// so everything is inline and nothing depends on flexbox or web fonts.
function render(o: Layout): { html: string; text: string } {
  const sections: Section[] = o.sections ?? [{ rows: o.rows ?? [] }];

  const tableFor = (section: Section) => {
    const cell = (i: number) => `padding:12px 0;${i ? "border-top:1px solid #e6e9f2;" : ""}font-size:14px;`;
    const body = section.rows.length
      ? section.rows
          .map(
            ([label, value], i) => `<tr>
<td style="${cell(i)}color:#5a6275;padding-right:16px;">${escapeHtml(label)}</td>
<td style="${cell(i)}color:#0b0d14;font-weight:600;text-align:right;white-space:nowrap;">${escapeHtml(value)}</td>
</tr>`
          )
          .join("\n")
      : `<tr><td colspan="2" style="padding:12px 0;font-size:14px;color:#5a6275;">${escapeHtml(section.empty ?? "Nothing to show.")}</td></tr>`;
    const title = section.title
      ? `<p style="margin:0 0 4px;font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#0b0d14;">${escapeHtml(section.title)}</p>`
      : "";
    return `${title}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e6e9f2;border-bottom:1px solid #e6e9f2;margin:0 0 28px;">
${body}
</table>`;
  };

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(o.heading)}</title></head>
<body style="margin:0;padding:0;background:#eef1f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f9;padding:32px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="background:#121833;padding:18px 32px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;padding-right:10px;"><img src="${escapeHtml(o.manageUrl)}/icon-192.png" width="32" height="32" alt="Khata logo" style="display:block;width:32px;height:32px;border-radius:9px;border:0;"></td>
<td style="vertical-align:middle;"><span style="font-size:19px;font-weight:800;color:#ffffff;letter-spacing:-0.01em;">Khata</span></td>
</tr></table>
</td></tr>
<tr><td style="padding:32px 32px 8px;">
<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#2a78d6;">${escapeHtml(o.eyebrow)}</p>
<h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;font-weight:800;color:#0b0d14;">${escapeHtml(o.heading)}</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#303746;">${escapeHtml(o.greeting)}</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#303746;">${escapeHtml(o.intro)}</p>
${sections.map(tableFor).join("\n")}
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#2a78d6;">
<a href="${escapeHtml(o.button.url)}" style="display:inline-block;padding:14px 24px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(o.button.label)}</a>
</td></tr></table>
<p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#5a6275;">${escapeHtml(o.note)}</p>
</td></tr>
<tr><td style="padding:24px 32px 28px;">
<p style="margin:0;padding-top:20px;border-top:1px solid #e6e9f2;font-size:12px;line-height:1.6;color:#8a91a3;">You are receiving this email because reminders are turned on for your Khata account. You can change this at any time in <a href="${escapeHtml(o.manageUrl)}" style="color:#5a6275;">Edit profile</a>.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const textSection = (section: Section) => {
    const width = Math.max(0, ...section.rows.map(([label]) => label.length));
    return [
      ...(section.title ? [section.title.toUpperCase()] : []),
      ...(section.rows.length
        ? section.rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`)
        : [section.empty ?? "Nothing to show."]),
      "",
    ];
  };
  const text = [
    o.heading,
    "",
    o.greeting,
    "",
    o.intro,
    "",
    ...sections.flatMap(textSection),
    `${o.button.label}: ${o.button.url}`,
    "",
    o.note,
    "",
    "--",
    "You are receiving this email because reminders are turned on for your Khata account.",
    `Manage reminders: ${o.manageUrl}`,
  ].join("\n");

  return { html, text };
}

const greet = (name: string) => (name ? `Dear ${name},` : "Hello,");

export function subscriptionReminderEmail(o: {
  name: string;
  item: ReminderItem;
  stage: "before" | "due";
  appUrl: string;
}): ReminderEmail {
  const { item } = o;
  const amount = fmtRs(item.amount);
  const when = longDate(item.date);
  const before = o.stage === "before";
  const subject = before
    ? `Reminder: ${item.name} payment of ${amount} is due tomorrow`
    : `Due today: ${item.name} payment of ${amount}`;
  const { html, text } = render({
    eyebrow: "Subscription reminder",
    heading: before ? `${item.name} is due tomorrow` : `${item.name} is due today`,
    greeting: greet(o.name),
    intro: before
      ? `This is a reminder that your ${item.name} subscription payment of ${amount} is due tomorrow, ${when}.`
      : `Your ${item.name} subscription payment of ${amount} is due today, ${when}, and has not yet been marked as paid.`,
    rows: [
      ["Subscription", item.name],
      ["Amount", amount],
      ["Due date", when],
      ["Status", before ? "Upcoming" : "Unpaid"],
    ],
    button: { label: "View subscription", url: `${o.appUrl}/subscriptions?open=${encodeURIComponent(item.id)}` },
    note: before
      ? "Already paid? Mark it as paid in Khata and you will not be reminded again for this month."
      : "Once you have paid, mark it as paid in Khata to keep your records up to date.",
    manageUrl: o.appUrl,
  });
  return { subject, text, html };
}

export function udharReminderEmail(o: { name: string; item: ReminderItem; appUrl: string }): ReminderEmail {
  const { item } = o;
  const amount = fmtRs(item.amount);
  const when = longDate(item.date);
  const { html, text } = render({
    eyebrow: "Payment follow-up",
    heading: `Follow up with ${item.name} today`,
    greeting: greet(o.name),
    intro: `Today, ${when}, is the date you set to follow up with ${item.name}. The outstanding amount they owe you is ${amount}.`,
    rows: [
      ["Name", item.name],
      ["Amount due", amount],
      ["Follow-up date", when],
    ],
    button: { label: `View ${item.name}'s khata`, url: `${o.appUrl}/udhar-khata?open=${encodeURIComponent(item.id)}` },
    note: "Received a payment? Record it in Khata to keep the balance up to date, or set a new follow-up date.",
    manageUrl: o.appUrl,
  });
  return { subject: `Reminder: ${item.name} owes you ${amount} - follow up today`, text, html };
}

export function monthlySummaryEmail(o: {
  name: string;
  summary: SummaryData;
  owed: { total: number; people: number } | null;
  appUrl: string;
}): ReminderEmail {
  const { summary } = o;
  const rows: [string, string][] = [
    ["Total spent", fmtRs(summary.total)],
    ["Expenses recorded", String(summary.count)],
    ...summary.top.slice(0, 3).map((c, i): [string, string] => [i === 0 ? `Top category: ${c.category}` : c.category, fmtRs(c.total)]),
  ];
  if (o.owed) {
    rows.push([
      "Owed to you",
      o.owed.total >= 0.005 ? `${fmtRs(o.owed.total)} (${o.owed.people} ${o.owed.people === 1 ? "person" : "people"})` : "Nothing outstanding",
    ]);
  }
  const { html, text } = render({
    eyebrow: "Monthly summary",
    heading: `Your ${summary.label} summary`,
    greeting: greet(o.name),
    intro: summary.count
      ? `Here is an overview of your spending in ${summary.label}.`
      : `No expenses were recorded in ${summary.label}.`,
    rows,
    button: { label: "Open Khata", url: `${o.appUrl}/expenses` },
    note: "See the full breakdown by category in Mera Khata.",
    manageUrl: o.appUrl,
  });
  return { subject: `Your Khata summary for ${summary.label}`, text, html };
}

/* ---------- daily recap ---------- */

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

// Sent early the next morning: what was recorded on a day, and a nudge to add
// anything that was missed.
export function dailyRecapEmail(o: { name: string; recap: RecapData; appUrl: string }): ReminderEmail {
  const { recap } = o;
  const when = longDate(recap.date);
  const total = recap.expenses.reduce((sum, e) => sum + e.amount, 0);
  const dueNames = new Set(recap.subsDue.map((s) => s.name));

  const sections: Section[] = [
    {
      title: "Expenses",
      rows: recap.expenses.length
        ? [...recap.expenses.map((e): [string, string] => [e.label, fmtRs(e.amount)]), ["Total", fmtRs(total)]]
        : [],
      empty: "No expenses were recorded.",
    },
    {
      title: "Udhar Khata",
      rows: recap.ledger.map((l): [string, string] => [l.amount > 0 ? `Lent to ${l.name}` : `${l.name} paid you back`, fmtRs(Math.abs(l.amount))]),
      empty: "No changes.",
    },
    {
      title: "Subscriptions",
      rows: [
        ...recap.subsDue.map((s): [string, string] => [`${s.name} was due`, `${fmtRs(s.amount)} · ${s.paid ? "Paid" : "Unpaid"}`]),
        ...recap.subsPaid.filter((s) => !dueNames.has(s.name)).map((s): [string, string] => [`${s.name} marked paid`, fmtRs(s.amount)]),
      ],
      empty: "None were due.",
    },
  ];

  const dayName = when.replace(/ \d{4}$/, "");
  const subject = recap.expenses.length
    ? `Your Khata recap for ${dayName}: ${fmtRs(total)} spent`
    : `Your Khata recap for ${dayName}: no expenses recorded`;
  const unpaid = recap.subsDue.filter((s) => !s.paid);

  const { html, text } = render({
    eyebrow: "Daily recap",
    heading: `Your recap for ${when}`,
    greeting: greet(o.name),
    intro: recap.expenses.length
      ? `Here is a summary of your activity on ${when}. You recorded ${recap.expenses.length} ${recap.expenses.length === 1 ? "expense" : "expenses"} totalling ${fmtRs(total)}.`
      : `Here is a summary of your activity on ${when}. No expenses were recorded on this day.`,
    sections,
    button: { label: "Add a missed expense", url: `${o.appUrl}/expenses?add=1` },
    note:
      "Forgot something? Please add any expense you missed manually so your records stay complete." +
      (unpaid.length ? ` ${unpaid.map((s) => s.name).join(", ")} ${unpaid.length === 1 ? "is" : "are"} still unpaid.` : ""),
    manageUrl: o.appUrl,
  });
  return { subject, text, html };
}

type RecapSources = {
  expenses: (fromDate: string, toDate: string) => Promise<{ amount: number; vendor?: string | null; note: string; category?: string | null }[]>;
  ledger: (fromIso: string, toIso: string) => Promise<{ name: string; amount: number }[]>;
  subscriptions: () => Promise<
    { name: string; amount: number; active: boolean | number; history: { due_date: string; paid_at: string | null }[] }[]
  >;
};

// Gathers one day's recap. The data comes through `sources`, so the daily job
// and the test email share this without it touching the database itself.
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
