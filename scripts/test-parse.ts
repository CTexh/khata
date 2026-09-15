import { detectCommand } from "../src/lib/assistant-actions.ts";
import {
  BUSY_COOLDOWN_MS,
  BROKEN_COOLDOWN_MS,
  RATE_LIMIT_COOLDOWN_MS,
  GEMINI_BUDGET_MS,
  IMAGE_ATTEMPT_MS,
  MAX_AMOUNT,
  MAX_ATTEMPTS,
  MAX_LEDGER_ENTRIES,
  MIN_ATTEMPT_MS,
  RECENT_OK_MS,
  RETRY_BACKOFF_MS,
  TEXT_ATTEMPT_MS,
  attemptTimeout,
  classifyStatus,
  mentionsPerson,
  asksForNewPerson,
  newPersonName,
  orderCandidates,
  pakistanToday,
  parseOffline,
  personKey,
  pickFlashModel,
  planSecondPass,
  rankFlashModels,
  matchCategory,
  periodRange,
  usesThinking,
  validateParsed,
  type Attempt,
  type ModelHealth,
} from "../src/lib/expense-parse.ts";
import {
  BUSY_REPLY,
  HELP_REPLY,
  ambiguousPersonReply,
  balanceLine,
  expenseAddedReply,
  ledgerReply,
  refusalReply,
  undoReply,
  dueDateReply,
  periodLabel,
  recentExpensesReply,
  spendingReply,
  whenPhrase,
  subscriptionsDueReply,
  udharPersonReply,
  udharSummaryReply,
  withTranscript,
  QUESTION_REFUSAL_HEADING,
} from "../src/lib/assistant-replies.ts";
import { encodeWav } from "../src/lib/wav.ts";
import { fmtDateLabel } from "../src/lib/format.ts";
import { splitBold } from "../src/lib/chat-format.ts";

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

/* commands */
check("cmd undo", detectCommand("UNDO"), "undo");
check("cmd undo punctuation", detectCommand(" undo! "), "undo");
check("cmd help", detectCommand("help"), "help");
check("cmd ?", detectCommand("?"), "help");
check("cmd not in a sentence", detectCommand("undo the fuel one"), null);
check("cmd expense", detectCommand("fuel 3000"), null);

/* expense validation */
const today = "2026-09-15";
const ok = (raw: unknown) => validateParsed(raw, today);
const exp = (raw: Record<string, unknown>) => validateParsed({ intent: "expense", ...raw }, today) as any;
check("valid basic", ok({ intent: "expense", amount: 3000, vendor: " Shell ", note: "fuel", date: "2026-09-15", category_hint: "Car" }), {
  ok: true,
  kind: "expense",
  expense: { amount: 3000, vendor: "Shell", note: "fuel", date: "2026-09-15", categoryHint: "Car" },
});
check("intent case-insensitive", exp({ intent: " EXPENSE ", amount: 5 }).ok, true);
check("valid string amount", exp({ amount: "1200" }).expense?.amount, 1200);
check("valid rounds to paisa", exp({ amount: 99.999 }).expense?.amount, 100);
check("reject other intent", ok({ intent: "other", amount: 50 }).ok, false);
check("reject missing intent", ok({ amount: 50 }).ok, false);
check("reject unknown intent", ok({ intent: "transfer", amount: 50 }).ok, false);
check("reject missing amount", exp({}).ok, false);
check("reject null amount", exp({ amount: null }).ok, false);
check("reject zero", exp({ amount: 0 }).ok, false);
check("reject negative", exp({ amount: -500 }).ok, false);
check("reject absurd", exp({ amount: MAX_AMOUNT + 1 }).ok, false);
check("accept at cap", exp({ amount: MAX_AMOUNT }).ok, true);
check("reject garbage", ok("hello").ok, false);
check("reject null", ok(null).ok, false);
check("reject USD", exp({ amount: 20, currency: "USD" }).ok, false);
check("accept PKR", exp({ amount: 20, currency: "PKR" }).ok, true);
check("accept Rs", exp({ amount: 20, currency: "Rs" }).ok, true);
check("date default when missing", exp({ amount: 1 }).expense.date, today);
check("date yesterday kept", exp({ amount: 1, date: "2026-09-14" }).expense.date, "2026-09-14");
check("date future -> today", exp({ amount: 1, date: "2026-09-20" }).expense.date, today);
check("date >1yr -> today", exp({ amount: 1, date: "2024-01-01" }).expense.date, today);
check("date malformed -> today", exp({ amount: 1, date: "15/09/2026" }).expense.date, today);
check("date invalid -> today", exp({ amount: 1, date: "2026-13-45" }).expense.date, today);
check("note falls back to vendor", exp({ amount: 1, vendor: "Euro" }).expense.note, "Euro");
check("note falls back to Expense", exp({ amount: 1 }).expense.note, "Expense");
check("empty hint -> null", exp({ amount: 1, category_hint: "  " }).expense.categoryHint, null);

