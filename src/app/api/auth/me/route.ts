import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById, userHasAi } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null });
  const [record, aiAccess] = await Promise.all([findUserById(session.userId), userHasAi(session.userId)]);
  return NextResponse.json({
    user: {
      id: session.userId,
      username: session.username,
      name: record?.name ?? null,
      isAdmin: session.isAdmin,
      aiAccess,
      createdAt: record?.created_at ?? null,
    },
  });
}
