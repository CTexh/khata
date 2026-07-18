import { NextResponse } from "next/server";
import { db, deleteUser, findUserById } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const { id } = await params;
  const target = await findUserById(id);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (target.is_admin) {
    return NextResponse.json(
      { error: "The admin account's password is set via environment variables" },
      { status: 400 }
    );
  }

  const body = await req.json();
  const password = String(body.password ?? "");
  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }

  const c = await db();
  await c.execute({
    sql: "UPDATE users SET password_hash = ? WHERE id = ?",
    args: [hashPassword(password), id],
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const { id } = await params;
  if (id === session.userId) {
    return NextResponse.json({ error: "You can't delete your own account" }, { status: 400 });
  }
  const target = await findUserById(id);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (target.is_admin) {
    return NextResponse.json({ error: "The admin account can't be deleted" }, { status: 400 });
  }

  await deleteUser(id);
  return NextResponse.json({ ok: true });
}
