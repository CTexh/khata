import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { clearShortcutToken, getShortcutToken, rotateShortcutToken, userHasAi } from "@/lib/db";

export const dynamic = "force-dynamic";

// The token a Shortcut on the phone uses to reach the assistant. Making a new
// one replaces the old, so a phone that has it loses access - which is the way
// to take it back.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const [token, ai] = await Promise.all([getShortcutToken(session.userId), userHasAi(session.userId)]);
  return NextResponse.json(
    { token, available: ai },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await userHasAi(session.userId))) {
    return NextResponse.json({ error: "The assistant isn't available on this account." }, { status: 403 });
  }
  const token = await rotateShortcutToken(session.userId);
  return NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  await clearShortcutToken(session.userId);
  return NextResponse.json({ success: true });
}
