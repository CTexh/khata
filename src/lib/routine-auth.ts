import { NextResponse } from "next/server";
import { findUserByUsername } from "@/lib/db";
import { verifyRoutineSecret } from "@/lib/auth";

// The email routine has no session. It proves itself with x-routine-secret
// and always acts as the "walli" account - exactly as /api/expenses has
// always treated it. These endpoints accept nothing else: a logged-in user has
// no business calling them.
export async function routineUserId(req: Request): Promise<string | NextResponse> {
  if (!verifyRoutineSecret(req.headers.get("x-routine-secret"))) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const user = await findUserByUsername("walli");
  if (!user) return NextResponse.json({ error: "Admin user not found" }, { status: 500 });
  return user.id;
}
