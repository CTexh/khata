import { NextResponse } from "next/server";
import { db, listTx, personBelongsToUser } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  if (!(await personBelongsToUser(id, session.userId))) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }
  return NextResponse.json(await listTx(id));
}

// Add a transaction: positive amount = lent more, negative = payment received
export async function POST(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const amount = Number(body.amount);
  const note = String(body.note ?? "").trim();

  if (!Number.isFinite(amount) || amount === 0) {
    return NextResponse.json({ error: "Amount must be a non-zero number" }, { status: 400 });
  }
  if (!(await personBelongsToUser(id, session.userId))) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  const c = await db();
  await c.execute({
    sql: "INSERT INTO transactions (id, person_id, amount, note, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [randomUUID(), id, amount, note, new Date().toISOString()],
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  if (!(await personBelongsToUser(id, session.userId))) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  const c = await db();
  await c.batch(
    [
      { sql: "DELETE FROM transactions WHERE person_id = ?", args: [id] },
      { sql: "DELETE FROM people WHERE id = ?", args: [id] },
    ],
    "write"
  );
  return NextResponse.json({ ok: true });
}
