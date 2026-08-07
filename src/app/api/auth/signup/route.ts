import { NextResponse } from "next/server";
import { db, ensureUserNameColumn, findUserByUsername } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";
import { randomUUID } from "crypto";

export async function POST(req: Request) {
  const body = await req.json();
  const username = String(body.username ?? "").trim();
  const name = String(body.name ?? "").trim();
  const password = String(body.password ?? "");

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

  const existing = await findUserByUsername(username);
  if (existing) {
    return NextResponse.json({ error: "That username is taken" }, { status: 409 });
  }

  await ensureUserNameColumn();

  const c = await db();
  const id = randomUUID();
  await c.execute({
    sql: "INSERT INTO users (id, username, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, 0, ?)",
    args: [id, username, name, hashPassword(password), new Date().toISOString()],
  });

  await createSession({ id, username, is_admin: false });
  return NextResponse.json({ id, username, name, isAdmin: false }, { status: 201 });
}
