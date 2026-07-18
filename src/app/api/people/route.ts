import { NextResponse } from "next/server";
import { db, listPeople } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json(await listPeople(session.userId));
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const name = String(body.name ?? "").trim();
  const amount = Number(body.amount);
  const note = String(body.note ?? "").trim();

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
  }

  const c = await db();
  const personId = randomUUID();
  const now = new Date().toISOString();
  await c.batch(
    [
      {
        sql: "INSERT INTO people (id, name, created_at, user_id) VALUES (?, ?, ?, ?)",
        args: [personId, name, now, session.userId],
      },
      {
        sql: "INSERT INTO transactions (id, person_id, amount, note, created_at) VALUES (?, ?, ?, ?, ?)",
        args: [randomUUID(), personId, amount, note || "Initial loan", now],
      },
    ],
    "write"
  );
  return NextResponse.json({ id: personId }, { status: 201 });
}
