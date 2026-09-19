// The words on each notification, in one place, so the previews in Settings
// are built by the same code as the real thing - a sample can never drift
// from what actually arrives.
//
// The phone already shows the app's name and icon (iOS adds "from Khata"
// underneath), so the title is the news itself: short, specific, never
// "Khata". The body carries the figures and what to do about them.
import type { PushMessage } from "./push.ts";
import { MONTH_NAMES, fmtDateLabel, fmtRs } from "./format.ts";

type DueItem = { key: string; id: string; name: string; amount: number; date: string };

export function subscriptionMessage(item: DueItem, stage: "before" | "due"): PushMessage {
  return {
    title: stage === "before" ? `${item.name} due tomorrow` : `${item.name} due today`,
    body:
      stage === "before"
        ? `${fmtRs(item.amount)} on ${fmtDateLabel(item.date)}. Tap to see it.`
        : `${fmtRs(item.amount)}, still unpaid. Tap to mark it paid.`,
    url: `/subscriptions?open=${encodeURIComponent(item.id)}`,
    tag: item.key,
  };
}

export function udharMessage(item: DueItem): PushMessage {
  return {
    title: `${item.name} owes you ${fmtRs(item.amount)}`,
    body: "Today is the follow-up date you set. Tap to see their khata.",
    url: `/udhar-khata?open=${encodeURIComponent(item.id)}`,
    tag: item.key,
  };
}

export function monthlySummaryMessage(month: number, key: string): PushMessage {
  return {
    title: `${MONTH_NAMES[month - 1]} is wrapped up`,
    body: "Tap to see where last month went.",
    url: "/expenses",
    tag: key,
  };
}

// `day` is "Yesterday" when that is what it means, and a date when a missed
// run is caught up later.
export function recapMessage(day: string, spent: number, expenses: number, key: string): PushMessage {
  return {
    title: expenses ? `${day}: ${fmtRs(spent)} spent` : `${day}: nothing spent`,
    body: expenses
      ? `${expenses} ${expenses === 1 ? "expense" : "expenses"} recorded. Add anything you missed.`
      : "Add anything you forgot to record.",
    url: "/expenses",
    tag: key,
  };
}

// Expenses the email routine has just added from bank alerts. One message
// per run, however many it added, so a busy afternoon is one notification
// rather than five. Each run gets its own tag, so a new batch never replaces
// one that has not been looked at yet.
export type ImportedExpense = { amount: number; vendor: string | null; category: string | null };

export function importedExpensesMessage(items: ImportedExpense[], key: string): PushMessage {
  const name = (e: ImportedExpense) => e.vendor?.trim() || "an unnamed payee";
  const uncategorised = items.filter((e) => !e.category).length;
  const url = "/expenses";
  const tag = `import:${key}`;

  if (items.length === 1) {
    const e = items[0];
    return {
      title: `${fmtRs(e.amount)} at ${name(e)}`,
      body: e.category
        ? `Added from your bank alert under ${e.category}. Tap to review it.`
        : "Added from your bank alert. Tap to give it a category.",
      url,
      tag,
    };
  }

  const total = items.reduce((sum, e) => sum + e.amount, 0);
  const shown = items.slice(0, 2).map(name);
  const rest = items.length - shown.length;
  const who = rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(" and ");
  const needs = uncategorised
    ? ` ${uncategorised === 1 ? "One needs" : `${uncategorised} need`} a category.`
    : "";
  return {
    title: `${items.length} expenses added from your bank`,
    body: `${fmtRs(total)} in all: ${who}.${needs} Tap to review.`,
    url,
    tag,
  };
}

// Which part of the app a notification is about, read from the tag it was
// sent with - the bell uses it to pick an icon.
export type NotificationKind = "subscription" | "udhar" | "expenses" | "general";

export function notificationKind(tag: string | null | undefined): NotificationKind {
  if (!tag) return "general";
  if (tag.startsWith("sub:")) return "subscription";
  if (tag.startsWith("udhar:")) return "udhar";
  if (tag.startsWith("recap:") || tag.startsWith("summary:") || tag.startsWith("import:")) return "expenses";
  return "general";
}
