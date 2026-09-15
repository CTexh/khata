import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getProfileSettings, updateUserProfile, type EmailPrefs } from "@/lib/db";
import { mailConfigured } from "@/lib/mailer";
import { validEmail } from "@/lib/reminders";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const settings = await getProfileSettings(session.userId);
  return NextResponse.json({
    name: settings?.name ?? "",
    email: settings?.email ?? "",
    emailReminders: settings?.emailReminders ?? true,
    prefs: settings?.prefs ?? { subscriptions: true, udhar: true, dailyRecap: true, monthlySummary: true },
    emailAvailable: mailConfigured(),
  });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const fields: {
    name?: string;
    email?: string | null;
    emailReminders?: boolean;
    prefs?: Partial<EmailPrefs>;
  } = {};
  if (body.name !== undefined) fields.name = String(body.name).trim().slice(0, 80);
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (email && !validEmail(email)) {
      return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
    }
    fields.email = email || null;
  }
  if (body.emailReminders !== undefined) fields.emailReminders = Boolean(body.emailReminders);
  // Which kinds of email to send; anything not sent stays as it was.
  if (body.prefs && typeof body.prefs === "object") {
    const prefs: Partial<EmailPrefs> = {};
    for (const key of ["subscriptions", "udhar", "dailyRecap", "monthlySummary"] as const) {
      if (body.prefs[key] !== undefined) prefs[key] = Boolean(body.prefs[key]);
    }
    if (Object.keys(prefs).length) fields.prefs = prefs;
  }

  await updateUserProfile(session.userId, fields);
  return NextResponse.json({ success: true });
}
