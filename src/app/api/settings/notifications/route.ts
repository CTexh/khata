import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById, updateUserNotificationSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const user = await findUserById(session.userId);
  return NextResponse.json({ phone: user?.phone ?? "" });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const phone = String(body.phone ?? "").trim();

  await updateUserNotificationSettings(session.userId, phone);
  return NextResponse.json({ success: true });
}
