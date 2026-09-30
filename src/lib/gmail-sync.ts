import {
  findUserByUsername,
  listUserCategories,
  loadModelHealth,
  readAppMeta,
  saveModelHealth,
  unseenMessageIds,
  writeAppMeta,
} from "@/lib/db";
import { callGemini, GeminiBusyError, pakistanToday, TEXT_ATTEMPT_MS, type HealthStore } from "@/lib/expense-parse";
import { fetchEmail, gmailConfigured, searchMessages, type Email } from "@/lib/gmail";
import {
  BANK_SENDERS,
  EXCLUDED_MERCHANTS,
  OWN_ACCOUNTS,
  checkDecision,
  noteFromEmail,
  searchQuery,
  syncWindow,
  type Decided,
  type ModelDecision,
} from "@/lib/email-rules";
import {
  ingestDecisions,
  notifyPosted,
  type IncomingExpense,
  type IncomingSkip,
  type IngestResult,
} from "@/lib/routine-ingest";

// Reading the bank's alert emails and turning them into expenses - the job a
// scheduled cloud agent used to do, now part of the app and driven by the same
// cron call as everything else on a timer.
//
// Shaped so it is safe to call as often as anyone likes, like /api/cron/run:
// the window starts where the last successful run finished, every email is
// checked against what previous runs already dealt with, and an email is only
// ever marked dealt-with once it has actually become an expense or a recorded
// skip. A failed run therefore loses nothing - the next one covers the same
// ground.

const health: HealthStore = { load: loadModelHealth, save: saveModelHealth };

// Where the last successful run read up to, in Unix seconds.
const BOOKMARK = "gmail_sync_through";
// Alerts read in one run. A quiet day brings a handful; this only matters
// after an outage, and the rest are picked up by the next run minutes later
// rather than by one call that runs out of time.
const MAX_PER_RUN = 12;

// A finished run: what happened, and the notification it owes the user. The
// notification is handed back rather than sent here so the caller can leave it
// until after its response - a phone's push service never holds up a run - and
// so nothing in this file has to know it is inside a request.
export type SyncRun = { summary: SyncSummary; notify: () => Promise<void> };

export type SyncSummary = {
  ok: boolean;
  /** Why nothing was done, when that is the answer: it is off, or idle. */
  state: "imported" | "nothing new" | "not configured" | "failed";
  from?: string;
  to?: string;
  found?: number;
  unseen?: number;
  read?: number;
  left_for_next_run?: number;
  model?: string;
  posted?: { amount: number; vendor: string | null; date: string; category: string | null }[];
  counts?: { posted: number; duplicates: number; deleted_by_you: number; skipped: number; invalid: number };
  attention?: string[];
  error?: string;
};

const iso = (sec: number) => new Date(sec * 1000).toISOString();

const nothingToSay = () => Promise.resolve();

export async function syncGmailExpenses(): Promise<SyncRun> {
  if (!gmailConfigured()) return { summary: { ok: true, state: "not configured" }, notify: nothingToSay };

  const user = await findUserByUsername("walli");
  if (!user) {
    return { summary: { ok: false, state: "failed", error: "import account not found" }, notify: nothingToSay };
  }

  const saved = Number(await readAppMeta(BOOKMARK));
  const window = syncWindow(Date.now(), Number.isFinite(saved) && saved > 0 ? saved : null);
  const summary: SyncSummary = { ok: true, state: "nothing new", from: iso(window.startSec), to: iso(window.endSec) };

  try {
    const found = await searchMessages(searchQuery(window));
    summary.found = found.length;

    // Which of them no run has dealt with. Nearly always none, and then the
    // run ends here without reading a single email or asking a model.
    const unseen = await unseenMessageIds(user.id, found.map((f) => f.id));
    summary.unseen = unseen.length;
    if (!unseen.length) {
      await writeAppMeta(BOOKMARK, String(window.endSec));
      return { summary, notify: nothingToSay };
    }

    const batch = unseen.slice(0, MAX_PER_RUN);
    const leftOver = unseen.length - batch.length;
    summary.read = batch.length;
    summary.left_for_next_run = leftOver;

    const emails = await Promise.all(batch.map((id) => fetchEmail(id)));
    const categories = (await listUserCategories(user.id)).map((c) => c.name);
    const today = pakistanToday();

    const { decisions, model } = await decideEmails(emails, categories, today);
    summary.model = model;

    const expenses: IncomingExpense[] = [];
    const skipped: IncomingSkip[] = [];
    const attention: string[] = [];
    for (const email of emails) {
      const decided = decisions.get(email.id) ?? {
        kind: "skip" as const,
        reason: "attention: the alert could not be read",
      };
      if (decided.kind === "expense") {
        expenses.push({
          source_id: email.id,
          amount: decided.amount,
          date: decided.date,
          vendor: decided.vendor,
          category: decided.category,
          // A model that answers everything else but leaves the note out
          // should not cost the expense its description.
          note: decided.note || noteFromEmail(email.subject, email.from, email.receivedMs),
        });
      } else {
        skipped.push({ source_id: email.id, reason: decided.reason });
        if (decided.reason.startsWith("attention:")) attention.push(`${email.subject}: ${decided.reason}`);
      }
    }

    const result: IngestResult = await ingestDecisions(user.id, expenses, skipped);
    summary.state = result.posted.length ? "imported" : "nothing new";
    summary.posted = result.posted.map((p) => ({
      amount: p.amount,
      vendor: p.vendor,
      date: p.date,
      category: p.category,
    }));
    summary.counts = {
      posted: result.posted.length,
      duplicates: result.duplicates.length,
      deleted_by_you: result.deleted_by_you.length,
      skipped: result.skipped.length,
      invalid: result.invalid.length,
    };
    if (attention.length) summary.attention = attention;
    // Only once every email in the window has been accounted for: while some
    // are still waiting, the window has to keep reaching back far enough to
    // find them again.
    if (!leftOver) await writeAppMeta(BOOKMARK, String(window.endSec));

    return { summary, notify: () => notifyPosted(user.id, result.posted) };
  } catch (err) {
    const busy = err instanceof GeminiBusyError;
    return {
      summary: {
        ...summary,
        ok: false,
        state: "failed",
        error: `${busy ? "models busy: " : ""}${(err as Error).message.slice(0, 300)}`,
      },
      notify: nothingToSay,
    };
  }
}

