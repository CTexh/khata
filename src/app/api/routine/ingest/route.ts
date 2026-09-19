import { NextResponse } from "next/server";
import {
  ensureCategoryTables,
  insertExpense,
  recordRoutineSeen,
  resolveExpenseCategory,
  unseenMessageIds,
  untrackedSameDay,
} from "@/lib/db";
import { routineUserId } from "@/lib/routine-auth";
import { isMessageId, isSameExpense } from "@/lib/routine-match";

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

  return NextResponse.json({ posted, duplicates, already, skipped: recordedSkips, invalid });
}
