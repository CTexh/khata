import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getProfileSettings, updateUserProfile, type NotificationPrefs } from "@/lib/db";
import { pushConfigured } from "@/lib/push";

export const dynamic = "force-dynamic";

const KINDS = ["subscriptions", "udhar", "dailyRecap", "monthlySummary"] as const;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const settings = await getProfileSettings(session.userId);
  return NextResponse.json({
    name: settings?.name ?? "",
    prefs: settings?.prefs ?? { subscriptions: true, udhar: true, dailyRecap: true, monthlySummary: true },
    // Whether this deployment can send notifications at all.
    notificationsAvailable: pushConfigured(),
  });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const fields: { name?: string; prefs?: Partial<NotificationPrefs> } = {};
  if (body.name !== undefined) fields.name = String(body.name).trim().slice(0, 80);
  // Which kinds of reminder to notify about; anything not sent stays as it was.
  if (body.prefs && typeof body.prefs === "object") {
    const prefs: Partial<NotificationPrefs> = {};
    for (const kind of KINDS) {
      if (body.prefs[kind] !== undefined) prefs[kind] = Boolean(body.prefs[kind]);
    }
    if (Object.keys(prefs).length) fields.prefs = prefs;
  }

  await updateUserProfile(session.userId, fields);
  return NextResponse.json({ success: true });
}
