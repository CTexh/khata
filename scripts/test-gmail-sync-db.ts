// A whole run of the Gmail import, against a throwaway database, with Gmail and
// Gemini answered locally - so what is checked is the part that decides what
// reaches the ledger: which emails are read, which become expenses, what is
// recorded as dealt with, and how far the bookmark moves.
// Run with: node --experimental-strip-types --import ./scripts/alias-register.mjs scripts/test-gmail-sync-db.ts
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "khata-gmail-sync-"));
const url = `file:${join(dir, "test.db")}`;
process.env.TURSO_DATABASE_URL = url;
delete process.env.TURSO_AUTH_TOKEN;
// Enough for the import to consider itself configured; nothing leaves the
// machine, as fetch is answered below.
process.env.GMAIL_CLIENT_ID = "test-client";
process.env.GMAIL_CLIENT_SECRET = "test-secret";
process.env.GMAIL_REFRESH_TOKEN = "test-refresh";
process.env.GEMINI_API_KEY = "test-key";
delete process.env.GEMINI_MODEL;
execFileSync(process.execPath, ["scripts/migrate-db.mjs"], {
  env: { ...process.env, TURSO_DATABASE_URL: url },
  stdio: "pipe",
});

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

/* ---------- a mailbox, and a model, to answer with ---------- */

type Stub = { id: string; subject: string; text: string; receivedMs: number };
type Decision = Record<string, unknown>;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
let mailbox: Stub[] = [];
let answers: Decision[] = [];
// Every call made, so the test can show that a quiet run reads nothing.
const calls: string[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

  if (href.startsWith("https://oauth2.googleapis.com/token")) {
    calls.push("token");
    return json({ access_token: "test-access", expires_in: 3600 });
  }
  if (href.includes("gmail.googleapis.com")) {
    const path = href.split("/users/me")[1] ?? "";
    if (path.startsWith("/messages?")) {
      calls.push("search");
      return json({ messages: mailbox.map((m) => ({ id: m.id, threadId: `t-${m.id}` })) });
    }
    const id = decodeURIComponent(path.split("/messages/")[1].split("?")[0]);
    calls.push(`fetch:${id}`);
    const mail = mailbox.find((m) => m.id === id)!;
    return json({
      id: mail.id,
      internalDate: String(mail.receivedMs),
      payload: {
        headers: [
          { name: "From", value: "Alerts <alerts@bankalhabib.com>" },
          { name: "Subject", value: mail.subject },
        ],
        mimeType: "text/plain",
        body: { data: b64(mail.text) },
      },
    });
  }
  if (href.includes("generativelanguage.googleapis.com")) {
    if (href.includes("/models?")) return json({ models: [{ name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] }] });
    calls.push("gemini");
    const asked = JSON.parse(String(init?.body)) as { contents: { parts: { text: string }[] }[] };
    const sent = asked.contents[0].parts[0].text;
    // Only answer for the emails actually in the request, as a model would.
    const mine = answers.filter((a) => sent.includes(String(a.source_id)));
    return json({ candidates: [{ content: { parts: [{ text: JSON.stringify(mine) }] } }] });
  }
  return realFetch(input as never, init);
}) as typeof fetch;

/* ---------- an account to import into ---------- */

const dbm = await import("../src/lib/db.ts");
const { syncGmailExpenses } = await import("../src/lib/gmail-sync.ts");
const { pakistanToday } = await import("../src/lib/expense-parse.ts");

const c = dbm.db();
const userId = randomUUID();
await c.execute({
  // The import posts as this account, as the old routine always did.
  sql: "INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, 'walli', 'unused-test-placeholder', 1, ?)",
  args: [userId, new Date().toISOString()],
});
await dbm.ensureTablesExist();
await dbm.listUserCategories(userId); // seeds the default categories

const today = pakistanToday();
const now = Date.now();
const alert = (id: string, subject: string, text: string): Stub => ({ id, subject, text, receivedMs: now - 60_000 });
const expenseFor = (id: string, amount: number, vendor: string, extra: Decision = {}): Decision => ({
  source_id: id,
  kind: "expense",
  amount,
  date: today,
  vendor,
  category: "",
  note: `${vendor} card payment`,
  reason: "",
  ...extra,
});
const skipFor = (id: string, reason: string): Decision => ({
  source_id: id,
  kind: "skip",
  amount: 0,
  date: "",
  vendor: "",
  category: "",
  note: "",
  reason,
});

