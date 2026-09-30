import {
  deletedSameDay,
  ensureCategoryTables,
  getNotificationRecipient,
  insertExpense,
  recordRoutineSeen,
  resolveExpenseCategory,
  unseenMessageIds,
  untrackedSameDay,
} from "@/lib/db";
import { isMessageId, isSameExpense } from "@/lib/routine-match";
import { notify } from "@/lib/notify";
import {
  importedExpensesMessage,
  uncategorisedExpenseMessage,
  uncategorisedRollupMessage,
} from "@/lib/reminder-messages";

// Everything a run of the email import decides, turned into expenses.
//
// This used to be the body of /api/routine/ingest, and that endpoint is still
// how the old cloud routine talks to it. It lives here because the app now
// reads Gmail itself (see gmail-sync.ts) and goes through exactly the same
// checks: the same duplicate rule, the same tombstones, the same record of
// which emails have been dealt with, the same notifications. Two callers, one
// set of rules.

// How long a notification about an import stays worth pushing to the phone;
// it is in the bell either way.
export const IMPORT_VALID_MINUTES = 12 * 60;
// Uncategorised expenses each get their own notification, up to this many in
// one run - past that, the rest are rolled into one.
const MAX_SINGLE_UNCATEGORISED = 3;

export type IncomingExpense = {
  source_id?: unknown;
  amount?: unknown;
  date?: unknown;
  vendor?: unknown;
  category?: unknown;
  note?: unknown;
};
export type IncomingSkip = { source_id?: unknown; reason?: unknown };

export type Posted = {
  source_id: string;
  id: string;
  amount: number;
  vendor: string | null;
  date: string;
  category: string | null;
};

export type IngestResult = {
  posted: Posted[];
  duplicates: { source_id: string; amount: number; vendor: string | null; date: string; matched_id: string }[];
  deleted_by_you: { source_id: string; amount: number; vendor: string | null; date: string; deleted_on: string }[];
  already: string[];
  skipped: string[];
  invalid: { source_id: unknown; error: string }[];
};

