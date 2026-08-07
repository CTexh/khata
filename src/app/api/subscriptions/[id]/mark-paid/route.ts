import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, markSubscriptionPaid } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;

  // Verify subscription belongs to user
  const c = await db();
  const rs = await c.execute({
    sql: "SELECT id FROM subscriptions WHERE id = ? AND user_id = ?",
    args: [id, session.userId],
  });

  if (rs.rows.length === 0) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }

  await markSubscriptionPaid(id, session.userId);
  return NextResponse.json({ success: true });
}
