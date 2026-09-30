// The rules the Gmail import works by, as plain data and pure functions.
//
// These used to live in the prompt of a cloud agent that read Gmail on a
// schedule. The app reads Gmail itself now, so the parts that never needed
// judgement - which senders to look at, which payments are not expenses, what
// stretch of time a run covers - are code, and scripts/test-email-rules.ts
// checks them. Only reading an alert and pulling the amount, payee and date
// out of it still goes to a model.
//
// Everything here is personal to the account being imported into, and editing
// this file is how it changes.

// Bank alerts come from these domains. Anything else is never even fetched.
export const BANK_SENDERS = ["bankalhabib.com", "abl.com", "meezanbank.com"];

// Money moved between the account holder's own accounts is not spending. A
// beneficiary or account name matching any of these is a transfer. Matched
// against the payee read out of the alert and never against the whole email:
// the account holder's own name is in the greeting of every one of them.
export const OWN_ACCOUNTS = [
  "chattha technologies",
  "walli ullah",
  "sadapay",
  "jazzcash",
];

// Subscriptions are tracked on their own screen and added to Mera Khata as one
// expense at month end, so the bank alert for each one must not become a
// second expense.
export const EXCLUDED_MERCHANTS = [
  "zong",
  "ptcl",
  "crunchyroll",
  "chrunchyroll", // as it is sometimes written on statements
  "chatgpt",
  "openai",
  "claude",
  "anthropic",
  "netflix",
  "snapchat",
  "spotify",
  "tapmad",
];

// A run covers everything since the last one, and an hour before that as well:
// a bank can send an alert minutes or hours after the payment, and the second
// read of an email costs nothing because routine_seen already knows it.
export const OVERLAP_SECONDS = 60 * 60;
// With no record of a previous run - a first run, or a long outage - a day is
// swept rather than the whole history.
export const FIRST_RUN_SECONDS = 24 * 60 * 60;
// However long the gap, never reach back further than this.
export const MAX_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;

export type Window = { startSec: number; endSec: number };

// The stretch of time this run looks at. `lastEndSec` is where the last
// successful run stopped, or null if there has never been one.
export function syncWindow(nowMs: number, lastEndSec: number | null): Window {
  const endSec = Math.floor(nowMs / 1000);
  const floor = endSec - MAX_LOOKBACK_SECONDS;
  const from = lastEndSec === null ? endSec - FIRST_RUN_SECONDS : lastEndSec - OVERLAP_SECONDS;
  return { startSec: Math.max(floor, Math.min(from, endSec)), endSec };
}

