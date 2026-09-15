// Tests for the daily reminder email: what counts as due, and how it reads.
import {
  buildReminderEmail,
  findDue,
  nextDueAfter,
  summaryMonth,
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

/* the email */
const empty = { subsTomorrow: [], subsToday: [], reachOut: [] };
check("nothing to say, no email", buildReminderEmail({ name: "Walli", today, due: empty, summary: null, owed: null, appUrl: "https://x" }), null);
const mail = buildReminderEmail({
  name: "Walli",
  today,
  due: findDue(today, [sub({})], [person({ name: "Ali <b>" })]),
  summary: null,
  owed: null,
  appUrl: "https://khata.example",
});
check("subject lists what's due", mail?.subject, "Khata: Netflix due tomorrow, reach out to Ali <b>");
check("text has the lines", [mail?.text.includes("- Netflix: Rs 1,500"), mail?.text.includes("- Ali <b> owes you Rs 2,000")], [true, true]);
check("html escapes names", [mail?.html.includes("Ali &lt;b&gt;"), mail?.html.includes("Ali <b>")], [true, false]);
const summaryMail = buildReminderEmail({
  name: "",
  today: "2026-09-01",
  due: empty,
  summary: { label: "August 2026", total: 37251, count: 7, top: [{ category: "Shopping", total: 15000 }] },
  owed: { total: 2700, people: 2 },
  appUrl: "https://x",
});
check("summary email", [summaryMail?.subject, summaryMail?.text.includes("Spent Rs 37,251 across 7 expenses"), summaryMail?.text.includes("Still owed to you: Rs 2,700 by 2 people")], ["Khata: your August 2026 summary", true, true]);

/* email addresses */
check("valid emails", [validEmail("a@b.co"), validEmail("walli.ullah+khata@gmail.com")], [true, true]);
check("invalid emails", [validEmail("a@b"), validEmail("no at.com"), validEmail("@b.com"), validEmail("a@b.c")], [false, false, false, false]);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
