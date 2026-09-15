// Checks for what the assistant's model reads out of a message - expenses,
// Udhar Khata entries, questions, due dates - plus the no-AI fallback and the
// Gemini call itself: which model, how long to wait, what to try next.
// validateParsed() decides whether a reading is trustworthy enough to act on.
// Kept free of app imports so it runs under the scripts/ tests.

export type ParsedExpense = {
  amount: number;
  vendor: string | null;
  note: string;
  date: string; // YYYY-MM-DD, Pakistan time
  categoryHint: string | null;
};

export type LedgerDirection = "lend" | "repayment";
// `person` is a name exactly as it appears in the user's Udhar Khata - or, when
// isNew is true, the tidied name to create a new person with. `all` marks a
// repayment of the whole balance ("paid all his debt"): amount is null then,
// and the balance at the time of saving is used.
export type LedgerEntry = { person: string; amount: number | null; isNew: boolean; all?: true };
export type ParsedLedger = { direction: LedgerDirection; entries: LedgerEntry[]; note: string | null };

// A question about the user's own data. The model only says what is being
// asked; every number in the answer is read from the database.
export type QueryType =
  | "udhar_person"
  | "udhar_summary"
  | "spending"
  | "recent_expenses"
  | "expense_list"
  | "subscriptions_due"
  | "subscriptions_overview";
export type ParsedQuery = {
  type: QueryType;
  people: string[]; // exact Udhar Khata names, for udhar_person
  year: number | null; // spending: set unless a date range is
  month: number | null; // spending: null means the whole year
  category: string | null; // spending: one of the user's categories
  vendor: string | null; // spending: matched against vendor, note and category
  // A day range, inclusive, for "today", "this week" or explicit dates. When
  // set it replaces year and month.
  from?: string | null;
  to?: string | null;
  label?: string | null; // "Today", "This week" - null for a custom range
  sort?: "latest" | "biggest"; // expense_list
  limit?: number; // expense_list
};
// When someone will pay back. date null means remove the due date.
export type ParsedDueDate = { person: string; date: string | null };

export type ParseOutcome =
  | { ok: true; kind: "expense"; expense: ParsedExpense }
  | { ok: true; kind: "ledger"; ledger: ParsedLedger }
  | { ok: true; kind: "query"; query: ParsedQuery }
  | { ok: true; kind: "due_date"; due: ParsedDueDate }
  | { ok: false; reason: string; question?: true };

// Largest single amount accepted without question. A misread receipt (an
// invoice number or phone number taken for the total) is far more likely than
// a genuine eight-figure payment sent by message.
export const MAX_AMOUNT = 10_000_000;
// More people than this in one message is almost certainly a misreading.
export const MAX_LEDGER_ENTRIES = 20;

export function pakistanToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(now);
}

export function cleanString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

const RUPEE_CODES = new Set(["pkr", "rs", "rs.", "rupee", "rupees", "₨"]);

// Names are compared without case, spaces or punctuation, so "abdurrehman",
// "Abdur Rehman" and "ABDUR-REHMAN" are the same person.
export function personKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

export function amountProblem(amount: number): string | null {
  if (!Number.isFinite(amount)) return "I couldn't find an amount in that. Try something like: fuel 3000 shell";
  if (amount <= 0) return "The amount needs to be more than zero.";
  if (amount > MAX_AMOUNT) return "That amount looks too large to be right. Please send it as text, e.g. rent 180000";
  return null;
}

export function currencyProblem(raw: unknown): string | null {
  const currency = cleanString(raw, 12)?.toLowerCase();
  if (currency && !RUPEE_CODES.has(currency)) {
    return `That looks like ${currency.toUpperCase()}. Only rupee amounts can be added for now.`;
  }
  return null;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function validateParsed(
  raw: unknown,
  today: string,
  people: string[] = [],
  messageText = "",
  categories: string[] = []
): ParseOutcome {
  const unclear: ParseOutcome = {
    ok: false,
    reason:
      "I couldn't tell what to add. Try: fuel 3000 shell - or for Udhar Khata: add 700 to Ali's khata, or Ali paid me back 500",
  };
  if (!raw || typeof raw !== "object") return unclear;
  const r = raw as Record<string, unknown>;
  const intent = typeof r.intent === "string" ? r.intent.trim().toLowerCase() : "";

  if (intent === "lend" || intent === "repayment") return validateLedger(r, intent, people, messageText);
  if (intent === "query") return validateQuery(r, today, people, categories, messageText);
  if (intent === "due_date") return validateDueDate(r, today, people, messageText);
  if (intent !== "expense") return unclear;

  const amount = typeof r.amount === "number" ? r.amount : Number(r.amount);
  const problem = amountProblem(amount) ?? currencyProblem(r.currency);
  if (problem) return { ok: false, reason: problem };

  // A date the model can't justify - malformed, in the future, or more than a
  // year back - falls back to today rather than filing the expense somewhere
  // you would never look for it.
  let date = today;
  const d = cleanString(r.date, 10);
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + "T00:00:00Z"))) {
    const ageDays = (Date.parse(today + "T00:00:00Z") - Date.parse(d + "T00:00:00Z")) / 86_400_000;
    if (ageDays >= 0 && ageDays <= 366) date = d;
  }

  const vendor = cleanString(r.vendor, 120);
  return {
    ok: true,
    kind: "expense",
    expense: {
      amount: round2(amount),
      vendor,
      note: cleanString(r.note, 300) ?? vendor ?? "Expense",
      date,
      categoryHint: cleanString(r.category_hint, 60),
    },
  };
}