const rows = async (sql: string, args: (string | number | null)[] = []) => (await c.execute({ sql, args })).rows;
const one = async (sql: string, args: (string | number | null)[] = []) => (await rows(sql, args))[0] ?? null;
const count = async (sql: string, args: (string | number | null)[] = []) => Number((await one(sql, args))?.n ?? 0);
const bookmark = async () => Number(await dbm.readAppMeta("gmail_sync_through"));

/* ---------- a first run, with three alerts ---------- */

mailbox = [
  alert("m0000001", "Debit Alert", "debited with PKR 4,324.00 at FOODPANDA PK LHR"),
  alert("m0000002", "ATM Withdrawal", "Cash withdrawal of PKR 20,000.00 from ATM DHA"),
  alert("m0000003", "Credit Alert", "credited with PKR 120,000.00 inward remittance"),
];
answers = [
  expenseFor("m0000001", 4324, "Foodpanda"),
  expenseFor("m0000002", 20000, "Cash Bank Al Habib"),
  skipFor("m0000003", "money credited to the account"),
];

let run = await syncGmailExpenses();
check("the run imported", [run.summary.ok, run.summary.state], [true, "imported"]);
check("what it did", run.summary.counts, { posted: 2, duplicates: 0, deleted_by_you: 0, skipped: 1, invalid: 0 });
check("two expenses exist", await count("SELECT COUNT(*) n FROM expenses WHERE user_id = ?", [userId]), 2);
check(
  "with the amounts from the alerts",
  (await rows("SELECT amount FROM expenses WHERE user_id = ? ORDER BY amount", [userId])).map((r) => Number(r.amount)),
  [4324, 20000]
);
check(
  "the payee is kept",
  (await one("SELECT vendor, note FROM expenses WHERE amount = 4324", []))?.vendor,
  "Foodpanda"
);
check(
  "each alert is tied to the email it came from",
  (await one("SELECT source_id FROM expenses WHERE amount = 4324", []))?.source_id,
  "m0000001"
);
check("all three emails are recorded", await count("SELECT COUNT(*) n FROM routine_seen WHERE user_id = ?", [userId]), 3);
check(
  "the incoming money as a skip, with its reason",
  await one("SELECT outcome, detail FROM routine_seen WHERE message_id = 'm0000003'"),
  { outcome: "skipped", detail: "money credited to the account" }
);
check("the bookmark moved", (await bookmark()) > 0, true);

/* ---------- the same mailbox again ---------- */

calls.length = 0;
run = await syncGmailExpenses();
check("nothing new the second time", run.summary.state, "nothing new");
check("no second copy of anything", await count("SELECT COUNT(*) n FROM expenses WHERE user_id = ?", [userId]), 2);
check("no email was read and no model asked", calls.filter((k) => k !== "token" && k !== "search"), []);

/* ---------- an alert for something already entered by hand ---------- */

const byHand = await dbm.insertExpense({
  userId,
  amount: 999,
  note: "typed in at the shop",
  expenseDateTime: `${today}T10:00:00Z`,
  vendor: "Imtiaz",
  category: "Groceries",
  vendorKey: null,
  sourceId: null,
});
mailbox = [alert("m0000004", "Debit Alert", "debited with PKR 999.00 at IMTIAZ SUPER MARKET")];
answers = [expenseFor("m0000004", 999, "Imtiaz Super Market")];

run = await syncGmailExpenses();
check("it is seen as the same payment", run.summary.counts?.duplicates, 1);
check("and posts nothing", run.summary.counts?.posted, 0);
check("the hand-typed one still stands alone", await count("SELECT COUNT(*) n FROM expenses WHERE amount = 999"), 1);
check(
  "the email is recorded against it",
  (await one("SELECT outcome, expense_id FROM routine_seen WHERE message_id = 'm0000004'"))?.expense_id,
  byHand
);

/* ---------- an alert for something deleted by hand ---------- */

