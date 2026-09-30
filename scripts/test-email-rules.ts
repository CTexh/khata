// The rules the Gmail import works by, and the reading of a Gmail message.
// Run with: node --experimental-strip-types scripts/test-email-rules.ts
import {
  FIRST_RUN_SECONDS,
  MAX_LOOKBACK_SECONDS,
  OVERLAP_SECONDS,
  checkDecision,
  excludedMerchant,
  excludedPayee,
  noteFromEmail,
  ownAccountName,
  pakistanClock,
  tidyVendor,
  searchQuery,
  syncWindow,
} from "../src/lib/email-rules.ts";
import {
  decodeBase64Url,
  headerValue,
  plainTextFromPayload,
  stripHtml,
} from "../src/lib/gmail.ts";

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

/* ---------- the stretch of time a run covers ---------- */

const nowSec = 1_760_000_000;
const nowMs = nowSec * 1000;

check("a first run sweeps a day", syncWindow(nowMs, null), {
  startSec: nowSec - FIRST_RUN_SECONDS,
  endSec: nowSec,
});
check("an ordinary run starts where the last stopped, an hour earlier", syncWindow(nowMs, nowSec - 900), {
  startSec: nowSec - 900 - OVERLAP_SECONDS,
  endSec: nowSec,
});
check("a long outage reaches back only so far", syncWindow(nowMs, nowSec - 400 * 24 * 3600), {
  startSec: nowSec - MAX_LOOKBACK_SECONDS,
  endSec: nowSec,
});
// A bookmark from the future (a clock that moved) must not make the window run
// backwards, which Gmail would read as no window at all.
check("a bookmark ahead of now never inverts the window", syncWindow(nowMs, nowSec + 5000).startSec <= nowSec, true);

check(
  "the search asks for the three banks",
  searchQuery({ startSec: 100, endSec: 200 }),
  "(from:bankalhabib.com OR from:abl.com OR from:meezanbank.com) after:100 before:200"
);

/* ---------- payments that are not expenses ---------- */

check("a transfer to your own company account", ownAccountName("CHATTHA TECHNOLOGIES"), "chattha technologies");
check("punctuation and case are ignored", ownAccountName("SADAPAY*WALLI-ULLAH"), "walli ullah");
check("a shop is not one of your accounts", ownAccountName("Coffee Planet"), null);
check("an empty payee matches nothing", ownAccountName(""), null);
check("a payee of spaces matches nothing", ownAccountName("   "), null);

check("a subscription payee", excludedMerchant("ZONG PREPAID TOPUP"), "zong");
check("however it is spelled on the statement", excludedMerchant("Chrunchyroll"), "chrunchyroll");
check("the company behind the subscription", excludedMerchant("OPENAI *CHATGPT SUBSCR"), "chatgpt");
check("an ordinary merchant is not excluded", excludedMerchant("Foodpanda"), null);

check(
  "and the reason says which",
  excludedPayee("Netflix.com"),
  "subscription paid to netflix, tracked on the subscriptions screen"
);
check(
  "a transfer says so too",
  excludedPayee("Walli Ullah - Meezan"),
  "transfer between your own accounts (walli ullah)"
);
check("a normal payment is not excluded", excludedPayee("PSO Lahore"), null);

/* ---------- checking what the model answered ---------- */

const today = "2026-10-01";
const expense = {
  source_id: "abc123",
  kind: "expense",
  amount: 4324,
  date: "2026-10-01",
  vendor: "Foodpanda",
  category: "Food",
  note: "card payment, Bank Al Habib, 14:03",
};

check("a good answer becomes an expense", checkDecision(expense, today), {
  kind: "expense",
  amount: 4324,
  date: "2026-10-01",
  vendor: "Foodpanda",
  category: "Food",
  note: "card payment, Bank Al Habib, 14:03",
});
check("paisa are kept, nothing beyond them", checkDecision({ ...expense, amount: 1234.567 }, today), {
  kind: "expense",
  amount: 1234.57,
  date: "2026-10-01",
  vendor: "Foodpanda",
  category: "Food",
  note: "card payment, Bank Al Habib, 14:03",
});
check("a skip keeps its reason", checkDecision({ source_id: "a", kind: "skip", reason: "money received" }, today), {
  kind: "skip",
  reason: "money received",
});
check("a skip with no reason still says something", checkDecision({ source_id: "a", kind: "skip" }, today), {
  kind: "skip",
  reason: "not a payment out of an account",
});

// Anything the model got wrong must not reach the ledger.
check("no amount", checkDecision({ ...expense, amount: undefined }, today), {
  kind: "skip",
  reason: "attention: no amount could be read from this alert",
});
check("an amount of zero", checkDecision({ ...expense, amount: 0 }, today), {
  kind: "skip",
  reason: "attention: no amount could be read from this alert",
});
check("an amount that is not a number", checkDecision({ ...expense, amount: "4,324" }, today), {
  kind: "skip",
  reason: "attention: no amount could be read from this alert",
});
check("an absurd amount", checkDecision({ ...expense, amount: 99_000_000 }, today), {
  kind: "skip",
  reason: "attention: amount 99000000 looks wrong, so it was left out",
});
check("a date in another format", checkDecision({ ...expense, date: "01-10-2026" }, today), {
  kind: "skip",
  reason: "attention: no date could be read from this alert",
});
check("a date that does not exist", checkDecision({ ...expense, date: "2026-02-31" }, today), {
  kind: "skip",
  reason: "attention: no date could be read from this alert",
});
check("a date after today", checkDecision({ ...expense, date: "2026-10-02" }, today), {
  kind: "skip",
  reason: "attention: the date read was 2026-10-02, which is in the future",
});
check("yesterday is fine", checkDecision({ ...expense, date: "2026-09-30" }, today).kind, "expense");

