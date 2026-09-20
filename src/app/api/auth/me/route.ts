import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAccountFlags } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null });
  // One row answers all of it: the name, assistant access and whether Trips
  // is switched on.
  const account = await getAccountFlags(session.userId);
  return NextResponse.json({
    user: {
      id: session.userId,
      username: session.username,
      name: account?.name ?? null,
      isAdmin: session.isAdmin,
      aiAccess: Boolean(account?.aiAccess),
      tripsEnabled: Boolean(account?.tripsEnabled),
      createdAt: account?.createdAt ?? null,
    },
  });
}