/* Udhar Khata validation: names must already be in the khata */
const people = ["Usama Irtaza", "Abdur Rehman", "Ali"];
const led = (raw: Record<string, unknown>) => validateParsed(raw, today, people) as any;
check("person key ignores case, spaces, punctuation", [personKey("Abdur Rehman"), personKey("abdurrehman"), personKey("ABDUR-REHMAN")], ["abdurrehman", "abdurrehman", "abdurrehman"]);
check(
  "lend 700 each to two people",
  led({ intent: "lend", entries: [{ person: "usama irtaza", amount: 700 }, { person: "abdurrehman", amount: 700 }] }),
  { ok: true, kind: "ledger", ledger: { direction: "lend", entries: [{ person: "Usama Irtaza", amount: 700, isNew: false }, { person: "Abdur Rehman", amount: 700, isNew: false }], note: null } }
);
check(
  "repayment 1000",
  led({ intent: "repayment", entries: [{ person: "Abdur Rehman", amount: 1000 }], note: " cash " }),
  { ok: true, kind: "ledger", ledger: { direction: "repayment", entries: [{ person: "Abdur Rehman", amount: 1000, isNew: false }], note: "cash" } }
);
check("ledger string amount", led({ intent: "lend", entries: [{ person: "ALI", amount: "1.5e3" }] }).ledger?.entries, [{ person: "Ali", amount: 1500, isNew: false }]);
check("unknown person refused", led({ intent: "lend", entries: [{ person: "Bilal", amount: 500 }] }).ok, false);
check("unknown person named in reply", led({ intent: "lend", entries: [{ person: "Bilal", amount: 500 }] }).reason.includes("Bilal"), true);
check("one unknown blocks the whole message", led({ intent: "lend", entries: [{ person: "Ali", amount: 500 }, { person: "Bilal", amount: 500 }] }).ok, false);
check("empty khata refuses every name", validateParsed({ intent: "lend", entries: [{ person: "Ali", amount: 5 }] }, today, []).ok, false);
check("no entries refused", led({ intent: "repayment", entries: [] }).ok, false);
check("entries missing refused", led({ intent: "lend", amount: 700 }).ok, false);
check("ledger negative refused", led({ intent: "lend", entries: [{ person: "Ali", amount: -5 }] }).ok, false);
check("ledger zero refused", led({ intent: "repayment", entries: [{ person: "Ali", amount: 0 }] }).ok, false);
check("ledger absurd refused", led({ intent: "lend", entries: [{ person: "Ali", amount: MAX_AMOUNT + 1 }] }).ok, false);
check("ledger missing name refused", led({ intent: "lend", entries: [{ person: " ", amount: 5 }] }).ok, false);
check("same person twice refused", led({ intent: "lend", entries: [{ person: "Ali", amount: 5 }, { person: "ali", amount: 6 }] }).ok, false);
check("ledger USD refused", led({ intent: "lend", currency: "USD", entries: [{ person: "Ali", amount: 5 }] }).ok, false);
check(
  "too many entries refused",
  led({ intent: "lend", entries: Array.from({ length: MAX_LEDGER_ENTRIES + 1 }, () => ({ person: "Ali", amount: 1 })) }).ok,
  false
);

/* reading text without AI: simple expenses only */
const off = (t: string) => parseOffline(t, today, people) as any;
check("offline fuel", off("fuel 3000 shell"), { ok: true, kind: "expense", expense: { amount: 3000, vendor: null, note: "fuel shell", date: today, categoryHint: null } });
check("offline 2.5k yesterday", [off("dinner 2.5k yesterday").expense?.amount, off("dinner 2.5k yesterday").expense?.date, off("dinner 2.5k yesterday").expense?.note], [2500, "2026-09-14", "dinner"]);
check("offline Rs 1,200", [off("Rs 1,200 groceries").expense?.amount, off("Rs 1,200 groceries").expense?.note], [1200, "groceries"]);
check("offline 3000rs for petrol", [off("spent 3000rs for petrol").expense?.amount, off("spent 3000rs for petrol").expense?.note], [3000, "petrol"]);
check("offline 2 lac rent", off("2 lac rent").expense?.amount, 200000);
check("offline 1.5 lakhs", off("car service 1.5 lakhs").expense?.amount, 150000);
check("offline note only amount", off("3000").expense?.note, "Expense");
check("offline no number refused", off("fuel shell").ok, false);
check("offline two numbers refused", off("dinner 2500 on 12 sep").ok, false);
check("offline phone number refused", off("03001234567").ok, false);
check("offline zero refused", off("fuel 0").ok, false);
check("offline empty refused", off("").ok, false);
check("offline paid back refused", off("abdurrehman paid me back 1000").ok, false);
check("offline udhar words refused", [off("add 700 to khata").ok, off("gave 500 udhar").ok, off("lent 200").ok, off("got 300 back from him").ok], [false, false, false, false]);
check("offline known name refused", off("ali 500").ok, false);
check("offline name run together refused", off("abdurrehman 500").ok, false);
check("offline name inside a word allowed", off("quality 500").ok, true);
check("mentions whole words only", [mentionsPerson("ali 500", "Ali"), mentionsPerson("quality 500", "Ali"), mentionsPerson("to Abdur-Rehman", "Abdur Rehman"), mentionsPerson("x", "")], [true, false, true, false]);

