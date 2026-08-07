import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  listSubscriptions,
  createSubscription,
  ensureTablesExist,
} from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  await ensureTablesExist();
  const subscriptions = await listSubscriptions(session.userId);
  return NextResponse.json(subscriptions);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const name = String(body.name ?? "").trim();
  const amount = Number(body.amount);
  const due_day = Number(body.due_day);
  const logo_url = String(body.logo_url ?? "").trim() || undefined;

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
  }
  if (!Number.isFinite(due_day) || due_day < 1 || due_day > 31) {
    return NextResponse.json({ error: "Due day must be between 1 and 31" }, { status: 400 });
  }

  await ensureTablesExist();
  const subscription = await createSubscription(session.userId, name, amount, due_day, logo_url);
  return NextResponse.json(subscription, { status: 201 });
}