/* ---------- questions and due dates ---------- */

const QUERY_TYPES = new Set<string>([
  "udhar_person",
  "udhar_summary",
  "spending",
  "recent_expenses",
  "expense_list",
  "subscriptions_due",
  "subscriptions_overview",
]);

export const addDays = (ymd: string, days: number) =>
  new Date(Date.parse(ymd + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);

// Named periods the model can pass instead of working out dates itself, which
// is where it slipped most ("this week" answered with the month's total).
// Weeks start on Monday.
export const PERIODS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_year",
  "last_year",
  "last_7_days",
  "last_30_days",
] as const;

export function periodRange(period: string, today: string): { from: string; to: string; label: string } | null {
  const [y, m] = today.split("-").map(Number);
  const weekday = (new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7; // Monday = 0
  const monthStart = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = (year: number, month: number) =>
    `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
  switch (period) {
    case "today":
      return { from: today, to: today, label: "Today" };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1), label: "Yesterday" };
    case "this_week":
      return { from: addDays(today, -weekday), to: today, label: "This week" };
    case "last_week":
      return { from: addDays(today, -weekday - 7), to: addDays(today, -weekday - 1), label: "Last week" };
    case "this_month":
      return { from: monthStart(y, m), to: today, label: "This month" };
    case "last_month": {
      const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
      return { from: monthStart(py, pm), to: monthEnd(py, pm), label: "Last month" };
    }
    case "this_year":
      return { from: `${y}-01-01`, to: today, label: "This year" };
    case "last_year":
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: "Last year" };
    case "last_7_days":
      return { from: addDays(today, -6), to: today, label: "Last 7 days" };
    case "last_30_days":
      return { from: addDays(today, -29), to: today, label: "Last 30 days" };
  }
  return null;
}

// A category named loosely ("food" for "Food & Dining") still counts, as long
// as only one of the user's categories fits.
export function matchCategory(hint: string | null, categories: string[]): string | null {
  if (!hint) return null;
  const all = [...categories, UNCATEGORISED_LABEL];
  const lower = hint.toLowerCase();
  const exact = all.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;
  if (lower === "uncategorized" || lower === "none") return UNCATEGORISED_LABEL;
  const key = personKey(hint);
  if (key.length < 3) return null;
  const partial = all.filter((c) => {
    const k = personKey(c);
    return k.length >= 3 && (k.includes(key) || key.includes(k));
  });
  return partial.length === 1 ? partial[0] : null;
}

type PeriodResult =
  | { ok: true; year: number | null; month: number | null; from: string | null; to: string | null; label: string | null }
  | { ok: false; reason: string };

// Works out which days a question covers: a named period, explicit dates, or a
// month/year. With nothing said, `fallback` decides - this month for totals,
// no limit for a list of expenses.
function resolvePeriod(r: Record<string, unknown>, today: string, fallback: "this_month" | "none"): PeriodResult {
  const [thisYear, thisMonth] = today.split("-").map(Number);
  const none = { year: null, month: null, from: null, to: null, label: null };

  const period = cleanString(r.period, 20)?.toLowerCase().replace(/[\s-]+/g, "_");
  const named = period ? periodRange(period, today) : null;
  if (named) return { ok: true, ...none, ...named };

  const start = cleanString(r.start_date, 10);
  const end = cleanString(r.end_date, 10);
  if (start || end) {
    const from = start ?? end;
    const to = end ?? start;
    if (!validYmd(from) || !validYmd(to)) return { ok: false, reason: "I couldn't work out those dates. Try: what did I spend from 1 to 10 September?" };
    const [a, b] = from <= to ? [from, to] : [to, from];
    if (a > today) return { ok: false, reason: "Those dates haven't happened yet." };
    return { ok: true, ...none, from: a, to: b > today ? today : b };
  }

  const askedYear = wholeNumber(r.year);
  const askedMonth = wholeNumber(r.month);
  if (askedMonth !== null && (askedMonth < 1 || askedMonth > 12)) {
    return { ok: false, reason: "That month doesn't look right. Try: what did I spend in August?" };
  }
  if (askedYear === null && askedMonth === null) {
    return fallback === "this_month" ? { ok: true, ...none, year: thisYear, month: thisMonth } : { ok: true, ...none };
  }
  // A month on its own means its most recent occurrence: "December", asked in
  // September, is last December.
  const month = askedMonth;
  const year = askedYear ?? (askedMonth !== null && askedMonth > thisMonth ? thisYear - 1 : thisYear);
  if (year < 2000 || year > thisYear) return { ok: false, reason: "That year doesn't look right." };
  if (year === thisYear && month !== null && month > thisMonth) return { ok: false, reason: "That month hasn't happened yet." };
  return { ok: true, ...none, year, month };
}
const UNCATEGORISED_LABEL = "Uncategorised";
// Furthest ahead a due date can be set.
export const MAX_DUE_DAYS = 730;

// A real calendar date: "2027-02-30" is refused rather than rolled into March.
export function validYmd(d: string | null): d is string {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const ms = Date.parse(d + "T00:00:00Z");
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === d;
}

export const daysBetween = (from: string, to: string) =>
  (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000;

export function wholeNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isInteger(n) ? n : null;
}

function entryNames(r: Record<string, unknown>): string[] {
  return (Array.isArray(r.entries) ? r.entries : [])
    .map((e) => cleanString((e as Record<string, unknown>)?.person, 80))
    .filter((n): n is string => n !== null);
}

export function matchPeople(names: string[], people: string[]): { matched: string[]; unknown: string[] } {
  const known = new Map(people.map((name) => [personKey(name), name]));
  const matched: string[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const hit = known.get(personKey(name));
    if (!hit) unknown.push(name);
    else if (!matched.includes(hit)) matched.push(hit);
  }
  return { matched, unknown };
}

// The model sometimes recognises a balance question but leaves the name out
// of entries. Names already in the khata are then found in the message itself,
// using the same matching that treats "abdurrehman" and "Abdur Rehman" alike.
function namesFrom(r: Record<string, unknown>, people: string[], messageText: string): string[] {
  const named = entryNames(r);
  return named.length ? named : people.filter((p) => mentionsPerson(messageText, p));
}

function validateQuery(
  r: Record<string, unknown>,
  today: string,
  people: string[],
  categories: string[],
  messageText = ""
): ParseOutcome {
  const refuse = (reason: string): ParseOutcome => ({ ok: false, reason, question: true });
  const type = cleanString(r.query_type, 40)?.toLowerCase() ?? "";
  if (!QUERY_TYPES.has(type)) {
    return refuse("I couldn't tell what you wanted to know. Try: how much does Ali owe? - or: what did I spend this month?");
  }
  const base: ParsedQuery = {
    type: type as QueryType,
    people: [],
    year: null,
    month: null,
    category: null,
    vendor: null,
  };

  if (type === "udhar_person") {
    const names = namesFrom(r, people, messageText);
    if (!names.length) return refuse("Whose khata do you want to know about? e.g. how much does Ali owe?");
    if (names.length > MAX_LEDGER_ENTRIES) {
      return refuse(`That's more than ${MAX_LEDGER_ENTRIES} people in one message. Please split it up.`);
    }
    const { matched, unknown } = matchPeople(names, people);
    if (unknown.length) return refuse(`I couldn't find ${unknown.join(", ")} in your Udhar Khata.`);
    return { ok: true, kind: "query", query: { ...base, people: matched } };
  }

  if (type === "spending" || type === "expense_list") {
    const period = resolvePeriod(r, today, type === "spending" ? "this_month" : "none");
    if (!period.ok) return refuse(period.reason);
    // Only a category the user actually has. A word that isn't one of them
    // ("fuel", "daraz") is searched for in the vendor and note instead, so the
    // answer is still about what was asked rather than everything.
    const hint = cleanString(r.category_hint, 60);
    const category = matchCategory(hint, categories);
    const vendor = cleanString(r.vendor, 60) ?? (hint && !category ? hint : null);
    const query: ParsedQuery = {
      ...base,
      year: period.year,
      month: period.month,
      from: period.from,
      to: period.to,
      label: period.label,
      category,
      vendor,
    };
    if (type === "expense_list") {
      const sort = cleanString(r.sort, 10)?.toLowerCase();
      query.sort = sort === "biggest" || sort === "largest" || sort === "highest" ? "biggest" : "latest";
      const limit = wholeNumber(r.limit);
      query.limit = limit !== null && limit >= 1 ? Math.min(limit, 20) : query.sort === "biggest" ? 5 : 10;
    }
    return { ok: true, kind: "query", query };
  }

  return { ok: true, kind: "query", query: base };
}

