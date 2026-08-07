import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null });
  const record = await findUserById(session.userId);
  return NextResponse.json({
    user: {
      id: session.userId,
      username: session.username,
      name: record?.name ?? null,
      isAdmin: session.isAdmin,
    },
  });
}