// Gmail's own search syntax. `after`/`before` take Unix seconds.
export function searchQuery(w: Window): string {
  const from = BANK_SENDERS.map((d) => `from:${d}`).join(" OR ");
  return `(${from}) after:${w.startSec} before:${w.endSec}`;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ");

// A name from one of the lists above appearing in the payee, or null. Matching
// is on letters and digits only, so "SADAPAY*WALLI ULLAH" and "Sada Pay" both
// count, and it is containment either way round, so "Zong" matches
// "ZONG PREPAID TOPUP".
function firstMatch(payee: string, needles: string[]): string | null {
  const text = norm(payee);
  if (!text.trim()) return null;
  return needles.find((n) => text.includes(norm(n))) ?? null;
}

export function ownAccountName(payee: string): string | null {
  return firstMatch(payee, OWN_ACCOUNTS);
}

export function excludedMerchant(payee: string): string | null {
  return firstMatch(payee, EXCLUDED_MERCHANTS);
}

// The two exclusion lists, applied to the payee a model read out of an alert.
// Returns the reason to skip, or null when this is spending like any other.
export function excludedPayee(payee: string): string | null {
  const merchant = excludedMerchant(payee);
  if (merchant) return `subscription paid to ${merchant}, tracked on the subscriptions screen`;
  const own = ownAccountName(payee);
  if (own) return `transfer between your own accounts (${own})`;
  return null;
}

// The time of day an alert arrived, in Pakistan, as "14:03". Notes carry it so
// two payments to the same shop on one day can be told apart.
export function pakistanClock(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  // PKT is UTC+5 all year round.
  return new Date(ms + 5 * 60 * 60 * 1000).toISOString().slice(11, 16);
}

// What an expense is called when the model gives no note of its own: enough to
// recognise the payment in a list, from the alert itself.
export function noteFromEmail(subject: string, from: string, receivedMs: number): string {
  const bank = /@([^>\s]+)/.exec(from)?.[1] ?? from.replace(/[<>]/g, "").trim();
  const clock = pakistanClock(receivedMs);
  return [subject.trim(), bank.trim(), clock && `${clock} PKT`].filter(Boolean).join(", ").slice(0, 500);
}

// The payee, as a name and nothing else.
//
// A model given several fields to fill sometimes runs them into one - a weaker
// fallback model answered "Foodpanda PK LHR ID: 4417 Time: 14:03 note: card
// payment..." for the payee. The payee is what the vendor-to-category rules
// are learned against and what is shown in every list, so it is cut back to
// the name here rather than trusted as it comes.
const VENDOR_TAIL = /\b(note|time|ref(erence)?|id|txn|trn|account|acct|a\/c|card|amount|date)\s*[:#]/i;

export function tidyVendor(raw: string): string {
  let name = raw.split(/[\n\r|]/)[0];
  const tail = VENDOR_TAIL.exec(name);
  if (tail) name = name.slice(0, tail.index);
  return name
    .replace(/\s+/g, " ")
    .replace(/^[\s,.\-–—:;*]+|[\s,.\-–—:;*]+$/g, "")
    .slice(0, 120);
}

/* ---------- checking what the model answers ---------- */

export const MAX_AMOUNT = 10_000_000;

export type ModelDecision = {
  source_id?: unknown;
  kind?: unknown;
  amount?: unknown;
  date?: unknown;
  vendor?: unknown;
  category?: unknown;
  note?: unknown;
  reason?: unknown;
};

export type Decided =
  | { kind: "expense"; amount: number; date: string; vendor: string | null; category: string | null; note: string }
  | { kind: "skip"; reason: string };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// A day that actually exists. Date.parse alone is no help: it reads
// "2026-02-31" as the 3rd of March rather than refusing it, and a misread
// alert would then be filed on the wrong day.
function realDate(ymd: string): boolean {
  if (!YMD.test(ymd)) return false;
  const d = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
}
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// A model's answer about one email, checked before it is allowed anywhere near
// the ledger. A date outside the window it was given, an amount that is not a
// sensible number, or anything the exclusion lists catch, becomes a skip
// rather than an expense - the email is still marked as dealt with either way,
// so nothing is read twice.
export function checkDecision(d: ModelDecision, today: string): Decided {
  if (clean(d.kind, 20).toLowerCase() !== "expense") {
    return { kind: "skip", reason: clean(d.reason, 200) || "not a payment out of an account" };
  }

  const amount = Number(d.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { kind: "skip", reason: "attention: no amount could be read from this alert" };
  }
  if (amount > MAX_AMOUNT) {
    return { kind: "skip", reason: `attention: amount ${amount} looks wrong, so it was left out` };
  }

  const date = clean(d.date, 10);
  if (!realDate(date)) {
    return { kind: "skip", reason: "attention: no date could be read from this alert" };
  }
  // A bank alert is about something that has already happened; a date in the
  // future is a misreading, as is one from long before the window.
  if (date > today) return { kind: "skip", reason: `attention: the date read was ${date}, which is in the future` };

  // The exclusion lists have the last word, whatever the model decided.
  const vendor = tidyVendor(clean(d.vendor, 300));
  const excluded = excludedPayee(vendor);
  if (excluded) return { kind: "skip", reason: excluded };

  return {
    kind: "expense",
    amount: Math.round(amount * 100) / 100,
    date,
    vendor: vendor || null,
    category: clean(d.category, 60) || null,
    note: clean(d.note, 500),
  };
}