function validateDueDate(
  r: Record<string, unknown>,
  today: string,
  people: string[],
  messageText = ""
): ParseOutcome {
  const names = namesFrom(r, people, messageText);
  if (names.length !== 1) {
    return { ok: false, reason: "Set a due date for one person at a time, e.g. Ali will pay back on the 1st" };
  }
  const { matched, unknown } = matchPeople(names, people);
  if (unknown.length) return { ok: false, reason: `I couldn't find ${unknown[0]} in your Udhar Khata.` };
  if (r.clear_due_date === true) return { ok: true, kind: "due_date", due: { person: matched[0], date: null } };

  const date = cleanString(r.due_date, 10);
  if (!validYmd(date)) {
    return { ok: false, reason: "I couldn't work out the date. Try: Ali will pay back on 1 October" };
  }
  const ahead = daysBetween(today, date);
  if (ahead < 0 || ahead > MAX_DUE_DAYS) {
    return { ok: false, reason: "That date looks off - use a date from today up to two years ahead." };
  }
  return { ok: true, kind: "due_date", due: { person: matched[0], date } };
}

// Creating a person needs the message itself to ask for it. The model's
// is_new flag alone isn't trusted: a misspelt existing name must never become
// a second ledger for the same friend because the model guessed.
const NEW_PERSON_WORDS = /\b(new|naya|nayi|create|borrower|person|contact)\b/i;

