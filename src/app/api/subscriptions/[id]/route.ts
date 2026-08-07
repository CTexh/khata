import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, deleteSubscription } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  // Verify subscription belongs to user
  const c = await db();
  const rs = await c.execute({
    sql: "SELECT * FROM subscriptions WHERE id = ? AND user_id = ?",
    args: [id, session.userId],
  });

  if (rs.rows.length === 0) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }

  const r = rs.rows[0];
  const name = String(body.name ?? r.name).trim();
  const amount = Number(body.amount ?? r.amount);
  const due_day = Number(body.due_day ?? r.due_day);
  const logo_url = body.logo_url ?? r.logo_url;

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
  }
  if (!Number.isFinite(due_day) || due_day < 1 || due_day > 31) {
    return NextResponse.json({ error: "Due day must be between 1 and 31" }, { status: 400 });
  }

  await c.execute({
    sql: "UPDATE subscriptions SET name = ?, amount = ?, due_day = ?, logo_url = ? WHERE id = ?",
    args: [name, amount, due_day, logo_url, id],
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;

  await deleteSubscription(id, session.userId);
  return NextResponse.json({ success: true });
}
