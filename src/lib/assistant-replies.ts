// Every reply the Khata assistant sends, in one place so they all share one
// layout: a bold heading, a blank line, one fact per line, and the UNDO hint
// set apart at the end. *text* marks bold; the assistant page renders it.
// Relative import with an extension so this also runs under the scripts/
// tests, where the @/ alias doesn't exist.
import { MONTH_NAMES, fmtDateLabel, fmtRs } from "./format.ts";
import type { UndoStep } from "@/lib/db";

const join = (lines: string[]) => lines.join("\n");

// A person's Udhar Khata balance is what they owe the user: positive means
// they still owe, negative means the user now owes them.
export function balanceLine(balance: number): string {
  if (Math.abs(balance) < 0.005) return "Balance: settled";
  return balance > 0 ? `Balance: owes you ${fmtRs(balance)}` : `Balance: you owe ${fmtRs(-balance)}`;
}

export function expenseAddedReply(o: {
  amount: number;
  category: string | null;
  vendor: string | null;
  date: string;
  today: string;
  offline?: boolean;
}): string {
  const lines = [
    "*Expense added*",
    "",
    `Amount: ${fmtRs(o.amount)}`,
    `Category: ${o.category ?? "Uncategorised - pick one in the app"}`,
  ];
  if (o.vendor) lines.push(`Vendor: ${o.vendor}`);
  if (o.date !== o.today) lines.push(`Date: ${fmtDateLabel(o.date)}`);
  if (o.offline) lines.push("", "The AI was busy, so this was read without it. Please check it in the app.");
  lines.push("", "Reply *UNDO* to remove it.");
  return join(lines);
}

export function ledgerReply(o: {
  direction: "lend" | "repayment";
  lines: { name: string; amount: number; balance: number; isNew?: boolean; settled?: boolean }[];
}): string {
  const lend = o.direction === "lend";
  const out = [lend ? "*Udhar Khata updated*" : "*Payment recorded*", ""];
  if (lend && o.lines.length > 1) {
    const total = o.lines.reduce((sum, l) => sum + l.amount, 0);
    out.push(`Lent ${fmtRs(total)} to ${o.lines.length} people`, "");
  }
  o.lines.forEach((l, i) => {
    if (i > 0) out.push("");
    out.push(
      lend
        ? `*${l.name}*${l.isNew ? " (new)" : ""}: ${fmtRs(l.amount)} lent`
        : `*${l.name}* paid back ${l.settled ? "everything, " : ""}${fmtRs(l.amount)}`
    );
    out.push(balanceLine(l.balance));
  });
  out.push("", "Reply *UNDO* to reverse this.");
  return join(out);
}

export function undoReply(
  u: {
    expense: { amount: number; vendor: string | null } | null;
    transactions: { name: string; amount: number }[];
    peopleRemoved?: string[];
    steps?: UndoStep[];
  } | null
): string {
  if (!u) return join(["*Nothing to undo*", "", "There's nothing from the last 24 hours to remove."]);
  const out = ["*Removed*", ""];
  if (u.expense) {
    out.push(`Expense: ${fmtRs(u.expense.amount)}${u.expense.vendor ? ` · ${u.expense.vendor}` : ""}`);
  }
  for (const t of u.transactions) {
    out.push(
      t.amount >= 0
        ? `Loan to ${t.name}: ${fmtRs(t.amount)}`
        : `Payment from ${t.name}: ${fmtRs(-t.amount)}`
    );
  }
  for (const name of u.peopleRemoved ?? []) out.push(`Removed ${name} from Udhar Khata`);
  for (const step of u.steps ?? []) out.push(undoStepLine(step));
  return join(out);
}

// A reason from validation, e.g. "The amount needs to be more than zero."
// Questions get their own heading: nothing was going to be added.
export const QUESTION_REFUSAL_HEADING = "Couldn't answer that";

export function refusalReply(reason: string, heading = "Nothing added"): string {
  return join([`*${heading}*`, "", reason]);
}