const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?)?$/;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function ingestDecisions(
  userId: string,
  expenses: IncomingExpense[],
  skipped: IncomingSkip[]
): Promise<IngestResult> {
  const allIds = [...expenses, ...skipped].map((e) => e.source_id).filter(isMessageId);
  const fresh = new Set(await unseenMessageIds(userId, allIds));

  const result: IngestResult = {
    posted: [],
    duplicates: [],
    deleted_by_you: [],
    already: [],
    skipped: [],
    invalid: [],
  };

  if (expenses.length) await ensureCategoryTables();

  for (const e of expenses) {
    if (!isMessageId(e.source_id)) {
      result.invalid.push({ source_id: e.source_id ?? null, error: "source_id must be the Gmail message id" });
      continue;
    }
    const sourceId = e.source_id;
    const amount = Number(e.amount);
    const rawDate = text(e.date, 40);
    if (!Number.isFinite(amount) || amount <= 0) {
      result.invalid.push({ source_id: sourceId, error: "amount must be a positive number" });
      continue;
    }
    if (!DATE.test(rawDate) || Number.isNaN(Date.parse(rawDate.slice(0, 10)))) {
      result.invalid.push({ source_id: sourceId, error: "date must be YYYY-MM-DD" });
      continue;
    }
    // Already dealt with by an earlier run: nothing to do, and nothing read.
    if (!fresh.has(sourceId)) {
      result.already.push(sourceId);
      continue;
    }

    const date = rawDate.slice(0, 10);
    const expenseDateTime = rawDate.includes("T") ? rawDate : `${rawDate}T00:00:00Z`;
    const vendor = text(e.vendor, 120) || null;
    const note = text(e.note, 500);
    const category = text(e.category, 60) || null;

    // Logged some other way already - by hand, over WhatsApp, or by the
    // routine before it kept a record: the same payment, so not again.
    const candidates = await untrackedSameDay(userId, date, amount);
    const match = candidates.find((c) => isSameExpense({ amount, date, vendor }, c));
    if (match) {
      await recordRoutineSeen(userId, sourceId, "duplicate", `matches ${match.id}`, match.id);
      fresh.delete(sourceId);
      result.duplicates.push({ source_id: sourceId, amount, vendor, date, matched_id: match.id });
      continue;
    }

    // Deleted by hand: it stays deleted. See rememberDeletion.
    const tombstone = (await deletedSameDay(userId, date, amount)).find((t) =>
      isSameExpense({ amount, date, vendor }, t)
    );
    if (tombstone) {
      const deletedOn = tombstone.deletedAt.slice(0, 10);
      await recordRoutineSeen(userId, sourceId, "skipped", `you deleted this expense on ${deletedOn}`, null);
      fresh.delete(sourceId);
      result.deleted_by_you.push({ source_id: sourceId, amount, vendor, date, deleted_on: deletedOn });
      continue;
    }

    const resolved = await resolveExpenseCategory({
      userId,
      vendor,
      note,
      provided: category,
      // A category read out of a bank email is a suggestion the rules may
      // overrule, and is never learned from - as on /api/expenses.
      explicit: false,
    });
    let id: string;
    try {
      id = await insertExpense({
        userId,
        amount,
        note,
        expenseDateTime,
        vendor,
        category: resolved.category,
        vendorKey: resolved.vendorKey,
        sourceId,
      });
    } catch (err) {
      // Another run inserted this very email a moment ago - the unique index
      // on (user_id, source_id) refused the second copy.
      if (/unique/i.test((err as Error).message)) {
        await recordRoutineSeen(userId, sourceId, "posted", "inserted by a concurrent run", null);
        result.already.push(sourceId);
        continue;
      }
      throw err;
    }
    await recordRoutineSeen(userId, sourceId, "posted", null, id);
    // Handled: the same id again later in this request is "already".
    fresh.delete(sourceId);
    result.posted.push({ source_id: sourceId, id, amount, vendor, date, category: resolved.category });
  }

  for (const s of skipped) {
    if (!isMessageId(s.source_id)) {
      result.invalid.push({ source_id: s.source_id ?? null, error: "source_id must be the Gmail message id" });
      continue;
    }
    if (!fresh.has(s.source_id)) {
      result.already.push(s.source_id);
      continue;
    }
    await recordRoutineSeen(userId, s.source_id, "skipped", text(s.reason, 200) || null, null);
    fresh.delete(s.source_id);
    result.skipped.push(s.source_id);
  }

  return result;
}

// What a run added, told to the user. Called from after(), so a phone's push
// service never keeps the caller waiting. Expenses with a category go in one
// notification for the run. Each one without a category gets its own, which
// opens that very expense so it can be sorted in one tap; past a few in one
// run, the rest are rolled into a single one.
export async function notifyPosted(userId: string, posted: Posted[]): Promise<void> {
  if (!posted.length) return;
  try {
    const recipient = await getNotificationRecipient(userId);
    if (!recipient?.prefs.importedExpenses) return;
    const categorised = posted.filter((p) => p.category);
    const uncategorised = posted.filter((p) => !p.category);
    if (categorised.length) {
      await notify(
        userId,
        importedExpensesMessage(
          categorised.map((p) => ({ amount: p.amount, vendor: p.vendor, category: p.category })),
          categorised[0].source_id
        ),
        { validForMinutes: IMPORT_VALID_MINUTES }
      );
    }
    for (const p of uncategorised.slice(0, MAX_SINGLE_UNCATEGORISED)) {
      await notify(userId, uncategorisedExpenseMessage({ id: p.id, amount: p.amount, vendor: p.vendor }), {
        validForMinutes: IMPORT_VALID_MINUTES,
      });
    }
    const more = uncategorised.length - MAX_SINGLE_UNCATEGORISED;
    if (more > 0) {
      await notify(userId, uncategorisedRollupMessage(more, uncategorised[0].source_id), {
        validForMinutes: IMPORT_VALID_MINUTES,
      });
    }
  } catch (err) {
    console.error(JSON.stringify({ evt: "import_notify", error: (err as Error).message.slice(0, 200) }));
  }
}
