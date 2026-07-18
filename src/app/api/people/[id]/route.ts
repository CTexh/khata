import { NextResponse } from "next/server";
import { db, listTx } from "@/lib/db";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  return NextResponse.json(await listTx(id));
}

// Add a transaction: positive amount = lent more, negative = payment received
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const amount = Number(body.amount);
  const note = String(body.note ?? "").trim();

  if (!Number.isFinite(amount) || amount === 0) {
    return NextResponse.json({ error: "Amount must be a non-zero number" }, { status: 400 });
  }

  const c = await db();
  const person = await c.execute({ sql: "SELECT id FROM people WHERE id = ?", args: [id] });
  if (person.rows.length === 0) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  await c.execute({
    sql: "INSERT INTO transactions (id, person_id, amount, note, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [randomUUID(), id, amount, note, new Date().toISOString()],
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
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
