// Tests for reminder emails: what counts as due, and how each email reads.
import {
  findDue,
  longDate,
  monthlySummaryEmail,
  nextDueAfter,
  subscriptionReminderEmail,
  summaryMonth,
  udharReminderEmail,
  validEmail,
  type ReminderPerson,
  type ReminderSubscription,
} from "../src/lib/reminders.ts";

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
check("long date", longDate("2026-09-16"), "Wednesday, 16 September 2026");

/* subscription emails */
const url = "https://khata.example";
const item = { key: "k", id: "s 1", name: "Netflix", amount: 1500, date: "2026-09-16" };
const before = subscriptionReminderEmail({ name: "Walli", item, stage: "before", appUrl: url });
check("header has the logo and name", [before.html.includes(`src="${url}/icon-192.png"`), before.html.includes(">Khata</span>")], [true, true]);
check("before subject", before.subject, "Reminder: Netflix payment of Rs 1,500 is due tomorrow");
check("before links to the record", before.html.includes(`${url}/subscriptions?open=s%201`) && before.text.includes(`${url}/subscriptions?open=s%201`), true);
check("before body", [before.text.includes("Dear Walli,"), before.text.includes("due tomorrow, Wednesday, 16 September 2026"), before.html.includes("Upcoming")], [true, true, true]);
const dueToday = subscriptionReminderEmail({ name: "", item, stage: "due", appUrl: url });
check("due subject", dueToday.subject, "Due today: Netflix payment of Rs 1,500");
check("due body", [dueToday.text.includes("Hello,"), dueToday.text.includes("has not yet been marked as paid"), dueToday.html.includes("Unpaid")], [true, true, true]);

/* udhar email */
const udhar = udharReminderEmail({ name: "Walli", item: { key: "k", id: "p1", name: "Ali <b>", amount: 2000, date: today }, appUrl: url });
check("udhar subject", udhar.subject, "Reminder: Ali <b> owes you Rs 2,000 - follow up today");
check("udhar amount and link", [udhar.text.includes("Amount due"), udhar.text.includes("Rs 2,000"), udhar.html.includes(`${url}/udhar-khata?open=p1`)], [true, true, true]);
check("udhar escapes names", [udhar.html.includes("Ali &lt;b&gt;"), udhar.html.includes("Ali <b>")], [true, false]);

/* summary email */
const summary = monthlySummaryEmail({
  name: "Walli",
  summary: { label: "August 2026", total: 37251, count: 7, top: [{ category: "Shopping", total: 15000 }] },
  owed: { total: 2700, people: 2 },
  appUrl: url,
});
check("summary subject", summary.subject, "Your Khata summary for August 2026");
check("summary rows", [summary.text.includes("Rs 37,251"), summary.text.includes("Top category: Shopping"), summary.text.includes("Rs 2,700 (2 people)")], [true, true, true]);
const quiet = monthlySummaryEmail({ name: "", summary: { label: "August 2026", total: 0, count: 0, top: [] }, owed: { total: 0, people: 0 }, appUrl: url });
check("empty month", [quiet.text.includes("No expenses were recorded in August 2026."), quiet.text.includes("Nothing outstanding")], [true, true]);

/* email addresses */
check("valid emails", [validEmail("a@b.co"), validEmail("walli.ullah+khata@gmail.com")], [true, true]);
check("invalid emails", [validEmail("a@b"), validEmail("no at.com"), validEmail("@b.com"), validEmail("a@b.c")], [false, false, false, false]);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