export const HELP_REPLY = join([
  "*What you can say*",
  "",
  "*Expenses*",
  "fuel 3000 shell",
  "change the last one to 2500",
  "delete yesterday's fuel",
  "or a photo of a bill, or a voice note",
  "",
  "*Udhar Khata*",
  "add 700 each to Usama and Ali",
  "Ali paid me back 1000",
  "Ali will pay back on the 1st",
  "rename Ali to Ali Raza",
  "",
  "*Subscriptions*",
  "add Spotify 1200 due on the 5th",
  "mark Netflix paid",
  "pause YouTube Premium",
  "",
  "*Categories*",
  "create category Travel with keywords flight, hotel",
  "rename Tech to Gadgets",
  "",
  "*Questions*",
  "who owes me?",
  "what did I spend today?",
  "how much on fuel this month?",
  "show my biggest expenses this week",
  "which subscriptions are due?",
  "show Ali's history",
  "this month vs last month",
  "who has to pay me back this week?",
  "",
  "*The app*",
  "how do I set up email reminders?",
  "turn off my email reminders",
  "I wish the app had budgets",
  "",
  "Reply *UNDO* to reverse the last change.",
]);

export const BUSY_REPLY = join([
  "*Nothing added*",
  "",
  "The AI that reads your messages is busy right now. Please send it again in a minute.",
]);

export const ERROR_REPLY = join([
  "*Nothing added*",
  "",
  "Something went wrong on my side. Please try again in a minute.",
]);

export function ambiguousPersonReply(name: string): string {
  return join([
    "*Nothing added*",
    "",
    `You have more than one ${name} in Udhar Khata, so I can't tell which one you mean. Rename one of them in the app, then send it again.`,
  ]);
}

/* ---------- answers to questions ---------- */

export function periodLabel(year: number, month: number | null): string {
  return month ? `${MONTH_NAMES[month - 1]} ${year}` : String(year);
}

export function udharPersonReply(
  people: { name: string; balance: number; lent: number; received: number; dueDate: string | null }[],
  today: string
): string {
  const out = ["*Udhar Khata*"];
  for (const p of people) {
    out.push("", `*${p.name}*`, balanceLine(p.balance), `Lent ${fmtRs(p.lent)} · Paid back ${fmtRs(p.received)}`);
    if (p.dueDate) {
      const overdue = p.dueDate < today && p.balance >= 0.005;
      out.push(`Due: ${fmtDateLabel(p.dueDate)}${overdue ? " (overdue)" : ""}`);
    }
  }
  return join(out);
}

export function udharSummaryReply(owing: { name: string; balance: number }[]): string {
  if (!owing.length) {
    return join(["*Nobody owes you anything*", "", "No one has an unpaid balance with you right now."]);
  }
  const sorted = [...owing].sort((a, b) => b.balance - a.balance);
  const total = sorted.reduce((sum, p) => sum + p.balance, 0);
  return join([
    "*Who owes you*",
    "",
    ...sorted.map((p) => `${p.name}: ${fmtRs(p.balance)}`),
    "",
    `Total: ${fmtRs(total)}`,
  ]);
}

// "in August 2026", but "today" or "this week" - so headings read naturally.
export function whenPhrase(label: string): string {
  return /^(today|yesterday|this |last )/i.test(label) ? label.toLowerCase() : `in ${label}`;
}

