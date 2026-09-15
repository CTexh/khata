import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteAssistantFeedback, listAssistantFeedback } from "@/lib/db";

export const dynamic = "force-dynamic";

// Suggestions given to the assistant and messages it couldn't handle.
export async function GET() {
  const session = await getSession();
  if (!session?.isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  return NextResponse.json(await listAssistantFeedback());
}

// ?id=<id> removes one item; without it, everything is cleared.
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") ?? undefined;
  await deleteAssistantFeedback(id);
  return NextResponse.json({ ok: true });
}