// The exclusion lists overrule the model, whatever it decided.
check("a subscription the model called an expense", checkDecision({ ...expense, vendor: "Spotify AB" }, today), {
  kind: "skip",
  reason: "subscription paid to spotify, tracked on the subscriptions screen",
});
check("a transfer the model called an expense", checkDecision({ ...expense, vendor: "JazzCash" }, today), {
  kind: "skip",
  reason: "transfer between your own accounts (jazzcash)",
});
check("an expense with no payee is still an expense", checkDecision({ ...expense, vendor: "" }, today), {
  kind: "expense",
  amount: 4324,
  date: "2026-10-01",
  vendor: null,
  category: "Food",
  note: "card payment, Bank Al Habib, 14:03",
});
check("no category is no category", checkDecision({ ...expense, category: "" }, today).kind === "expense", true);

/* ---------- the payee, as a name and nothing else ---------- */

check("an ordinary name is left alone", tidyVendor("Foodpanda"), "Foodpanda");
check("a name with a place is left alone", tidyVendor("PSO Lahore Cantt"), "PSO Lahore Cantt");
check(
  "other fields run into it are cut off",
  tidyVendor("Foodpanda PK LHR ID: 4417 Time: 14:03 note: card payment"),
  "Foodpanda PK LHR"
);
check("a reference is cut off", tidyVendor("Careem Ref# 88213"), "Careem");
check("a second line is not part of the name", tidyVendor("Metro Cash & Carry\nAmount: 4,324"), "Metro Cash & Carry");
check("and neither is anything past a pipe", tidyVendor("Daraz.pk | order 7781"), "Daraz.pk");
check("trailing punctuation goes", tidyVendor("  K-Electric ,  "), "K-Electric");
check("nothing in, nothing out", tidyVendor(""), "");
check("a name that is only a separator", tidyVendor(" - "), "");

/* ---------- describing an alert the model said nothing about ---------- */

// 2026-10-01T09:03:00Z is 14:03 in Pakistan.
check("the clock is Pakistan's", pakistanClock(Date.UTC(2026, 9, 1, 9, 3)), "14:03");
check("and rolls over the day", pakistanClock(Date.UTC(2026, 9, 1, 20, 30)), "01:30");
check("no time, nothing said", pakistanClock(0), "");
check(
  "a note built from the alert itself",
  noteFromEmail("Debit Alert", "Alerts <alerts@bankalhabib.com>", Date.UTC(2026, 9, 1, 9, 3)),
  "Debit Alert, bankalhabib.com, 14:03 PKT"
);
check(
  "a bare address still gives the bank",
  noteFromEmail("ATM Withdrawal", "alerts@abl.com", Date.UTC(2026, 9, 1, 9, 3)),
  "ATM Withdrawal, abl.com, 14:03 PKT"
);

/* ---------- reading a Gmail message ---------- */

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

check("headers are found whatever their case", headerValue([{ name: "SuBjEcT", value: "Debit Alert" }], "subject"), "Debit Alert");
check("a missing header is empty", headerValue([], "subject"), "");
check("no headers at all", headerValue(undefined, "from"), "");
check("base64url, as Gmail sends it", decodeBase64Url(b64("Rs 4,324 - PSO")), "Rs 4,324 - PSO");

check(
  "a table becomes lines",
  stripHtml("<table><tr><td>Amount</td><td>PKR&nbsp;4,324</td></tr><tr><td>Payee</td><td>PSO</td></tr></table>"),
  "Amount PKR 4,324\nPayee PSO"
);
check("scripts and styles go", stripHtml("<style>p{color:red}</style><p>Debit</p><script>x()</script>"), "Debit");
check("entities come back", stripHtml("<p>Ali &amp; Sons &#39;Lahore&#39;</p>"), "Ali & Sons 'Lahore'");

check(
  "plain text is preferred",
  plainTextFromPayload({
    mimeType: "multipart/alternative",
    parts: [
      { mimeType: "text/plain", body: { data: b64("Debit of PKR 4,324") } },
      { mimeType: "text/html", body: { data: b64("<p>ignored</p>") } },
    ],
  }),
  "Debit of PKR 4,324"
);
check(
  "an HTML-only alert is stripped",
  plainTextFromPayload({ mimeType: "text/html", body: { data: b64("<p>Debit of PKR 4,324</p>") } }),
  "Debit of PKR 4,324"
);
check(
  "text nested deeper is still found",
  plainTextFromPayload({
    mimeType: "multipart/mixed",
    parts: [{ mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64("found") } }] }],
  }),
  "found"
);
check(
  "an attached statement is not the message",
  plainTextFromPayload({
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "text/plain", body: { data: b64("see attached") } },
      { mimeType: "text/plain", filename: "statement.txt", body: { data: b64("a whole month") } },
    ],
  }),
  "see attached"
);
check("a message with no body at all", plainTextFromPayload(undefined), "");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
