import { NextResponse, after } from "next/server";
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
import { routineUserId } from "@/lib/routine-auth";
import { isMessageId, isSameExpense } from "@/lib/routine-match";
import { notify } from "@/lib/notify";
import {
  importedExpensesMessage,
  uncategorisedExpenseMessage,
  uncategorisedRollupMessage,
} from "@/lib/reminder-messages";

// How long a notification about an import stays worth pushing to the phone;
// it is in the bell either way.
const IMPORT_VALID_MINUTES = 12 * 60;
// Uncategorised expenses each get their own notification, up to this many in
// one run - past that, the rest are rolled into one.
const MAX_SINGLE_UNCATEGORISED = 3;

export const dynamic = "force-dynamic";

// Step two, and the last call of a run: everything the routine decided, in
// one request. Expenses are posted unless they are already here; emails it
// chose not to post (transfers between its own accounts, incoming money,
// subscriptions it is told to leave out) are recorded as dealt with, so no
// later run reads them again.
//
// The duplicate check happens here, as code, instead of the routine
// downloading the month's expenses and comparing them itself - that download
// was the largest single thing a run read, and it grew every day of the month.

type IncomingExpense = {
  source_id?: unknown;
  amount?: unknown;
  date?: unknown;
  vendor?: unknown;
  category?: unknown;
  note?: unknown;
};
type IncomingSkip = { source_id?: unknown; reason?: unknown };

const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?)?$/;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: Request) {
  const userId = await routineUserId(req);
  if (userId instanceof NextResponse) return userId;

  const body = (await req.json().catch(() => null)) as { expenses?: unknown; skipped?: unknown } | null;
  const expenses = (Array.isArray(body?.expenses) ? body.expenses : []) as IncomingExpense[];
  const skipped = (Array.isArray(body?.skipped) ? body.skipped : []) as IncomingSkip[];
  if (!body || (!Array.isArray(body.expenses) && !Array.isArray(body.skipped))) {
    return NextResponse.json({ error: "Send { expenses: [...], skipped: [...] }" }, { status: 400 });
  }
  if (expenses.length > 100 || skipped.length > 200) {
    return NextResponse.json({ error: "At most 100 expenses and 200 skipped per call" }, { status: 400 });
  }

  const allIds = [...expenses, ...skipped].map((e) => e.source_id).filter(isMessageId);
  const fresh = new Set(await unseenMessageIds(userId, allIds));

  const posted: { source_id: string; id: string; amount: number; vendor: string | null; date: string; category: string | null }[] = [];
  const duplicates: { source_id: string; amount: number; vendor: string | null; date: string; matched_id: string }[] = [];
  const already: string[] = [];
  const deletedByYou: { source_id: string; amount: number; vendor: string | null; date: string; deleted_on: string }[] = [];
  const recordedSkips: string[] = [];
  const invalid: { source_id: unknown; error: string }[] = [];

  if (expenses.length) await ensureCategoryTables();

  for (const e of expenses) {
    if (!isMessageId(e.source_id)) {
      invalid.push({ source_id: e.source_id ?? null, error: "source_id must be the Gmail message id" });
      continue;
    }
    const sourceId = e.source_id;
    const amount = Number(e.amount);
    const rawDate = text(e.date, 40);
    if (!Number.isFinite(amount) || amount <= 0) {
      invalid.push({ source_id: sourceId, error: "amount must be a positive number" });
      continue;
    }
    if (!DATE.test(rawDate) || Number.isNaN(Date.parse(rawDate.slice(0, 10)))) {
      invalid.push({ source_id: sourceId, error: "date must be YYYY-MM-DD" });
      continue;
    }
    // Already dealt with by an earlier run: nothing to do, and nothing read.
    if (!fresh.has(sourceId)) {
      already.push(sourceId);
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
      duplicates.push({ source_id: sourceId, amount, vendor, date, matched_id: match.id });
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
      deletedByYou.push({ source_id: sourceId, amount, vendor, date, deleted_on: deletedOn });
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
        already.push(sourceId);
        continue;
      }
      throw err;
    }
    await recordRoutineSeen(userId, sourceId, "posted", null, id);
    // Handled: the same id again later in this request is "already".
    fresh.delete(sourceId);
    posted.push({ source_id: sourceId, id, amount, vendor, date, category: resolved.category });
  }

  for (const s of skipped) {
    if (!isMessageId(s.source_id)) {
      invalid.push({ source_id: s.source_id ?? null, error: "source_id must be the Gmail message id" });
      continue;
    }
    if (!fresh.has(s.source_id)) {
      already.push(s.source_id);
      continue;
    }
    await recordRoutineSeen(userId, s.source_id, "skipped", text(s.reason, 200) || null, null);
    fresh.delete(s.source_id);
    recordedSkips.push(s.source_id);
  }

  // What this run added, told to the user - after the response, so the
  // routine is never kept waiting on a phone's push service. Expenses with a
  // category go in one notification for the run. Each one without a category
  // gets its own, which opens that very expense so it can be sorted in one
  // tap; past a few in one run, the rest are rolled into a single one.
  if (posted.length) {
    after(async () => {
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
    });
  }

  return NextResponse.json({
    posted,
    duplicates,
    deleted_by_you: deletedByYou,
    already,
    skipped: recordedSkips,
    invalid,
  });
}