// Deleted by hand before the alert for it arrived. An expense that came from
// an email is a different matter - the email is already recorded as posted, so
// it is never read again and needs no tombstone.
const thrownAway = await dbm.insertExpense({
  userId,
  amount: 777,
  note: "logged, then thought better of",
  expenseDateTime: `${today}T09:00:00Z`,
  vendor: "Sana Safinaz",
  category: null,
  vendorKey: null,
  sourceId: null,
});
await dbm.deleteExpenseRow(userId, thrownAway);
mailbox = [alert("m0000005", "Debit Alert", "debited with PKR 777.00 at SANA SAFINAZ")];
answers = [expenseFor("m0000005", 777, "Sana Safinaz")];

run = await syncGmailExpenses();
check("a deleted payment stays deleted", run.summary.counts?.deleted_by_you, 1);
check("and is not added back", await count("SELECT COUNT(*) n FROM expenses WHERE amount = 777"), 0);
check(
  "the reason names the day it was deleted",
  /you deleted this expense on \d{4}-\d{2}-\d{2}/.test(
    String((await one("SELECT detail FROM routine_seen WHERE message_id = 'm0000005'"))?.detail)
  ),
  true
);

/* ---------- more alerts than one run will read ---------- */

const many = Array.from({ length: 15 }, (_, i) => `m001${String(i).padStart(4, "0")}`);
mailbox = many.map((id, i) => alert(id, "Debit Alert", `debited with PKR ${100 + i}.00 at SHOP ${i}`));
answers = many.map((id, i) => expenseFor(id, 100 + i, `Shop ${i}`));
const before = await bookmark();

run = await syncGmailExpenses();
check("a backlog is read a dozen at a time", [run.summary.read, run.summary.left_for_next_run], [12, 3]);
check("and the bookmark waits for the rest", await bookmark(), before);

run = await syncGmailExpenses();
check("the next run finishes them", [run.summary.read, run.summary.left_for_next_run], [3, 0]);
// Up to now, rather than merely further on: the whole window has been covered.
check("now the bookmark moves to the end of the window", Math.abs((await bookmark()) - Math.floor(Date.now() / 1000)) <= 2, true);
check("every alert became an expense", await count("SELECT COUNT(*) n FROM expenses WHERE vendor LIKE 'Shop %'"), 15);

/* ---------- when the model says something impossible ---------- */

mailbox = [
  alert("m0020001", "Debit Alert", "debited with PKR ??? at SOMEWHERE"),
  alert("m0020002", "Debit Alert", "debited with PKR 500.00 at NETFLIX"),
];
answers = [
  expenseFor("m0020001", 0, "Somewhere"),
  // A subscription the model called an expense: the exclusion list overrules it.
  expenseFor("m0020002", 500, "Netflix"),
];

run = await syncGmailExpenses();
check("neither is posted", run.summary.counts?.posted, 0);
check("both are recorded as dealt with", run.summary.counts?.skipped, 2);
check(
  "the unreadable one asks for attention",
  run.summary.attention?.length,
  1
);
check(
  "and the subscription says why it was left out",
  (await one("SELECT detail FROM routine_seen WHERE message_id = 'm0020002'"))?.detail,
  "subscription paid to netflix, tracked on the subscriptions screen"
);

/* ---------- when Gmail is unreachable ---------- */

const held = await bookmark();
mailbox = [alert("m0030001", "Debit Alert", "debited with PKR 700.00 at SHELL")];
answers = [expenseFor("m0030001", 700, "Shell")];
const stubbed = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (href.includes("gmail.googleapis.com")) throw new Error("network down");
  return stubbed(input as never, init);
}) as typeof fetch;

run = await syncGmailExpenses();
check("the run fails rather than half-finishing", [run.summary.ok, run.summary.state], [false, "failed"]);
check("it says why", /network down/.test(run.summary.error ?? ""), true);
check("the bookmark did not move", await bookmark(), held);

globalThis.fetch = stubbed;
run = await syncGmailExpenses();
check("and the next run picks it up", run.summary.counts?.posted, 1);
check("nothing was lost", await count("SELECT COUNT(*) n FROM expenses WHERE vendor = 'Shell'"), 1);

/* ---------- with no credentials ---------- */

delete process.env.GMAIL_REFRESH_TOKEN;
run = await syncGmailExpenses();
check("it simply says it is off", [run.summary.ok, run.summary.state], [true, "not configured"]);

globalThis.fetch = realFetch;
rmSync(dir, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
