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