/* model ranking: stable Flash newest first, then Flash-Lite, then listed aliases */
check(
  "rank order",
  rankFlashModels([
    "models/gemini-2.5-flash-lite",
    "models/gemini-flash-latest",
    "models/gemini-3.8-flash",
    "models/gemini-2.5-flash",
    "models/gemini-3.5-flash-lite",
    "models/gemini-3.6-flash",
    "models/gemini-3.8-flash-preview",
    "models/gemini-3.5-pro",
    "models/gemini-3.8-flash",
    "models/gemini-flash-lite-latest",
  ]),
  ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-flash-lite-latest"]
);
check("rank unlisted aliases not invented", rankFlashModels(["models/gemini-3.6-flash"]), ["gemini-3.6-flash"]);
check("rank empty", rankFlashModels([]), []);
check("pick newest", pickFlashModel(["models/gemini-2.5-flash", "models/gemini-3.6-flash"]), "gemini-3.6-flash");
check("pick none", pickFlashModel(["models/gemini-3.5-pro", "models/embedding-001"]), null);

/* status classes */
for (const s of [429, 500, 502, 503, 504]) check(`retry ${s}`, classifyStatus(s), "retry");
for (const s of [400, 404, 405, 410, 418, 505]) check(`skip ${s}`, classifyStatus(s), "skip");
for (const s of [401, 403, 413]) check(`fatal ${s}`, classifyStatus(s), "fatal");

/* time limits: nothing can run the function past Vercel's 60s */
check("timeout capped per attempt", attemptTimeout(100_000, 0, TEXT_ATTEMPT_MS), TEXT_ATTEMPT_MS);
check("timeout shrinks near deadline", attemptTimeout(10_000, 5_000, IMAGE_ATTEMPT_MS), 5_000);
check("timeout never negative", attemptTimeout(1_000, 5_000, TEXT_ATTEMPT_MS), 0);
check("budget leaves 15s+ for download, save and reply", GEMINI_BUDGET_MS + 15_000 <= 60_000, true);
check("image attempt fits the budget", IMAGE_ATTEMPT_MS <= GEMINI_BUDGET_MS, true);
check("text attempts shorter than image", TEXT_ATTEMPT_MS < IMAGE_ATTEMPT_MS, true);
check("min attempt below text limit", MIN_ATTEMPT_MS < TEXT_ATTEMPT_MS, true);
check("backoff is short", RETRY_BACKOFF_MS <= 3_000, true);
check("attempt cap allows several fallbacks", MAX_ATTEMPTS >= 5, true);
check("busy cooldown shorter than broken", BUSY_COOLDOWN_MS < BROKEN_COOLDOWN_MS, true);
check("rate-limited models step aside longer than overloaded ones", RATE_LIMIT_COOLDOWN_MS > BUSY_COOLDOWN_MS, true);

/* candidate order from shared health */
const ranked = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"];
const now = 10_000_000;
const h = (entries: [string, ModelHealth][]) => new Map(entries);
check("no health keeps rank", orderCandidates(ranked, h([]), now), ranked);
check(
  "busy last, recent success first",
  orderCandidates(ranked, h([
    ["gemini-3.8-flash", { busyUntil: now + 60_000, lastOkAt: 0 }],
    ["gemini-3.6-flash", { busyUntil: 0, lastOkAt: now - 60_000 }],
  ]), now),
  ["gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.8-flash"]
);
check(
  "most recent success wins",
  orderCandidates(ranked, h([
    ["gemini-3.5-flash", { busyUntil: 0, lastOkAt: now - 1_000 }],
    ["gemini-3.7-flash", { busyUntil: 0, lastOkAt: now - 5_000 }],
  ]), now).slice(0, 2),
  ["gemini-3.5-flash", "gemini-3.7-flash"]
);
check("stale success ignored", orderCandidates(ranked, h([["gemini-3.5-flash", { busyUntil: 0, lastOkAt: now - RECENT_OK_MS - 1 }]]), now), ranked);
check("cooldown expired returns to rank", orderCandidates(ranked, h([["gemini-3.8-flash", { busyUntil: now - 1, lastOkAt: 0 }]]), now), ranked);
check(
  "recently ok but busy now still goes last",
  orderCandidates(ranked, h([["gemini-3.6-flash", { busyUntil: now + 1, lastOkAt: now - 1_000 }]]), now).at(-1),
  "gemini-3.6-flash"
);

/* second pass: only models that were overloaded or rate-limited */
const tried: Attempt[] = [
  { model: "gemini-3.8-flash", pass: 1, result: "http_503", ms: 900 },
  { model: "gemini-3.7-flash", pass: 1, result: "timeout", ms: 8000 },
  { model: "gemini-3.6-flash", pass: 1, result: "http_404", ms: 300 },
  { model: "gemini-3.5-flash", pass: 1, result: "http_429", ms: 200 },
  { model: "gemini-3.8-flash", pass: 2, result: "http_503", ms: 900 },
];
check("second pass picks 503/429 only, once each", planSecondPass(tried), ["gemini-3.8-flash", "gemini-3.5-flash"]);
check("second pass nothing to retry", planSecondPass([{ model: "m", pass: 1, result: "timeout", ms: 1 }]), []);

