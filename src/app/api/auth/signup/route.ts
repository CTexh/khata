import { NextResponse } from "next/server";
import { db, ensureUserEmailColumns, findUserByUsername } from "@/lib/db";
import { validEmail } from "@/lib/reminders";
import { createSession, hashPassword } from "@/lib/auth";
import { randomUUID } from "crypto";

export async function POST(req: Request) {
  const body = await req.json();
  const username = String(body.username ?? "").trim();
  const name = String(body.name ?? "").trim();
  const password = String(body.password ?? "");
  const email = String(body.email ?? "").trim().toLowerCase();

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
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
    args: [id, username, name, email || null, hashPassword(password), new Date().toISOString()],
  });

  await createSession({ id, username, is_admin: false });
  return NextResponse.json({ id, username, name, isAdmin: false }, { status: 201 });
}