/* ---------- reading the alerts ---------- */

// The judgement the rules cannot make on their own: is this money leaving the
// account as spending, and if so, how much, to whom, on what day. Written out
// of the prompt the cloud routine used, so the decisions come out the same.
function instructions(categories: string[], today: string): string {
  return [
    "You read bank alert emails from Pakistani banks and decide whether each one is an expense to record.",
    `Today is ${today} in Pakistan time (PKT, UTC+5). Amounts are Pakistani rupees.`,
    "",
    "For each email, answer with one object, filling in every field. kind is \"expense\" when money left the account as real spending, and \"skip\" for anything else. A field that does not apply is an empty string, or 0 for the amount - never two fields run into one.",
    "",
    "Record as an expense: card payments, POS purchases, ATM and cash withdrawals, bill payments, Raast and 1LINK fund transfers out, and online orders that were already paid by card.",
    "",
    "Skip, with a short reason:",
    "- money coming in, or an amount credited to the account",
    "- a transfer between the account holder's own accounts - a beneficiary or account name containing any of: " +
      OWN_ACCOUNTS.join(", "),
    "- a payment to any of these, which are tracked as subscriptions elsewhere: " + EXCLUDED_MERCHANTS.join(", "),
    "- anything failed, declined, reversed, or a refund",
    "- an order not yet paid for: cash on delivery, pay on delivery, or an amount still due. An order total alone is not proof of payment.",
    "- statements, adverts, one-time passwords, and anything that is not a transaction",
    "",
    "When an email is a transaction but you cannot tell the amount, the day, or whether it was really paid, skip it and start the reason with \"attention:\".",
    "",
    "For an expense:",
    "- amount: the number only, no currency or separators.",
    "- date: the day the payment happened, YYYY-MM-DD, in PKT. It is usually the day the alert was sent. Never a date after today.",
    "- vendor: the merchant or beneficiary and nothing else, as a person would write it - \"Foodpanda\", not \"FOODPANDA PK LHR 1234\". No card numbers, reference numbers or times. For a cash withdrawal, the word \"Cash\" and the bank.",
    "- note: always give one. One short line: what it was, which account it came from, and the time the alert gives.",
    categories.length
      ? `- category: the best fit from this list, or leave it out if none fits: ${categories.join(", ")}`
      : "- category: leave it out.",
  ].join("\n");
}

const SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    propertyOrdering: ["source_id", "kind", "amount", "date", "vendor", "category", "note", "reason"],
    properties: {
      source_id: { type: "STRING" },
      kind: { type: "STRING", enum: ["expense", "skip"] },
      amount: { type: "NUMBER" },
      date: { type: "STRING" },
      vendor: { type: "STRING" },
      category: { type: "STRING" },
      note: { type: "STRING" },
      reason: { type: "STRING" },
    },
    required: ["source_id", "kind"],
  },
};

// One request for the whole batch: a handful of short emails is far less work
// for a model than one call each, and it is one place for a run to fail.
//
// Exported so the decisions can be checked against real alerts without
// touching Gmail or the ledger - see scripts/try-email-decisions.ts.
export async function decideEmails(
  emails: Email[],
  categories: string[],
  today: string
): Promise<{ decisions: Map<string, Decided>; model: string }> {
  const asText = emails
    .map((e) =>
      [
        `--- email source_id: ${e.id}`,
        `received: ${new Date(e.receivedMs).toISOString()}`,
        `from: ${e.from}`,
        `subject: ${e.subject}`,
        e.text,
      ].join("\n")
    )
    .join("\n\n");

  const request = JSON.stringify({
    systemInstruction: { parts: [{ text: instructions(categories, today) }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Decide each of these ${emails.length} email(s). Answer with one object per email, using the source_id given.\n\n${asText}`,
          },
        ],
      },
    ],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA },
  });

  const { body, model } = await callGemini({ request, perAttemptMs: TEXT_ATTEMPT_MS, health });
  const decisions = new Map<string, Decided>();
  const data = JSON.parse(body) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const answer = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  let list: ModelDecision[];
  try {
    const parsed = JSON.parse(answer);
    list = Array.isArray(parsed) ? parsed : [];
  } catch {
    // Nothing usable: every email in the batch is left for the caller to mark
    // as needing attention, and none of them becomes an expense.
    return { decisions, model };
  }
  const byId = new Map(emails.map((e) => [e.id, e]));
  for (const d of list) {
    const id = typeof d.source_id === "string" ? d.source_id : "";
    if (!byId.has(id) || decisions.has(id)) continue;
    decisions.set(id, checkDecision(d, today));
  }
  return { decisions, model };
}

// Bank domains, for the settings screen and for anyone wondering what is being
// read. Nothing else in the mailbox is ever fetched.
export const IMPORTED_FROM = BANK_SENDERS;