export function asksForNewPerson(text: string): boolean {
  return NEW_PERSON_WORDS.test(text);
}

// "habib ullah" -> "Habib Ullah". Letters only (with . ' - inside words), at
// most five words, so a misread amount or phone number can't become a name.
export function newPersonName(raw: string): string | null {
  const words = raw.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length || words.length > 5) return null;
  if (!words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w))) return null;
  const name = words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  return name.length <= 60 ? name : null;
}

// Existing people are matched by name. A new person is added only when the
// message asks for one and the model marked that name as new; any other
// unknown name is sent back to be fixed rather than guessed into existence.
function validateLedger(
  r: Record<string, unknown>,
  direction: LedgerDirection,
  people: string[],
  messageText: string
): ParseOutcome {
  const rawEntries = Array.isArray(r.entries) ? r.entries : [];
  if (!rawEntries.length) {
    return { ok: false, reason: "Tell me who and how much, e.g. add 700 to Ali's khata, or Ali paid me back 500" };
  }
  if (rawEntries.length > MAX_LEDGER_ENTRIES) {
    return { ok: false, reason: `That's more than ${MAX_LEDGER_ENTRIES} people in one message. Please split it up.` };
  }
  const currency = currencyProblem(r.currency);
  if (currency) return { ok: false, reason: currency };

  // Someone who isn't in the khata yet can't have paid anything back.
  const canCreate = direction === "lend" && asksForNewPerson(messageText);
  const known = new Map(people.map((name) => [personKey(name), name]));
  const entries: LedgerEntry[] = [];
  const unknown: string[] = [];
  for (const item of rawEntries as Record<string, unknown>[]) {
    const name = cleanString(item?.person, 80);
    if (!name) return { ok: false, reason: "I couldn't tell whose khata that is. Please include the name." };
    // "Paid all his debt" names no amount; the balance is filled in when it's
    // saved. Only a repayment can mean "everything", and any amount the model
    // guessed alongside it is ignored.
    const all = direction === "repayment" && item.all === true;
    const amount = typeof item.amount === "number" ? item.amount : Number(item.amount);
    if (!all) {
      const problem = amountProblem(amount);
      if (problem) return { ok: false, reason: `${name}: ${problem}` };
    }

    const match = known.get(personKey(name));
    let entry: LedgerEntry;
    if (match) {
      // Asked to add someone who is already there: use the existing person.
      entry = all
        ? { person: match, amount: null, isNew: false, all: true }
        : { person: match, amount: round2(amount), isNew: false };
    } else if (canCreate && item.is_new === true) {
      const tidy = newPersonName(name);
      if (!tidy) {
        return {
          ok: false,
          reason: `"${name}" doesn't look like a name I can add. Use letters only, e.g. add new borrower Habib Ullah with 500`,
        };
      }
      entry = { person: tidy, amount: round2(amount), isNew: true };
    } else {
      unknown.push(name);
      continue;
    }

    if (entries.some((e) => personKey(e.person) === personKey(entry.person))) {
      return { ok: false, reason: `${entry.person} is mentioned twice. Please send one amount per person.` };
    }
    entries.push(entry);
  }

  if (unknown.length) {
    const list = unknown.join(", ");
    return {
      ok: false,
      reason:
        direction === "repayment"
          ? `${list} ${unknown.length === 1 ? "isn't" : "aren't"} in your Udhar Khata, so I can't record a payment. Check the spelling.`
          : `I couldn't find ${list} in your Udhar Khata. Check the spelling, or to add someone new say: add new borrower ${unknown[0]} with 500`,
    };
  }
  return { ok: true, kind: "ledger", ledger: { direction, entries, note: cleanString(r.note, 200) } };
}