export function rangeLabel(from: string, to: string): string {
  if (from === to) return fmtDateLabel(from);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${sameYear ? fmtDateLabel(from).replace(/ \d{4}$/, "") : fmtDateLabel(from)} – ${fmtDateLabel(to)}`;
}

export function expenseListReply(o: {
  title: string;
  items: { date: string; amount: number; vendor: string | null; category: string | null; note: string }[];
  matched: number;
  total: number;
}): string {
  const out = [`*${o.title}*`, ""];
  if (!o.items.length) {
    out.push("Nothing recorded.");
    return join(out);
  }
  for (const e of o.items) {
    const what = e.vendor || e.note.replace(/^(WhatsApp|Assistant):\s*/, "") || "Expense";
    out.push(`${fmtDateLabel(e.date)} · ${fmtRs(e.amount)} · ${what}${e.category ? ` (${e.category})` : ""}`);
  }
  out.push("", o.matched > o.items.length ? `Showing ${o.items.length} of ${o.matched} · Total ${fmtRs(o.total)}` : `Total: ${fmtRs(o.total)}`);
  return join(out);
}

export function subscriptionsOverviewReply(
  items: { name: string; amount: number; active: boolean; paid: boolean; dueDate: string }[],
  today: string
): string {
  const out = ["*Your subscriptions*", ""];
  if (!items.length) {
    out.push("You don't have any subscriptions yet.");
    return join(out);
  }
  const active = items.filter((s) => s.active);
  for (const s of [...active].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
    const state = s.paid ? "paid" : `due ${fmtDateLabel(s.dueDate)}${s.dueDate < today ? " (overdue)" : ""}`;
    out.push(`${s.name}: ${fmtRs(s.amount)} · ${state}`);
  }
  for (const s of items.filter((x) => !x.active)) out.push(`${s.name}: ${fmtRs(s.amount)} · paused`);
  const unpaid = active.filter((s) => !s.paid).reduce((sum, s) => sum + s.amount, 0);
  out.push("", `Monthly total: ${fmtRs(active.reduce((sum, s) => sum + s.amount, 0))}`);
  if (unpaid > 0) out.push(`Still to pay: ${fmtRs(unpaid)}`);
  return join(out);
}

export function spendingReply(o: {
  label: string;
  filter: string | null;
  total: number;
  count: number;
  byCategory: { category: string; total: number }[];
}): string {
  const out = [o.filter ? `*${o.filter} ${whenPhrase(o.label)}*` : `*Spent ${whenPhrase(o.label)}*`, ""];
  if (!o.count) {
    out.push("Nothing recorded.");
    return join(out);
  }
  out.push(`Total: ${fmtRs(o.total)}`, `Expenses: ${o.count}`);
  if (o.byCategory.length) {
    out.push("", "*By category*", ...o.byCategory.slice(0, 5).map((c) => `${c.category}: ${fmtRs(c.total)}`));
  }
  return join(out);
}

export function recentExpensesReply(
  items: { date: string; amount: number; vendor: string | null; category: string | null; note: string }[]
): string {
  const out = ["*Recent expenses*", ""];
  if (!items.length) {
    out.push("No expenses recorded yet.");
    return join(out);
  }
  for (const e of items) {
    // Older notes carry a "WhatsApp:" source prefix from before the in-app assistant.
    const what = e.vendor || e.note.replace(/^(WhatsApp|Assistant):\s*/, "") || "Expense";
    out.push(`${fmtDateLabel(e.date)} · ${fmtRs(e.amount)} · ${what}${e.category ? ` (${e.category})` : ""}`);
  }
  return join(out);
}

export function subscriptionsDueReply(items: { name: string; amount: number; dueDate: string }[], today: string): string {
  const out = ["*Subscriptions due*", ""];
  if (!items.length) {
    out.push("Everything active is paid for this month.");
    return join(out);
  }
  for (const sub of [...items].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
    out.push(`${sub.name}: ${fmtRs(sub.amount)} · ${fmtDateLabel(sub.dueDate)}${sub.dueDate < today ? " (overdue)" : ""}`);
  }
  return join(out);
}

export function dueDateReply(o: { name: string; date: string | null }): string {
  return o.date
    ? join(["*Due date set*", "", `*${o.name}*: ${fmtDateLabel(o.date)}`, "", "Reply *UNDO* to change it back."])
    : join(["*Due date removed*", "", `*${o.name}* no longer has a due date.`, "", "Reply *UNDO* to change it back."]);
}

// For a voice note, the reply opens with what was heard, so a mishearing is
// noticed before the saved result is trusted.
export function withTranscript(transcript: string | null, reply: string): string {
  return transcript ? join([`*Heard:* ${transcript}`, "", reply]) : reply;
}

/* ---------- changes to existing records ---------- */

export type ExpenseView = { amount: number; vendor: string | null; category: string | null; date: string; note: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}

const describe = (e: ExpenseView) => e.vendor || e.note || "Expense";
const categoryText = (c: string | null) => c ?? "Uncategorised";

export function expenseEditedReply(o: { before: ExpenseView; after: ExpenseView }): string {
  const { before: b, after: a } = o;
  const changes = [
    b.amount !== a.amount ? `Amount: ${fmtRs(b.amount)} → ${fmtRs(a.amount)}` : null,
    b.vendor !== a.vendor ? `Vendor: ${b.vendor ?? "none"} → ${a.vendor ?? "none"}` : null,
    b.category !== a.category ? `Category: ${categoryText(b.category)} → ${categoryText(a.category)}` : null,
    b.date !== a.date ? `Date: ${fmtDateLabel(b.date)} → ${fmtDateLabel(a.date)}` : null,
    b.note !== a.note ? `Note: ${b.note || "none"} → ${a.note || "none"}` : null,
  ].filter((line): line is string => line !== null);
  return join([
    "*Expense updated*",
    "",
    `${describe(a)} · ${fmtDateLabel(a.date)}`,
    "",
    ...(changes.length ? changes : ["It already had those details."]),
    "",
    "Reply *UNDO* to change it back.",
  ]);
}

export function expenseDeletedReply(e: ExpenseView): string {
  return join([
    "*Expense deleted*",
    "",
    `${fmtRs(e.amount)} · ${describe(e)} · ${categoryText(e.category)} · ${fmtDateLabel(e.date)}`,
    "",
    "Reply *UNDO* to bring it back.",
  ]);
}

export function whichExpenseReply(items: ExpenseView[]): string {
  return join([
    "*Which one?*",
    "",
    `${plural(items.length, "expense matches", "expenses match")} that:`,
    ...items.slice(0, 5).map((e) => `${fmtDateLabel(e.date)} · ${fmtRs(e.amount)} · ${describe(e)}`),
    ...(items.length > 5 ? [`…and ${items.length - 5} more`] : []),
    "",
    "Say which, e.g. the Rs 500 one on 14 Sep.",
  ]);
}

export function personRenamedReply(o: { from: string; to: string }): string {
  return join(["*Name changed*", "", `${o.from} → *${o.to}*`, "", "Reply *UNDO* to change it back."]);
}

export function personDeletedReply(o: { name: string; balance: number; entries: number }): string {
  return join([
    "*Removed from Udhar Khata*",
    "",
    `*${o.name}*`,
    `${plural(o.entries, "entry", "entries")} removed`,
    balanceLine(o.balance),
    "",
    "Reply *UNDO* to bring them back.",
  ]);
}

export function subscriptionAddedReply(o: { name: string; amount: number; firstDueDate: string }): string {
  return join([
    "*Subscription added*",
    "",
    `*${o.name}*: ${fmtRs(o.amount)} a month`,
    `First due: ${fmtDateLabel(o.firstDueDate)}`,
    "",
    "Reply *UNDO* to remove it.",
  ]);
}

export function subscriptionPaidReply(o: { name: string; amount: number; period: string; nextDueDate: string | null }): string {
  const [year, month] = o.period.split("-").map(Number);
  return join([
    "*Marked paid*",
    "",
    `*${o.name}*: ${fmtRs(o.amount)}`,
    `Paid for ${periodLabel(year, month)}`,
    ...(o.nextDueDate ? [`Next due: ${fmtDateLabel(o.nextDueDate)}`] : []),
    "",
    "Reply *UNDO* to mark it unpaid.",
  ]);
}

export function subscriptionActiveReply(o: { name: string; active: boolean }): string {
  return join([
    o.active ? "*Subscription resumed*" : "*Subscription paused*",
    "",
    `*${o.name}*`,
    o.active ? "Reminders are back on." : "No reminders until you resume it.",
    "",
    "Reply *UNDO* to change it back.",
  ]);
}

type SubscriptionView = { name: string; amount: number; dueDay: number };

export function subscriptionEditedReply(o: { before: SubscriptionView; after: SubscriptionView }): string {
  const { before: b, after: a } = o;
  const changes = [
    b.name !== a.name ? `Name: ${b.name} → ${a.name}` : null,
    b.amount !== a.amount ? `Amount: ${fmtRs(b.amount)} → ${fmtRs(a.amount)}` : null,
    b.dueDay !== a.dueDay ? `Due: the ${ordinal(b.dueDay)} → the ${ordinal(a.dueDay)}` : null,
  ].filter((line): line is string => line !== null);
  return join([
    "*Subscription updated*",
    "",
    `*${a.name}*`,
    ...(changes.length ? changes : ["It already had those details."]),
    "",
    "Reply *UNDO* to change it back.",
  ]);
}

export function subscriptionDeletedReply(o: { name: string; payments: number }): string {
  return join([
    "*Subscription deleted*",
    "",
    `*${o.name}*`,
    `${plural(o.payments, "payment record", "payment records")} removed`,
    "",
    "Reply *UNDO* to bring it back.",
  ]);
}

const keywordLine = (keywords: string[]) => (keywords.length ? `Keywords: ${keywords.join(", ")}` : "No keywords");

export function categoryCreatedReply(o: { name: string; keywords: string[] }): string {
  return join(["*Category created*", "", `*${o.name}*`, keywordLine(o.keywords), "", "Reply *UNDO* to remove it."]);
}

export function categoryRenamedReply(o: { from: string; to: string; moved: number }): string {
  return join([
    "*Category renamed*",
    "",
    `${o.from} → *${o.to}*`,
    ...(o.moved ? [`${plural(o.moved, "expense", "expenses")} moved with it`] : []),
    "",
    "Reply *UNDO* to change it back.",
  ]);
}

export function categoryDeletedReply(o: { name: string; expenses: number }): string {
  return join([
    "*Category deleted*",
    "",
    `*${o.name}*`,
    o.expenses ? `${plural(o.expenses, "expense is", "expenses are")} now uncategorised` : "It had no expenses.",
    "",
    "Reply *UNDO* to bring it back.",
  ]);
}

export function categoryKeywordsReply(o: { name: string; keywords: string[] }): string {
  return join(["*Keywords updated*", "", `*${o.name}*`, keywordLine(o.keywords), "", "Reply *UNDO* to change them back."]);
}

export function categoriesListReply(items: { name: string; keywords: string[] }[]): string {
  return join([
    "*Your categories*",
    "",
    ...(items.length ? items.map((c) => (c.keywords.length ? `${c.name} (${c.keywords.join(", ")})` : c.name)) : ["None yet."]),
    "",
    "Say: create category Travel, to add one.",
  ]);
}

// One line per thing UNDO put back.
export function undoStepLine(step: UndoStep): string {
  switch (step.op) {
    case "set_due_date":
      return step.dueDate ? `Due date for ${step.name} back to ${fmtDateLabel(step.dueDate)}` : `Due date for ${step.name} removed`;
    case "restore_expense":
      return `Expense back: ${fmtRs(step.row.amount)}${step.row.vendor ? ` · ${step.row.vendor}` : ""}`;
    case "revert_expense":
      return `Expense back to ${fmtRs(step.before.amount)}${step.before.vendor ? ` · ${step.before.vendor}` : ""} (${categoryText(step.before.category)})`;
    case "remove_subscription":
      return `Subscription removed: ${step.name}`;
    case "restore_subscription":
      return `Subscription back: ${step.sub.name}`;
    case "revert_subscription":
      return `${step.before.name} back to ${fmtRs(step.before.amount)}, due on the ${ordinal(step.before.due_day)}${step.before.active ? "" : " (paused)"}`;
    case "unmark_paid":
      return `${step.name} marked unpaid again`;
    case "rename_person":
      return `${step.renamedTo} renamed back to ${step.name}`;
    case "restore_person":
      return `${step.person.name} back in Udhar Khata`;
    case "remove_category":
      return `Category removed: ${step.name}`;
    case "rename_category":
      return `Category renamed back to ${step.to}`;
    case "restore_category":
      return `Category back: ${step.category.name}`;
    case "set_category_keywords":
      return `Keywords for ${step.name} put back`;
    case "remove_expense":
      return `Expense removed: ${fmtRs(step.amount)}${step.vendor ? ` · ${step.vendor}` : ""}`;
    case "set_email_reminders":
      return `Email reminders turned ${step.on ? "on" : "off"} again`;
  }
}

/* ---------- more answers ---------- */

export function expensesBatchReply(items: { amount: number; vendor: string | null; note: string; category: string | null }[]): string {
  const total = items.reduce((sum, e) => sum + e.amount, 0);
  return join([
    `*${items.length} expenses added*`,
    "",
    ...items.map((e) => `${fmtRs(e.amount)} · ${e.vendor || e.note || "Expense"} (${e.category ?? "Uncategorised"})`),
    "",
    `Total: ${fmtRs(total)}`,
    "",
    "Reply *UNDO* to remove them.",
  ]);
}

export const HISTORY_SHOWN = 15;

export function personHistoryReply(o: {
  name: string;
  balance: number;
  lent: number;
  received: number;
  dueDate: string | null;
  entries: { amount: number; note: string; date: string }[];
}): string {
  const out = [`*${o.name}'s khata*`, "", balanceLine(o.balance), `Lent ${fmtRs(o.lent)} · Paid back ${fmtRs(o.received)}`];
  if (o.dueDate && o.balance >= 0.005) out.push(`Follow-up date: ${fmtDateLabel(o.dueDate)}`);
  out.push("", "*History*");
  if (!o.entries.length) out.push("No entries yet.");
  for (const e of o.entries.slice(0, HISTORY_SHOWN)) {
    const what = e.amount > 0 ? `Lent ${fmtRs(e.amount)}` : `Paid back ${fmtRs(-e.amount)}`;
    out.push(`${fmtDateLabel(e.date)} · ${what}${e.note ? ` · ${e.note.replace(/^(WhatsApp|Assistant):\s*/, "")}` : ""}`);
  }
  if (o.entries.length > HISTORY_SHOWN) out.push("", `Showing the latest ${HISTORY_SHOWN} of ${o.entries.length}.`);
  return join(out);
}

