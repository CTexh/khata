// Every reply Khata sends on WhatsApp, in one place so they all share one
// layout: a bold heading, a blank line, one fact per line, and the UNDO hint
// set apart at the end. WhatsApp renders *text* as bold.
// Relative import with an extension so this also runs under
// scripts/test-whatsapp.ts, where the @/ alias doesn't exist.
import { fmtDateLabel, fmtRs } from "./format.ts";

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
  return join(out);
}

// A reason from validation, e.g. "The amount needs to be more than zero."
export function refusalReply(reason: string): string {
  return join(["*Nothing added*", "", reason]);
}

export const HELP_REPLY = join([
  "*Khata on WhatsApp*",
  "",
  "*Expenses*",
  "fuel 3000 shell",
  "dinner 2.5k yesterday",
  "or a photo of a bill or receipt",
  "",
  "*Udhar Khata*",
  "add 700 each to Usama and Ali",
  "Ali paid me back 1000",
  "",
  "Reply *UNDO* to remove the last thing I added.",
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

export const UNSUPPORTED_REPLY = join([
  "I can read text messages and photos of bills.",
  "",
  "Send *HELP* for examples.",
]);

export function ambiguousPersonReply(name: string): string {
  return join([
    "*Nothing added*",
    "",
    `You have more than one ${name} in Udhar Khata, so I can't tell which one you mean. Rename one of them in the app, then send it again.`,
  ]);
}
