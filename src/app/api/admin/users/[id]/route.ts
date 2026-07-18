import { NextResponse } from "next/server";
import { deleteUser, findUserById } from "@/lib/db";
import { getSession } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

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

  await deleteUser(id);
  return NextResponse.json({ ok: true });
}
