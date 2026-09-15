import { NextResponse } from "next/server";
import { clearLoginFailures, findUserByUsername, loginLocked, recordLoginFailure } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Checked against when the username doesn't exist, so a wrong username takes
// as long as a wrong password and can't be told apart by timing.
const DUMMY_HASH = "00000000000000000000000000000000:" + "0".repeat(128);

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const username = String(body.username ?? "").trim().slice(0, 40);
  const password = String(body.password ?? "").slice(0, 200);
  if (!username || !password) {
    return NextResponse.json({ error: "Enter your username and password" }, { status: 400 });
  }

  // Too many wrong passwords for this account recently: wait before trying again.
  if (await loginLocked(username)) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait 15 minutes and try again." },
      { status: 429 }
    );
  }

  const user = await findUserByUsername(username);
  const valid = verifyPassword(password, user?.password_hash ?? DUMMY_HASH) && Boolean(user);
  if (!user || !valid) {
    await recordLoginFailure(username);
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  await clearLoginFailures(username);
  await createSession(user);
  return NextResponse.json({ id: user.id, username: user.username, isAdmin: user.is_admin });
}