/* prompt + date */
check("PKT date rolls at local midnight", pakistanToday(new Date("2026-09-14T19:30:00Z")), "2026-09-15");
check("PKT date before local midnight", pakistanToday(new Date("2026-09-14T18:30:00Z")), "2026-09-14");

/* new people: only when the message itself asks, and the model marks the name new */
const fresh = (raw: Record<string, unknown>, text: string) => validateParsed(raw, today, people, text) as any;
check(
  "asks for new person",
  [asksForNewPerson("Add new borrower habib ullah with 500 in his name"), asksForNewPerson("add 700 to habib"), asksForNewPerson("naya banda bilal 300")],
  [true, false, true]
);
check(
  "new person name tidied",
  [newPersonName("habib ullah"), newPersonName("  o'brien  "), newPersonName("ali2"), newPersonName(""), newPersonName("a b c d e f")],
  ["Habib Ullah", "O'brien", null, null, null]
);
check(
  "new borrower created",
  fresh({ intent: "lend", entries: [{ person: "habib ullah", amount: 500, is_new: true }] }, "Add new borrower habib ullah with 500 in his name"),
  { ok: true, kind: "ledger", ledger: { direction: "lend", entries: [{ person: "Habib Ullah", amount: 500, isNew: true }], note: null } }
);
check("model says new but message didn't ask: refused", fresh({ intent: "lend", entries: [{ person: "habib ullah", amount: 500, is_new: true }] }, "add 500 to habib ullah").ok, false);
check("message asks but model didn't mark new: refused", fresh({ intent: "lend", entries: [{ person: "habib ullah", amount: 500 }] }, "add new borrower habib ullah 500").ok, false);
check("refusal suggests the new-borrower phrasing", fresh({ intent: "lend", entries: [{ person: "Bilal", amount: 5 }] }, "add 5 to bilal").reason.includes("add new borrower Bilal"), true);
check(
  "asked to add someone who exists: existing person used",
  fresh({ intent: "lend", entries: [{ person: "ali", amount: 500, is_new: true }] }, "add new borrower ali 500").ledger?.entries,
  [{ person: "Ali", amount: 500, isNew: false }]
);
check("new person can't repay", fresh({ intent: "repayment", entries: [{ person: "habib", amount: 500, is_new: true }] }, "new borrower habib paid back 500").ok, false);
check("repayment from unknown names them", fresh({ intent: "repayment", entries: [{ person: "Bilal", amount: 5 }] }, "bilal paid back 5").reason.includes("Bilal isn't"), true);
check("bad new name refused", fresh({ intent: "lend", entries: [{ person: "habib 123", amount: 500, is_new: true }] }, "add new borrower habib 123 with 500").ok, false);
check(
  "new and existing in one message",
  fresh({ intent: "lend", entries: [{ person: "habib ullah", amount: 500, is_new: true }, { person: "ALI", amount: 200 }] }, "add new borrower habib ullah 500 and 200 to ali").ledger?.entries,
  [{ person: "Habib Ullah", amount: 500, isNew: true }, { person: "Ali", amount: 200, isNew: false }]
);
check("same new person twice refused", fresh({ intent: "lend", entries: [{ person: "habib", amount: 5, is_new: true }, { person: "Habib", amount: 6, is_new: true }] }, "new borrower habib 5 and 6").ok, false);
check("offline refuses new borrower", parseOffline("add new borrower habib 500", today, people).ok, false);
check(
  "lend reply marks new person",
  ledgerReply({ direction: "lend", lines: [{ name: "Habib Ullah", amount: 500, balance: 500, isNew: true }] }),
  "*Udhar Khata updated*\n\n*Habib Ullah* (new): Rs 500 lent\nBalance: owes you Rs 500\n\nReply *UNDO* to reverse this."
);
check(
  "undo reply removes new person",
  undoReply({ expense: null, transactions: [{ name: "Habib Ullah", amount: 500 }], peopleRemoved: ["Habib Ullah"] }),
  "*Removed*\n\nLoan to Habib Ullah: Rs 500\nRemoved Habib Ullah from Udhar Khata"
);