/* ---------- last resort: reading plain text without AI ---------- */

const UNITS: Record<string, number> = {
  k: 1_000,
  lac: 100_000,
  lacs: 100_000,
  lakh: 100_000,
  lakhs: 100_000,
};
const FILLER = new Set([
  "rs", "rs.", "pkr", "₨", "rupee", "rupees", "paid", "spent", "for", "on", "at", "the", "of",
  "yesterday", "today",
]);
// Words that mean the message is about Udhar Khata, not spending.
const LEDGER_WORDS =
  /\b(udhar|udhaar|khata|lend|lent|loan|borrow\w*|owes?|owed|paid\s+(me\s+)?back|pay\s+back|returned|wapas|gave|given|received\s+from|back\s+from|debts?|depts?|settle|settled)\b/i;

// Questions and dates. Without the model these can't be told apart from an
// expense: "ali will pay on 1st" has exactly one number in it.
const QUESTION_OR_DATE = /\?|\b(how|what|who|which|when|remind|due|will\s+pay|pay\s+on)\b/i;

// True when a person's name appears as whole words - "Ali" in "ali 500" but
// not in "quality" - allowing the words to be run together ("abdurrehman").
export function mentionsPerson(text: string, name: string): boolean {
  const words = name.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (!words.length) return false;
  return new RegExp(`(^|[^a-z])${words.join("[^a-z]*")}($|[^a-z])`).test(text.toLowerCase());
}

