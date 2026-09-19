// Tests for the reminders: what counts as due on a day, and what a day's
// recap contains.
import {
  buildRecap,
  recapIsEmpty,
  pakistanDayWindow,
  findDue,
  nextDueAfter,
  summaryMonth,
  type ReminderPerson,
  type ReminderSubscription,
} from "../src/lib/reminders.ts";
import {
  importedExpensesMessage,
  monthlySummaryMessage,
  notificationKind,
  recapMessage,
  subscriptionMessage,
  udharMessage,
} from "../src/lib/reminder-messages.ts";
import { fmtAgo } from "../src/lib/format.ts";

let pass = 0;
let fail = 0;
function check(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL ${label}\n     got: ${JSON.stringify(got)}  want: ${JSON.stringify(want)}`);
  }
}

const today = "2026-09-15";
const sub = (o: Partial<ReminderSubscription>): ReminderSubscription => ({
  id: "s1",
  name: "Netflix",
  amount: 1500,
  active: true,
  due_day: 16,
  current_period: "2026-09",
  current_due_date: "2026-09-16",
  paid_this_period: false,
  ...o,
});
const person = (o: Partial<ReminderPerson>): ReminderPerson => ({ id: "p1", name: "Ali", balance: 2000, dueDate: today, ...o });

/* what's due */
check("due tomorrow, unpaid", findDue(today, [sub({})], []).subsTomorrow.map((i) => i.key), ["sub:s1:2026-09-16:before"]);
check("due today, unpaid", findDue(today, [sub({ current_due_date: today, due_day: 15 })], []).subsToday.map((i) => i.key), ["sub:s1:2026-09-15:due"]);
check("items carry the record id", findDue(today, [sub({})], [person({})]).reachOut[0].id, "p1");
check("paid today not reminded", findDue(today, [sub({ current_due_date: today, paid_this_period: true, due_day: 15 })], []).subsToday, []);
check("paused ignored", findDue(today, [sub({ active: false })], []).subsTomorrow, []);
check("overdue not repeated daily", findDue(today, [sub({ current_due_date: "2026-09-05", due_day: 5 })], []), { subsTomorrow: [], subsToday: [], reachOut: [] });
check(
  "paid this month, next month's due tomorrow",
  findDue("2026-09-30", [sub({ due_day: 1, current_due_date: "2026-09-01", paid_this_period: true })], []).subsTomorrow.map((i) => i.date),
  ["2026-10-01"]
);
check("reach out today", findDue(today, [], [person({})]).reachOut.map((i) => i.key), ["udhar:p1:2026-09-15"]);
check("settled person not reminded", findDue(today, [], [person({ balance: 0 })]).reachOut, []);
check("other day not reminded", findDue(today, [], [person({ dueDate: "2026-09-20" })]).reachOut, []);

/* dates */
check("next due rolls the year", nextDueAfter("2026-12", 31), "2027-01-31");
check("next due clamps short months", nextDueAfter("2027-01", 31), "2027-02-28");
check("summary only on the 1st", [summaryMonth("2026-09-15"), summaryMonth("2026-09-01")?.key], [null, "summary:2026-08"]);
check("summary on 1 Jan is December", summaryMonth("2027-01-01")?.key, "summary:2026-12");

/* daily recap */
check("Pakistan day window", pakistanDayWindow("2026-09-15"), { from: "2026-09-14T19:00:00.000Z", to: "2026-09-15T19:00:00.000Z" });
const recap = await buildRecap("2026-09-15", {
  expenses: async () => [
    { amount: 3000, vendor: "Shell", note: "fuel", category: "Car" },
    { amount: 1200, vendor: null, note: "Assistant: dinner", category: null },
  ],
  ledger: async () => [
    { name: "Ali", amount: 500 },
    { name: "Usama", amount: -300 },
  ],
  subscriptions: async () => [
    { name: "Netflix", amount: 1500, active: true, history: [{ due_date: "2026-09-15", paid_at: null }] },
    { name: "Spotify", amount: 900, active: true, history: [{ due_date: "2026-09-05", paid_at: "2026-09-15T08:00:00.000Z" }] },
    { name: "Gym", amount: 5000, active: true, history: [{ due_date: "2026-09-01", paid_at: "2026-09-15T20:00:00.000Z" }] },
  ],
});
check("recap expense labels", recap.expenses.map((e) => e.label), ["Shell · Car", "dinner"]);
check("recap due and paid", [recap.subsDue, recap.subsPaid.map((s) => s.name)], [[{ name: "Netflix", amount: 1500, paid: false }], ["Spotify"]]);
// A day on which nothing at all happened is not notified.
check(
  "a day with nothing on it is empty",
  recapIsEmpty({ date: "2026-09-15", expenses: [], ledger: [], subsDue: [], subsPaid: [] }),
  true
);
check(
  "one expense is enough to be worth sending",
  recapIsEmpty({ date: "2026-09-15", expenses: [{ label: "Shell", amount: 3000 }], ledger: [], subsDue: [], subsPaid: [] }),
  false
);
check(
  "an Udhar Khata entry on its own counts",
  recapIsEmpty({ date: "2026-09-15", expenses: [], ledger: [{ name: "Ali", amount: 700 }], subsDue: [], subsPaid: [] }),
  false
);
check(
  "a subscription falling due counts",
  recapIsEmpty({ date: "2026-09-15", expenses: [], ledger: [], subsDue: [{ name: "Netflix", amount: 1200, paid: false }], subsPaid: [] }),
  false
);
check(
  "a subscription marked paid counts",
  recapIsEmpty({ date: "2026-09-15", expenses: [], ledger: [], subsDue: [], subsPaid: [{ name: "Netflix", amount: 1200 }] }),
  false
);
/* ---------- the words on each notification ---------- */

const item = { key: "sub:s1:2026-09-17:before", id: "s 1", name: "Netflix", amount: 1200, date: "2026-09-17" };
check("a subscription due tomorrow", subscriptionMessage(item, "before"), {
  title: "Netflix due tomorrow",
  body: "Rs 1,200 on 17 Sept 2026. Tap to see it.",
  url: "/subscriptions?open=s%201",
  tag: item.key,
});
check("one due today", subscriptionMessage(item, "due").body, "Rs 1,200, still unpaid. Tap to mark it paid.");
check("a follow-up", udharMessage({ ...item, name: "Ali", amount: 700 }).title, "Ali owes you Rs 700");
check("a recap", recapMessage("Yesterday", 3700, 2, "k"), {
  title: "Yesterday: Rs 3,700 spent",
  body: "2 expenses recorded. Add anything you missed.",
  url: "/expenses",
  tag: "k",
});
check("a recap of a day with nothing on it", recapMessage("Yesterday", 0, 0, "k").title, "Yesterday: nothing spent");
check("a month wrapped up", monthlySummaryMessage(8, "k").title, "August is wrapped up");

// The phone already shows the app's name: a title that repeats it wastes the
// only line anyone reads.
check(
  "no notification says Khata in its title",
  [subscriptionMessage(item, "due"), udharMessage(item), recapMessage("Yesterday", 1, 1, "k"), monthlySummaryMessage(8, "k")].some(
    (m) => m.title.includes("Khata")
  ),
  false
);


// The bell: which part of the app each notification belongs to, from its tag.
check("kind: subscription", notificationKind("sub:s1:2026-09-17:before"), "subscription");
check("kind: udhar", notificationKind("udhar:p1:2026-09-17"), "udhar");
check("kind: recap", notificationKind("recap:2026-09-16"), "expenses");
check("kind: monthly summary", notificationKind("summary:2026-08"), "expenses");
check("kind: the switch-on confirmation", notificationKind("khata-test"), "general");
check("kind: no tag", notificationKind(null), "general");

// How long ago, against a fixed moment. Local times throughout, so the result
// does not depend on the machine's time zone.
{
  const now = new Date(2026, 8, 16, 15, 0, 0); // Wed 16 Sept 2026, 3pm
  const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => new Date(y, mo, d, h, mi, s).toISOString();
  check("ago: seconds", fmtAgo(at(2026, 8, 16, 14, 59, 30), now), "Just now");
  check("ago: minutes", fmtAgo(at(2026, 8, 16, 14, 55), now), "5 min ago");
  check("ago: hours, same day", fmtAgo(at(2026, 8, 16, 12, 0), now), "3 hr ago");
  check("ago: last night is yesterday, not hours", fmtAgo(at(2026, 8, 15, 23, 0), now), "Yesterday");
  check("ago: yesterday", fmtAgo(at(2026, 8, 15, 9, 0), now), "Yesterday");
  check("ago: this week", fmtAgo(at(2026, 8, 13, 9, 0), now), "Sunday");
  check("ago: older", fmtAgo(at(2026, 8, 2, 9, 0), now), "2 Sept");
  check("ago: last year", fmtAgo(at(2025, 11, 20, 9, 0), now), "20 Dec 2025");
}


// Expenses the email routine added: one notification per run.
check("one import", importedExpensesMessage([{ amount: 4324, vendor: "Euro Food Town", category: "Groceries" }], "m1"), {
  title: "Rs 4,324 at Euro Food Town",
  body: "Added from your bank alert under Groceries. Tap to review it.",
  url: "/expenses",
  tag: "import:m1",
});
check(
  "one import without a category asks for one",
  importedExpensesMessage([{ amount: 160, vendor: "PSO LAHORE", category: null }], "m2").body,
  "Added from your bank alert. Tap to give it a category."
);
check(
  "two imports",
  importedExpensesMessage(
    [
      { amount: 5020, vendor: "White Gold Fill", category: "Car" },
      { amount: 4324, vendor: "Euro Food Town", category: "Groceries" },
    ],
    "m3"
  ),
  {
    title: "2 expenses added from your bank",
    body: "Rs 9,344 in all: White Gold Fill and Euro Food Town. Tap to review.",
    url: "/expenses",
    tag: "import:m3",
  }
);
check(
  "four imports, one uncategorised",
  importedExpensesMessage(
    [
      { amount: 100, vendor: "A", category: "Car" },
      { amount: 200, vendor: "B", category: null },
      { amount: 300, vendor: "C", category: "Car" },
      { amount: 400, vendor: "D", category: "Car" },
    ],
    "m4"
  ).body,
  "Rs 1,000 in all: A, B and 2 more. One needs a category. Tap to review."
);
check("an import with no payee", importedExpensesMessage([{ amount: 50, vendor: null, category: "Car" }], "m5").title, "Rs 50 at an unnamed payee");
check("kind: an import", notificationKind("import:m1"), "expenses");
check(
  "no import title says Khata",
  importedExpensesMessage([{ amount: 1, vendor: "X", category: null }], "k").title.includes("Khata"),
  false
);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
