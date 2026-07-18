import { NextResponse } from "next/server";
import { findUserByUsername } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";

export async function POST(req: Request) {
  const body = await req.json();
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");

  const user = await findUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  await createSession(user);
  return NextResponse.json({ id: user.id, username: user.username, isAdmin: user.is_admin });
}
