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
  const date = String(body.date ?? "").trim();
  const logo_url = String(body.logo_url ?? "").trim() || undefined;

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Date is required" }, { status: 400 });
  }

  await ensureTablesExist();
  const subscription = await createSubscription(session.userId, name, amount, date, logo_url);
  return NextResponse.json(subscription, { status: 201 });
}