/* "paid all his debt": no amount given, the balance is filled in when saved */
check(
  "settle all accepted without an amount",
  fresh({ intent: "repayment", entries: [{ person: "ali", all: true }] }, "ali paid all his debt").ledger?.entries,
  [{ person: "Ali", amount: null, isNew: false, all: true }]
);
check("settle all ignores a guessed amount", fresh({ intent: "repayment", entries: [{ person: "Ali", amount: 0, all: true }] }, "ali cleared his khata").ok, true);
check("all only means everything for repayments", fresh({ intent: "lend", entries: [{ person: "Ali", all: true }] }, "give ali all").ok, false);
check("settle all for unknown person refused", fresh({ intent: "repayment", entries: [{ person: "Bilal", all: true }] }, "bilal paid everything").ok, false);
check("plain repayment still needs an amount", fresh({ intent: "repayment", entries: [{ person: "Ali" }] }, "ali paid me back").ok, false);
check("offline refuses debt talk", [parseOffline("ahmed paid 500 of his dept", today, []).ok, parseOffline("settled 500", today, []).ok], [false, false]);
check(
  "settled reply",
  ledgerReply({ direction: "repayment", lines: [{ name: "Ahmed Zahid", amount: 100, balance: 0, settled: true }] }),
  "*Payment recorded*\n\n*Ahmed Zahid* paid back everything, Rs 100\nBalance: settled\n\nReply *UNDO* to reverse this."
);

/* questions: the model names the question, the numbers come from the database */
const cats = ["Car", "Groceries", "Food & Dining"];
const q = (raw: Record<string, unknown>) => validateParsed({ intent: "query", ...raw }, today, people, "", cats) as any;
check(
  "query a person's balance",
  q({ query_type: "udhar_person", entries: [{ person: "abdurrehman" }] }),
  { ok: true, kind: "query", query: { type: "udhar_person", people: ["Abdur Rehman"], year: null, month: null, category: null, vendor: null } }
);
check("query same person twice counted once", q({ query_type: "udhar_person", entries: [{ person: "Ali" }, { person: "ali" }] }).query?.people, ["Ali"]);
check("query unknown person refused", q({ query_type: "udhar_person", entries: [{ person: "Bilal" }] }).ok, false);
check("query person needs a name", q({ query_type: "udhar_person", entries: [] }).ok, false);
check("query who owes me", q({ query_type: "udhar_summary" }).query?.type, "udhar_summary");
check("spending defaults to this month", [q({ query_type: "spending" }).query?.year, q({ query_type: "spending" }).query?.month], [2026, 9]);
check("spending a whole year", [q({ query_type: "spending", year: 2026 }).query?.year, q({ query_type: "spending", year: 2026 }).query?.month], [2026, null]);
check("spending month on its own looks back", [q({ query_type: "spending", month: 12 }).query?.year, q({ query_type: "spending", month: 8 }).query?.year], [2025, 2026]);
check("spending this month by number", q({ query_type: "spending", month: 9 }).query?.year, 2026);
check("spending future month refused", q({ query_type: "spending", year: 2026, month: 11 }).ok, false);
check("spending bad month refused", [q({ query_type: "spending", month: 13 }).ok, q({ query_type: "spending", month: 0 }).ok], [false, false]);
check("spending future year refused", q({ query_type: "spending", year: 2027 }).ok, false);
check("spending string year accepted", q({ query_type: "spending", year: "2025", month: "8" }).query?.month, 8);
check("spending category matched to the user's list", q({ query_type: "spending", category_hint: "food & dining" }).query?.category, "Food & Dining");
check("spending uncategorised allowed", q({ query_type: "spending", category_hint: "uncategorised" }).query?.category, "Uncategorised");
check("spending unknown category ignored", q({ query_type: "spending", category_hint: "Furniture" }).query?.category, null);
check("spending unknown category searched as a word", q({ query_type: "spending", category_hint: "Furniture" }).query?.vendor, "Furniture");
check("spending loose category name", q({ query_type: "spending", category_hint: "food" }).query?.category, "Food & Dining");
check("spending today", [q({ query_type: "spending", period: "today" }).query?.from, q({ query_type: "spending", period: "today" }).query?.to, q({ query_type: "spending", period: "today" }).query?.label], [today, today, "Today"]);
check("spending period wins over month", q({ query_type: "spending", period: "this week", month: 9 }).query?.month, null);
check("period this week starts Monday", periodRange("this_week", "2026-09-15"), { from: "2026-09-14", to: "2026-09-15", label: "This week" });
check("period last week", periodRange("last_week", "2026-09-15"), { from: "2026-09-07", to: "2026-09-13", label: "Last week" });
check("period last month over a year end", periodRange("last_month", "2026-01-10"), { from: "2025-12-01", to: "2025-12-31", label: "Last month" });
check("period last 7 days", periodRange("last_7_days", "2026-09-15")?.from, "2026-09-09");
check("period unknown", periodRange("fortnight", "2026-09-15"), null);
check("spending date range", [q({ query_type: "spending", start_date: "2026-09-10", end_date: "2026-09-01" }).query?.from, q({ query_type: "spending", start_date: "2026-09-10", end_date: "2026-09-01" }).query?.to], ["2026-09-01", "2026-09-10"]);
check("spending single day", q({ query_type: "spending", start_date: "2026-09-12" }).query?.to, "2026-09-12");
check("spending future range refused", q({ query_type: "spending", start_date: "2026-12-01" }).ok, false);
check("spending bad range refused", q({ query_type: "spending", start_date: "2026-02-30" }).ok, false);
check("list defaults to no period, latest 10", [q({ query_type: "expense_list" }).query?.year, q({ query_type: "expense_list" }).query?.sort, q({ query_type: "expense_list" }).query?.limit], [null, "latest", 10]);
check("list biggest defaults to 5, limit capped", [q({ query_type: "expense_list", sort: "biggest" }).query?.limit, q({ query_type: "expense_list", limit: 99 }).query?.limit], [5, 20]);
check("match category ambiguous", matchCategory("car", ["Car", "Car Wash"]), "Car");
check("match category partial ambiguous refused", matchCategory("fo", ["Food", "Football"]), null);
check("when phrase", [whenPhrase("Today"), whenPhrase("This week"), whenPhrase("August 2026")], ["today", "this week", "in August 2026"]);
check("thinking only for Flash 3+", [usesThinking("gemini-3.6-flash"), usesThinking("gemini-3.5-flash-lite"), usesThinking("gemini-2.5-flash")], [true, false, false]);
check("spending vendor kept", q({ query_type: "spending", vendor: " Shell " }).query?.vendor, "Shell");
check("unknown question type refused", q({ query_type: "weather" }).ok, false);
check("missing question type refused", q({}).ok, false);
check("recent and subscriptions questions", [q({ query_type: "recent_expenses" }).query?.type, q({ query_type: "SUBSCRIPTIONS_DUE" }).query?.type], ["recent_expenses", "subscriptions_due"]);

