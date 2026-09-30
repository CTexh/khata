import { NextResponse, after } from "next/server";
import { routineUserId } from "@/lib/routine-auth";
import {
  ingestDecisions,
  notifyPosted,
  type IncomingExpense,
  type IncomingSkip,
} from "@/lib/routine-ingest";

export const dynamic = "force-dynamic";

// Step two, and the last call of a run: everything the caller decided, in one
// request. Expenses are posted unless they are already here; emails it chose
// not to post (transfers between its own accounts, incoming money,
// subscriptions it is told to leave out) are recorded as dealt with, so no
// later run reads them again.
//
// The rules themselves are in routine-ingest.ts, because the app's own Gmail
// import (gmail-sync.ts) goes through the very same ones. This endpoint stays
// for anything outside the app that wants to hand expenses over - it is how
// the cloud email routine has always done it.
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

  const result = await ingestDecisions(userId, expenses, skipped);
  // After the response: the caller is never kept waiting on a push service.
  if (result.posted.length) after(() => notifyPosted(userId, result.posted));
  return NextResponse.json(result);
}
