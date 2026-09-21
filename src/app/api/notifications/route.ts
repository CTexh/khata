import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteNotification, listNotifications, markNotificationsRead } from "@/lib/db";

export const dynamic = "force-dynamic";

// The bell: what has been sent to this account, newest first, and how many of
// those it has not looked at yet. Only ever the caller's own.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const result = await listNotifications(session.userId);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}

// Opening the bell counts as seeing what it showed: everything up to the
// newest item on screen, so one that lands in between is not marked unseen.
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { before?: unknown };
  // No `before` means everything; a `before` that is not a date is a mistake,
  // and a mistake must not quietly mark everything as seen.
  const before = body.before ?? null;
  if (before !== null && (typeof before !== "string" || Number.isNaN(Date.parse(before)))) {
    return NextResponse.json({ error: "before must be a date" }, { status: 400 });
  }
  await markNotificationsRead(session.userId, before);
  return NextResponse.json({ ok: true });
}

// Swiping one away in the bell. It is gone for good: the bell is a record of
// what was sent, not something that has to be kept.
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Which notification?" }, { status: 400 });
  const gone = await deleteNotification(session.userId, id);
  if (!gone) return NextResponse.json({ error: "That notification is already gone." }, { status: 404 });
  return NextResponse.json({ success: true });
}