export function compareReply(o: {
  a: { label: string; total: number; count: number };
  b: { label: string; total: number; count: number };
  category: string | null;
  changes: { category: string; delta: number }[];
}): string {
  const diff = o.a.total - o.b.total;
  const pct = o.b.total > 0 ? Math.round((Math.abs(diff) / o.b.total) * 100) : null;
  const trend =
    Math.abs(diff) < 0.005
      ? "The same as before."
      : `${diff > 0 ? "Up" : "Down"} ${fmtRs(Math.abs(diff))}${pct !== null ? ` (${diff > 0 ? "+" : "−"}${pct}%)` : ""}`;
  const out = [
    `*${o.category ? `${o.category}: ` : ""}${o.a.label} vs ${o.b.label.toLowerCase()}*`,
    "",
    `${o.a.label}: ${fmtRs(o.a.total)} (${o.a.count} ${o.a.count === 1 ? "expense" : "expenses"})`,
    `${o.b.label}, same days: ${fmtRs(o.b.total)} (${o.b.count} ${o.b.count === 1 ? "expense" : "expenses"})`,
    "",
    trend,
  ];
  const moved = o.changes.filter((c) => Math.abs(c.delta) >= 0.005).slice(0, 3);
  if (moved.length) {
    out.push("", "*Biggest changes*", ...moved.map((c) => `${c.category}: ${c.delta > 0 ? "+" : "−"}${fmtRs(Math.abs(c.delta))}`));
  }
  return join(out);
}

