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

// 4am every day: a nudge to add whatever the bank emails will never show -
// cash, a payment to a person, anything forgotten. Tapping it opens the
// add-expense form directly.
export function missedExpensesMessage(key: string): PushMessage {
  return {
    title: "Missed any expenses yesterday?",
    body: "Add anything you paid in cash or forgot to log. Tap to add it.",
    url: "/expenses?add=1",
    tag: key,
  };
}

// Expenses the email routine has just added from bank alerts. One message
// per run, however many it added, so a busy afternoon is one notification
// rather than five. Each run gets its own tag, so a new batch never replaces
// one that has not been looked at yet.
export type ImportedExpense = { amount: number; vendor: string | null; category: string | null };

const payee = (vendor: string | null) => vendor?.trim() || "an unnamed payee";

export function importedExpensesMessage(items: ImportedExpense[], key: string): PushMessage {
  const url = "/expenses";
  const tag = `import:${key}`;

  if (items.length === 1) {
    const e = items[0];
    return {
      title: `${fmtRs(e.amount)} at ${payee(e.vendor)}`,
      body: `Added from your bank alert under ${e.category ?? "a category"}. Tap to review it.`,
      url,
      tag,
    };
  }

  const total = items.reduce((sum, e) => sum + e.amount, 0);
  const shown = items.slice(0, 2).map((e) => payee(e.vendor));
  const rest = items.length - shown.length;
  const who = rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(" and ");
  return {
    title: `${items.length} expenses added from your bank`,
    body: `${fmtRs(total)} in all: ${who}. Tap to review.`,
    url,
    tag,
  };
}

// An expense the routine added without a category gets a notification of its
// own, which opens that very expense - so the category can be set in one tap
// from the lock screen instead of hunting for it in the list.
export function uncategorisedExpenseMessage(e: { id: string; amount: number; vendor: string | null }): PushMessage {
  return {
    title: `${fmtRs(e.amount)} at ${payee(e.vendor)} needs a category`,
    body: "Added from your bank alert. Tap to choose one.",
    url: `/expenses?open=${encodeURIComponent(e.id)}`,
    tag: `uncat:${e.id}`,
  };
}

// More uncategorised expenses than it is reasonable to notify about one by
// one in a single run: the first few individually, the rest in one of these.
export function uncategorisedRollupMessage(count: number, key: string): PushMessage {
  return {
    title: `${count} more expenses need a category`,
    body: "Added from your bank alerts. Tap to sort them out.",
    url: "/expenses",
    tag: `uncat-more:${key}`,
  };
}

// Which part of the app a notification is about, read from the tag it was
// sent with - the bell uses it to pick an icon.
export type NotificationKind = "subscription" | "udhar" | "expenses" | "general";

export function notificationKind(tag: string | null | undefined): NotificationKind {
  if (!tag) return "general";
  if (tag.startsWith("sub:")) return "subscription";
  if (tag.startsWith("udhar:")) return "udhar";
  if (
    tag.startsWith("missed:") ||
    tag.startsWith("summary:") ||
    tag.startsWith("import:") ||
    tag.startsWith("uncat")
  )
    return "expenses";
  return "general";
}
