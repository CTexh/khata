import { NextResponse } from "next/server";
import { unseenMessageIds } from "@/lib/db";
import { routineUserId } from "@/lib/routine-auth";
import { isMessageId } from "@/lib/routine-match";

export const dynamic = "force-dynamic";

// Step one of every run: the routine sends the Gmail message ids its search
// found, and gets back only the ones it has never dealt with. Everything else
// was posted, found to be a duplicate or skipped by an earlier run, and is not
// read again.
export async function POST(req: Request) {
  const userId = await routineUserId(req);
  if (userId instanceof NextResponse) return userId;

  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length > 500) {
    return NextResponse.json({ error: "Send { ids: [...] } with at most 500 Gmail message ids" }, { status: 400 });
  }
  if (!ids.every(isMessageId)) {
    return NextResponse.json({ error: "Every id must be a Gmail message id" }, { status: 400 });
  }
  const unseen = await unseenMessageIds(userId, ids);
  return NextResponse.json({ unseen });
}