/* due dates */
const dd = (raw: Record<string, unknown>) => validateParsed({ intent: "due_date", ...raw }, today, people, "", cats) as any;
check("due date set", dd({ entries: [{ person: "ali" }], due_date: "2026-10-01" }), { ok: true, kind: "due_date", due: { person: "Ali", date: "2026-10-01" } });
check("due date today allowed", dd({ entries: [{ person: "Ali" }], due_date: today }).ok, true);
check("due date in the past refused", dd({ entries: [{ person: "Ali" }], due_date: "2026-09-01" }).ok, false);
check("due date too far ahead refused", dd({ entries: [{ person: "Ali" }], due_date: "2029-01-01" }).ok, false);
check("due date impossible day refused", dd({ entries: [{ person: "Ali" }], due_date: "2027-02-30" }).ok, false);
check("due date malformed refused", dd({ entries: [{ person: "Ali" }], due_date: "1st oct" }).ok, false);
check("due date cleared", dd({ entries: [{ person: "Ali" }], clear_due_date: true }).due, { person: "Ali", date: null });
check("due date one person only", dd({ entries: [{ person: "Ali" }, { person: "Abdur Rehman" }], due_date: "2026-10-01" }).ok, false);
check("due date needs a person", dd({ entries: [], due_date: "2026-10-01" }).ok, false);
check("due date unknown person refused", dd({ entries: [{ person: "Bilal" }], due_date: "2026-10-01" }).ok, false);
check("offline refuses questions and dates", [off("how much is 500?").ok, off("will pay on 1st").ok, off("remind me on the 5th").ok, off("what is 300").ok], [false, false, false, false]);

