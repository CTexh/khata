import { NextResponse } from "next/server";
import { db, ensureUserEmailColumns, findUserByUsername, listUsers } from "@/lib/db";
import { validEmail } from "@/lib/reminders";
import { getSession, hashPassword } from "@/lib/auth";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return NextResponse.json(await listUsers());
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await req.json();
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim().slice(0, 80);

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return NextResponse.json(
      { error: "Username must be 3-20 characters (letters, numbers, underscore)" },
      { status: 400 }
    );
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }

  if (email && !validEmail(email)) {
    return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
  }

  const existing = await findUserByUsername(username);
  if (existing) {
    return NextResponse.json({ error: "That username is taken" }, { status: 409 });
  }

  await ensureUserEmailColumns();
  const c = await db();
  const id = randomUUID();
  await c.execute({
    sql: "INSERT INTO users (id, username, name, email, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
    args: [id, username, name || null, email || null, hashPassword(password), new Date().toISOString()],
  });

  return NextResponse.json({ id, username }, { status: 201 });
}