export function udharDueReply(o: {
  days: number;
  overdue: { name: string; balance: number; dueDate: string }[];
  soon: { name: string; balance: number; dueDate: string }[];
}): string {
  if (!o.overdue.length && !o.soon.length) {
    return join([
      "*Nobody is due*",
      "",
      `No follow-up dates in the next ${o.days} days. Set one by saying: Ali will pay back on the 1st.`,
    ]);
  }
  const line = (p: { name: string; balance: number; dueDate: string }) => `${p.name}: ${fmtRs(p.balance)} · ${fmtDateLabel(p.dueDate)}`;
  const out = ["*Who is due to pay back*"];
  if (o.overdue.length) out.push("", "*Overdue*", ...o.overdue.map(line));
  if (o.soon.length) out.push("", `*Next ${o.days} days*`, ...o.soon.map(line));
  const total = [...o.overdue, ...o.soon].reduce((sum, p) => sum + p.balance, 0);
  out.push("", `Total: ${fmtRs(total)}`);
  return join(out);
}

export function remindersReply(o: { on: boolean; email: string | null }): string {
  if (!o.on) return join(["*Email reminders off*", "", "You won't get reminder emails until you turn them back on.", "", "Reply *UNDO* to change it back."]);
  return join([
    "*Email reminders on*",
    "",
    o.email
      ? `Reminders go to ${o.email}: subscriptions and follow-ups at 6pm, your daily recap at 4:30am.`
      : "Add your email address in Edit profile so the reminders have somewhere to go.",
    "",
    "Reply *UNDO* to change it back.",
  ]);
}

export const FEEDBACK_REPLY = join([
  "*Thanks - noted*",
  "",
  "Your suggestion has been saved for the next round of improvements to Khata.",
]);

export function appHelpReply(answer: string): string {
  return join(["*Khata help*", "", answer]);
}