/* answer layouts */
check("period label", [periodLabel(2026, 9), periodLabel(2026, null)], ["September 2026", "2026"]);
check(
  "person balance reply",
  udharPersonReply([{ name: "Ali", balance: 1700, lent: 2000, received: 300, dueDate: "2026-10-01" }], today),
  `*Udhar Khata*\n\n*Ali*\nBalance: owes you Rs 1,700\nLent Rs 2,000 · Paid back Rs 300\nDue: ${fmtDateLabel("2026-10-01")}`
);
check("person reply marks overdue", udharPersonReply([{ name: "Ali", balance: 5, lent: 5, received: 0, dueDate: "2026-09-01" }], today).includes("(overdue)"), true);
check("settled person isn't overdue", udharPersonReply([{ name: "Ali", balance: 0, lent: 5, received: 5, dueDate: "2026-09-01" }], today).includes("(overdue)"), false);
check("who owes you: nobody", udharSummaryReply([]), "*Nobody owes you anything*\n\nNo one has an unpaid balance with you right now.");
check(
  "who owes you: sorted with total",
  udharSummaryReply([{ name: "Ali", balance: 700 }, { name: "Usama Irtaza", balance: 1700 }]),
  "*Who owes you*\n\nUsama Irtaza: Rs 1,700\nAli: Rs 700\n\nTotal: Rs 2,400"
);
check(
  "spending reply with breakdown",
  spendingReply({ label: "September 2026", filter: null, total: 3387, count: 2, byCategory: [{ category: "Car", total: 3000 }, { category: "Shopping", total: 387 }] }),
  "*Spent in September 2026*\n\nTotal: Rs 3,387\nExpenses: 2\n\n*By category*\nCar: Rs 3,000\nShopping: Rs 387"
);
check("spending reply filtered", spendingReply({ label: "August 2026", filter: "Car", total: 9000, count: 3, byCategory: [] }), "*Car in August 2026*\n\nTotal: Rs 9,000\nExpenses: 3");
check("spending reply nothing", spendingReply({ label: "2025", filter: "Shell", total: 0, count: 0, byCategory: [] }), "*Shell in 2025*\n\nNothing recorded.");
check(
  "spending breakdown capped at five",
  spendingReply({ label: "2026", filter: null, total: 60, count: 6, byCategory: ["a", "b", "c", "d", "e", "f"].map((category) => ({ category, total: 10 })) }).split("\n").length,
  11
);
check(
  "recent expenses reply",
  recentExpensesReply([{ date: "2026-09-15", amount: 387, vendor: "Daraz", category: "Shopping", note: "WhatsApp: order" }, { date: "2026-09-14", amount: 50, vendor: null, category: null, note: "WhatsApp: chai" }]),
  `*Recent expenses*\n\n${fmtDateLabel("2026-09-15")} · Rs 387 · Daraz (Shopping)\n${fmtDateLabel("2026-09-14")} · Rs 50 · chai`
);
check("recent expenses reply empty", recentExpensesReply([]), "*Recent expenses*\n\nNo expenses recorded yet.");
check(
  "subscriptions due reply sorted",
  subscriptionsDueReply([{ name: "Spotify", amount: 1200, dueDate: "2026-09-25" }, { name: "Netflix", amount: 1500, dueDate: "2026-09-20" }], today),
  `*Subscriptions due*\n\nNetflix: Rs 1,500 · ${fmtDateLabel("2026-09-20")}\nSpotify: Rs 1,200 · ${fmtDateLabel("2026-09-25")}`
);
check("subscriptions overdue marked", subscriptionsDueReply([{ name: "Netflix", amount: 1500, dueDate: "2026-09-10" }], today).includes("(overdue)"), true);
check("subscriptions none due", subscriptionsDueReply([], today), "*Subscriptions due*\n\nEverything active is paid for this month.");
check("due date set reply", dueDateReply({ name: "Ali", date: "2026-10-01" }), `*Due date set*\n\n*Ali*: ${fmtDateLabel("2026-10-01")}\n\nReply *UNDO* to change it back.`);
check("due date removed reply", dueDateReply({ name: "Ali", date: null }), "*Due date removed*\n\n*Ali* no longer has a due date.\n\nReply *UNDO* to change it back.");
check(
  "undo restores due dates",
  undoReply({ expense: null, transactions: [], steps: [{ op: "set_due_date", personId: "p1", name: "Ali", dueDate: null }, { op: "set_due_date", personId: "p2", name: "Usama", dueDate: "2026-10-01" }] }),
  `*Removed*\n\nDue date for Ali removed\nDue date for Usama back to ${fmtDateLabel("2026-10-01")}`
);

/* names the model left out are found in the message itself */
check(
  "balance question with the name only in the text",
  (validateParsed({ intent: "query", query_type: "udhar_person" }, today, people, "How much abdurrehman owe me", cats) as any).query?.people,
  ["Abdur Rehman"]
);
check(
  "balance question with empty entries uses the text",
  (validateParsed({ intent: "query", query_type: "udhar_person", entries: [] }, today, people, "how much does usama irtaza owe?", cats) as any).query?.people,
  ["Usama Irtaza"]
);
check(
  "entries given by the model still win",
  (validateParsed({ intent: "query", query_type: "udhar_person", entries: [{ person: "Ali" }] }, today, people, "how much abdurrehman owe me", cats) as any).query?.people,
  ["Ali"]
);
check("no name anywhere still asks whose khata", (validateParsed({ intent: "query", query_type: "udhar_person" }, today, people, "how much do they owe me", cats) as any).ok, false);
check(
  "due date with the name only in the text",
  (validateParsed({ intent: "due_date", due_date: "2026-10-01" }, today, people, "ali will pay back on 1 october", cats) as any).due,
  { person: "Ali", date: "2026-10-01" }
);
check("question refusals are marked", [q({ query_type: "weather" }).question, q({ query_type: "spending", month: 13 }).question], [true, true]);
check("other refusals aren't", exp({ amount: 0 }).question, undefined);
check("question refusal heading", refusalReply("Whose khata?", QUESTION_REFUSAL_HEADING), "*Couldn't answer that*\n\nWhose khata?");
check("default refusal heading unchanged", refusalReply("x"), "*Nothing added*\n\nx");

/* voice notes: recorded in the browser, sent as 16 kHz mono WAV */
const wav = new DataView(encodeWav(new Float32Array([0, 1, -1, 0.5, 2]), 16000));
const riffTag = (offset: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => wav.getUint8(offset + i)));
check("wav chunk tags", [riffTag(0), riffTag(8), riffTag(12), riffTag(36)], ["RIFF", "WAVE", "fmt ", "data"]);
check("wav is PCM mono 16 kHz 16-bit", [wav.getUint16(20, true), wav.getUint16(22, true), wav.getUint32(24, true), wav.getUint32(28, true), wav.getUint16(32, true), wav.getUint16(34, true)], [1, 1, 16000, 32000, 2, 16]);
check("wav sizes", [wav.byteLength, wav.getUint32(40, true), wav.getUint32(4, true)], [54, 10, 46]);
check("wav samples scaled and clipped", [0, 1, 2, 3, 4].map((i) => wav.getInt16(44 + i * 2, true)), [0, 32767, -32768, 16383, 32767]);
check("a minute of voice fits the upload limit", 44 + 60 * 16000 * 2 <= 2.5 * 1024 * 1024, true);
check("reply opens with what was heard", withTranscript("fuel 3000 shell", "*Expense added*"), "*Heard:* fuel 3000 shell\n\n*Expense added*");
check("no transcript leaves reply alone", withTranscript(null, "*Expense added*"), "*Expense added*");