// Used only when every model has failed, and only for simple expenses.
// Deliberately narrow: exactly one number, or nothing is saved - "fuel 3000
// shell" is safe to read this way, "dinner 2500 on 12 sep" is refused rather
// than guessed at. Anything that looks like Udhar Khata is refused too, or
// "ali paid me back 1000" would be saved as a 1000 expense. Photos can't be
// read at all without the model.
export function parseOffline(text: string, today: string, people: string[] = []): ParseOutcome {
  if (LEDGER_WORDS.test(text) || QUESTION_OR_DATE.test(text) || people.some((p) => mentionsPerson(text, p))) {
    return { ok: false, reason: "Udhar Khata updates need the AI, which is busy right now. Nothing was added - please send it again in a minute." };
  }
  const refused: ParseOutcome = {
    ok: false,
    reason: "I couldn't read that without the AI. Send just one amount, like: fuel 3000 shell",
  };
  const w = text
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1") // 3,000 -> 3000
    .replace(/(\d)([a-zA-Z₨])/g, "$1 $2"); // 3000rs, 2.5k -> 3000 rs, 2.5 k
  const matches = [...w.matchAll(/(\d+(?:\.\d+)?)(?:\s*(k|lacs?|lakhs?)\b)?/gi)];
  if (matches.length !== 1) return refused;

  const m = matches[0];
  const amount = Number(m[1]) * (m[2] ? UNITS[m[2].toLowerCase()] : 1);
  const date = /\byesterday\b/i.test(w)
    ? new Date(Date.parse(today + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10)
    : today;
  const at = m.index ?? 0;
  const note = `${w.slice(0, at)} ${w.slice(at + m[0].length)}`
    .split(/\s+/)
    .filter((word) => word && !FILLER.has(word.toLowerCase()))
    .join(" ");

  return validateParsed({ intent: "expense", amount, vendor: null, note: note || null, date }, today);
}

/* ---------- choosing models ---------- */

// Aliases Google repoints at new releases - sometimes previews - so they are
// only a last resort, and only if the API actually lists them.
const ALIASES = ["gemini-flash-latest", "gemini-flash-lite-latest"];

// Gemini model names change as versions ship, so rather than hard-coding one
// the API is asked what exists. Stable Flash models come first, newest first,
// then Flash-Lite, then the aliases.
export function rankFlashModels(names: string[]): string[] {
  const bare = [...new Set(names.map((n) => n.replace(/^models\//, "")))];
  const tier = (re: RegExp) =>
    bare
      .map((n) => ({ n, m: re.exec(n) }))
      .filter((x): x is { n: string; m: RegExpExecArray } => x.m !== null)
      .sort((x, y) => Number(y.m[1]) - Number(x.m[1]))
      .map((x) => x.n);
  return [
    ...tier(/^gemini-(\d+(?:\.\d+)?)-flash$/),
    ...tier(/^gemini-(\d+(?:\.\d+)?)-flash-lite$/),
    ...ALIASES.filter((a) => bare.includes(a)),
  ];
}

export function pickFlashModel(names: string[]): string | null {
  return rankFlashModels(names)[0] ?? null;
}

// retry: overloaded or rate-limited - try another model, and this one again later.
// skip:  a problem with this model (retired, doesn't accept the request) - move on.
// fatal: the key is refused or the photo is too big - every model would fail.
export type StatusClass = "retry" | "skip" | "fatal";

export function classifyStatus(status: number): StatusClass {
  if (status === 429 || (status >= 500 && status <= 504)) return "retry";
  if (status === 401 || status === 403 || status === 413) return "fatal";
  return "skip";
}

// Time limits. A model that neither answers nor errors used to hold the
// request open until Vercel ended the function at 60s, before any reply. All
// attempts share one budget that leaves room to save and reply.
export const GEMINI_BUDGET_MS = 40_000;
export const TEXT_ATTEMPT_MS = 8_000;
export const IMAGE_ATTEMPT_MS = 15_000;
export const MIN_ATTEMPT_MS = 3_000;
export const RETRY_BACKOFF_MS = 1_500;
export const MAX_ATTEMPTS = 8;
// How long a failing model is moved to the back of the queue.
export const BUSY_COOLDOWN_MS = 2 * 60_000;
// A model that says its quota is used up (429) rarely recovers within minutes,
// so it steps aside for longer; retrying it every two minutes cost each message
// several wasted attempts while the free-tier quota was exhausted.
export const RATE_LIMIT_COOLDOWN_MS = 10 * 60_000;
export const BROKEN_COOLDOWN_MS = 30 * 60_000;
// A model the API reports as gone (404) stays out of the way for a day.
export const RETIRED_COOLDOWN_MS = 24 * 60 * 60_000;
// When the model asked first hasn't answered by then, the next one is asked
// as well and whichever answers first is used. Free-tier Flash models answer
// most messages in 1-2s but sometimes sit for 10s or more.
export const HEDGE_TEXT_MS = 1_500;
export const HEDGE_MEDIA_MS = 6_000;
export const MAX_PARALLEL = 2;
// A success this recent puts a model first in line.
export const RECENT_OK_MS = 30 * 60_000;

export function attemptTimeout(deadline: number, now: number, perAttempt: number): number {
  return Math.max(0, Math.min(perAttempt, deadline - now));
}

// What the app remembers about each model, shared across server instances
// through the database - memory inside one instance was lost as soon as
// Vercel handled the next message somewhere else.
export type ModelHealth = { busyUntil: number; lastOkAt: number };
export type HealthUpdate = { model: string; ok: boolean; ms: number; busyUntil: number };
export type HealthStore = {
  load(): Promise<Map<string, ModelHealth>>;
  save(updates: HealthUpdate[]): Promise<void>;
};

// Models that answered recently go first (most recent first), then the rest
// in rank order, then models still cooling down after failing.
export function orderCandidates(ranked: string[], health: Map<string, ModelHealth>, now: number): string[] {
  const busy = (m: string) => (health.get(m)?.busyUntil ?? 0) > now;
  const lastOk = (m: string) => health.get(m)?.lastOkAt ?? 0;
  const recent = (m: string) => lastOk(m) > 0 && now - lastOk(m) <= RECENT_OK_MS;
  const ready = ranked.filter((m) => !busy(m));
  return [
    ...ready.filter(recent).sort((a, b) => lastOk(b) - lastOk(a)),
    ...ready.filter((m) => !recent(m)),
    ...ranked.filter(busy),
  ];
}

export type AttemptResult = "ok" | "timeout" | "network" | `http_${number}`;
export type Attempt = { model: string; pass: 1 | 2; result: AttemptResult; ms: number };

// Models worth a second try: the ones that said they were overloaded or
// rate-limited. A model that timed out or refused the request is not asked
// twice in the same message.
export function planSecondPass(attempts: Attempt[]): string[] {
  const out: string[] = [];
  for (const a of attempts) {
    if (a.pass !== 1) continue;
    const m = /^http_(\d+)$/.exec(a.result);
    if (m && classifyStatus(Number(m[1])) === "retry" && !out.includes(a.model)) out.push(a.model);
  }
  return out;
}

// Every model tried failed in a way that should pass. Distinct from other
// failures so the reply can say "try again shortly", and so a plain-text
// expense can still be read without the model.
export class GeminiBusyError extends Error {
  attempts: Attempt[];
  constructor(detail: string, attempts: Attempt[] = []) {
    super(`Gemini busy: ${detail}`);
    this.name = "GeminiBusyError";
    this.attempts = attempts;
  }
}

/* ---------- calling Gemini ---------- */

const API = "https://generativelanguage.googleapis.com/v1beta";
let cachedModels: string[] | null = null;

// Gemini 3 Flash models think before answering by default, which made simple
// messages take 10s or more. Picking one function from a list needs little of
// it, so they are asked to think less. Flash-Lite doesn't take the setting.
const noThinking = new Set<string>();
// Models this server instance has seen answer 404 ("no longer available").
// The shared cooldown covers other instances; this covers runs without it.
const retired = new Set<string>();

export function usesThinking(model: string): boolean {
  const m = /^gemini-(\d+(?:\.\d+)?)-flash$/.exec(model);
  return m !== null && Number(m[1]) >= 3 && !noThinking.has(model);
}

function withLowThinking(request: { generationConfig?: Record<string, unknown> }, model: string): string {
  void model;
  return JSON.stringify({
    ...request,
    generationConfig: { ...request.generationConfig, thinkingConfig: { thinkingLevel: "low" } },
  });
}

async function candidateModels(apiKey: string): Promise<string[]> {
  if (cachedModels) return cachedModels;
  // Bounded like the generate calls: on a fresh instance this runs before any
  // model is tried, and a hang here would otherwise eat the whole time limit.
  let res: Response;
  try {
    res = await fetch(`${API}/models?pageSize=200`, {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new GeminiBusyError(`model list: ${(err as Error).message}`);
  }
  if (classifyStatus(res.status) === "retry") throw new GeminiBusyError(`model list HTTP ${res.status}`);
  if (!res.ok) throw new Error(`Gemini model list failed: HTTP ${res.status}`);
  const list = (await res.json()) as {
    models?: { name: string; supportedGenerationMethods?: string[] }[];
  };
  const ranked = rankFlashModels(
    (list.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => m.name)
  );
  if (!ranked.length) throw new Error("No Gemini Flash model available to this API key");
  cachedModels = ranked;
  return ranked;
}

export type GeminiResult = { body: string; model: string; attempts: Attempt[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One generateContent request, tried across models with the time limits and
// fallbacks above. Returns the raw response body from the first model that
// answers; throws GeminiBusyError when none does in time, and a plain Error for
// a failure every model would share, such as a refused key.
export async function callGemini(opts: {
  request: string;
  perAttemptMs: number;
  health?: HealthStore;
}): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const deadline = Date.now() + GEMINI_BUDGET_MS;

  const ranked = await candidateModels(apiKey);
  let health = new Map<string, ModelHealth>();
  if (opts.health) {
    try {
      health = await opts.health.load();
    } catch (err) {
      // Without the shared memory, models are simply tried in rank order.
      console.warn("[gemini] model health unavailable:", (err as Error).message);
    }
  }
  const available = ranked.filter((m) => !retired.has(m));
  const ordered = orderCandidates(available.length ? available : ranked, health, Date.now());
  // Full Flash models read messages more accurately than Flash-Lite, so they
  // lead even when Lite answered more recently; Lite is the fast backup.
  const lite = (m: string) => m.includes("lite");
  const byTier = [...ordered.filter((m) => !lite(m)), ...ordered.filter(lite)];
  // GEMINI_MODEL, when set, is tried first; everything else still backs it up.
  const pinned = process.env.GEMINI_MODEL;
  const order = pinned ? [pinned, ...byTier.filter((m) => m !== pinned)] : byTier;
  const hedgeMs = opts.perAttemptMs > TEXT_ATTEMPT_MS ? HEDGE_MEDIA_MS : HEDGE_TEXT_MS;
  const base = JSON.parse(opts.request) as { generationConfig?: Record<string, unknown> };

  const attempts: Attempt[] = [];
  const updates: HealthUpdate[] = [];
  const persist = async () => {
    if (!opts.health || !updates.length) return;
    try {
      await opts.health.save(updates.splice(0));
    } catch (err) {
      console.warn("[gemini] could not save model health:", (err as Error).message);
    }
  };

  // One call. Returns the response body, or null to move on to another model.
  // Throws only for a failure every model would share. A call cancelled because
  // another model already answered is not held against this one.
  const tryModel = async (model: string, pass: 1 | 2, cancel: AbortSignal): Promise<string | null> => {
    const timeout = attemptTimeout(deadline, Date.now(), opts.perAttemptMs);
    const started = Date.now();
    const record = (result: AttemptResult, coolFor: number) => {
      if (cancel.aborted) return;
      const ms = Date.now() - started;
      attempts.push({ model, pass, result, ms });
      updates.push({ model, ok: result === "ok", ms, busyUntil: coolFor ? Date.now() + coolFor : 0 });
    };
    const failure = (err: unknown): AttemptResult =>
      (err as Error)?.name === "TimeoutError" ? "timeout" : "network";
    const signal = AbortSignal.any([AbortSignal.timeout(timeout), cancel]);
    const post = (thinking: boolean) =>
      fetch(`${API}/models/${model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: thinking ? withLowThinking(base, model) : opts.request,
        signal,
      });

    let res: Response;
    let thinking = usesThinking(model);
    try {
      res = await post(thinking);
      // Thinking settings differ between models; one that refuses them is
      // asked again, straight away, without.
      if (thinking && res.status === 400) {
        const detail = await res.text().catch(() => "");
        if (/thinking/i.test(detail)) {
          noThinking.add(model);
          thinking = false;
          res = await post(false);
        } else {
          res = new Response(detail, { status: 400 });
        }
      }
    } catch (err) {
      record(failure(err), BUSY_COOLDOWN_MS);
      return null;
    }

    if (res.ok) {
      try {
        const body = await res.text(); // under the same time limit
        record("ok", 0);
        return body;
      } catch (err) {
        record(failure(err), BUSY_COOLDOWN_MS);
        return null;
      }
    }

    const kind = classifyStatus(res.status);
    if (res.status === 404) retired.add(model);
    record(
      `http_${res.status}`,
      kind === "retry"
        ? res.status === 429
          ? RATE_LIMIT_COOLDOWN_MS
          : BUSY_COOLDOWN_MS
        : kind === "skip"
          ? res.status === 404
            ? RETIRED_COOLDOWN_MS
            : BROKEN_COOLDOWN_MS
          : 0
    );
    if (kind === "fatal") {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`Gemini ${model} HTTP ${res.status} ${detail}`);
    }
    if (kind === "skip") {
      // Logged in full: a request every model rejects (a malformed tool
      // declaration, say) otherwise only ever shows up as "busy".
      console.warn(`[gemini] ${model} HTTP ${res.status}:`, (await res.text().catch(() => "")).slice(0, 300));
    }
    return null;
  };

  // Asks models in order. If the current one is slow, the next is asked in
  // parallel (at most MAX_PARALLEL at once); a failure starts the next at once.
  // The first answer wins and the rest are cancelled.
  const runPass = (models: string[], pass: 1 | 2) =>
    new Promise<{ model: string; body: string } | null>((resolve, reject) => {
      let next = 0;
      let running = 0;
      let settled = false;
      let hedge: ReturnType<typeof setTimeout> | undefined;
      const controllers = new Set<AbortController>();
      const end = () => {
        settled = true;
        clearTimeout(hedge);
        for (const c of controllers) c.abort();
      };
      const canLaunch = () =>
        next < models.length &&
        attempts.length + running < MAX_ATTEMPTS &&
        attemptTimeout(deadline, Date.now(), opts.perAttemptMs) >= MIN_ATTEMPT_MS;
      const launch = () => {
        if (settled) return;
        if (!canLaunch()) {
          if (running === 0) {
            end();
            resolve(null);
          }
          return;
        }
        const model = models[next++];
        const controller = new AbortController();
        controllers.add(controller);
        running++;
        clearTimeout(hedge);
        hedge = setTimeout(() => {
          if (!settled && running < MAX_PARALLEL && canLaunch()) launch();
        }, hedgeMs);
        tryModel(model, pass, controller.signal).then(
          (body) => {
            running--;
            controllers.delete(controller);
            if (settled) return;
            if (body !== null) {
              end();
              resolve({ model, body });
            } else if (running < MAX_PARALLEL) {
              launch();
            }
          },
          (err) => {
            running--;
            controllers.delete(controller);
            if (settled) return;
            end();
            reject(err);
          }
        );
      };
      launch();
    });

  let hit: { model: string; body: string } | null;
  try {
    hit = await runPass(order, 1);
  } catch (err) {
    await persist();
    throw err;
  }
  if (!hit) {
    const again = planSecondPass(attempts);
    if (again.length && deadline - Date.now() > RETRY_BACKOFF_MS + MIN_ATTEMPT_MS) {
      await sleep(RETRY_BACKOFF_MS);
      try {
        hit = await runPass(again, 2);
      } catch (err) {
        await persist();
        throw err;
      }
    }
  }
  await persist();
  if (!hit) {
    throw new GeminiBusyError(
      attempts.map((a) => `${a.model}:${a.result}`).join(", ") || "out of time",
      attempts
    );
  }
  return { body: hit.body, model: hit.model, attempts };
}