/* in-app rendering of *bold*: split into pieces, never HTML */
check("bold split", splitBold("*Ali*: Rs 500 lent"), [{ text: "Ali", bold: true }, { text: ": Rs 500 lent", bold: false }]);
check("bold in the middle", splitBold("Reply *UNDO* to remove it."), [{ text: "Reply ", bold: false }, { text: "UNDO", bold: true }, { text: " to remove it.", bold: false }]);
check("no bold", splitBold("Balance: settled"), [{ text: "Balance: settled", bold: false }]);
check("lone asterisk left alone", splitBold("2 * 3"), [{ text: "2 * 3", bold: false }]);
check("empty line", splitBold(""), []);
check("markup stays text", splitBold("*<img src=x onerror=alert(1)>*"), [{ text: "<img src=x onerror=alert(1)>", bold: true }]);
check("help heading is channel-neutral", HELP_REPLY.startsWith("*What you can say*"), true);

/* replies: bold heading, blank line, one fact per line, UNDO hint set apart */
check(
  "expense reply today",
  expenseAddedReply({ amount: 3000, category: "Car", vendor: "Shell", date: today, today }),
  "*Expense added*\n\nAmount: Rs 3,000\nCategory: Car\nVendor: Shell\n\nReply *UNDO* to remove it."
);
check(
  "expense reply other day, no vendor, uncategorised, offline",
  expenseAddedReply({ amount: 387, category: null, vendor: null, date: "2026-09-14", today, offline: true }),
  `*Expense added*\n\nAmount: Rs 387\nCategory: Uncategorised - pick one in the app\nDate: ${fmtDateLabel("2026-09-14")}\n\nThe AI was busy, so this was read without it. Please check it in the app.\n\nReply *UNDO* to remove it.`
);
check("balance owes", balanceLine(1700), "Balance: owes you Rs 1,700");
check("balance settled", balanceLine(0.001), "Balance: settled");
check("balance you owe", balanceLine(-200), "Balance: you owe Rs 200");
check(
  "lend reply two people",
  ledgerReply({ direction: "lend", lines: [{ name: "Usama Irtaza", amount: 700, balance: 1700 }, { name: "Abdur Rehman", amount: 700, balance: 700 }] }),
  "*Udhar Khata updated*\n\nLent Rs 1,400 to 2 people\n\n*Usama Irtaza*: Rs 700 lent\nBalance: owes you Rs 1,700\n\n*Abdur Rehman*: Rs 700 lent\nBalance: owes you Rs 700\n\nReply *UNDO* to reverse this."
);
check(
  "lend reply one person has no total line",
  ledgerReply({ direction: "lend", lines: [{ name: "Ali", amount: 500, balance: 500 }] }),
  "*Udhar Khata updated*\n\n*Ali*: Rs 500 lent\nBalance: owes you Rs 500\n\nReply *UNDO* to reverse this."
);
check(
  "repayment reply settles",
  ledgerReply({ direction: "repayment", lines: [{ name: "Abdur Rehman", amount: 1000, balance: 0 }] }),
  "*Payment recorded*\n\n*Abdur Rehman* paid back Rs 1,000\nBalance: settled\n\nReply *UNDO* to reverse this."
);
check("undo nothing", undoReply(null), "*Nothing to undo*\n\nThere's nothing from the last 24 hours to remove.");
check("undo expense", undoReply({ expense: { amount: 3000, vendor: "Shell" }, transactions: [] }), "*Removed*\n\nExpense: Rs 3,000 · Shell");
check(
  "undo ledger both signs",
  undoReply({ expense: null, transactions: [{ name: "Ali", amount: 700 }, { name: "Abdur Rehman", amount: -1000 }] }),
  "*Removed*\n\nLoan to Ali: Rs 700\nPayment from Abdur Rehman: Rs 1,000"
);
check("refusal layout", refusalReply("The amount needs to be more than zero."), "*Nothing added*\n\nThe amount needs to be more than zero.");
check("ambiguous names the person", ambiguousPersonReply("Ali").startsWith("*Nothing added*\n\nYou have more than one Ali"), true);
check("busy reply spaced", BUSY_REPLY.startsWith("*Nothing added*\n\n"), true);
check("help lists both sections", HELP_REPLY.includes("*Expenses*") && HELP_REPLY.includes("*Udhar Khata*"), true);
for (const [label, text] of [["help", HELP_REPLY], ["busy", BUSY_REPLY]] as const) {
  check(`${label} has no doubled blank lines or trailing space`, /\n\n\n| \n| $/.test(text), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
