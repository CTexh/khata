import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getProfileSettings, updateUserProfile } from "@/lib/db";
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
    emailAvailable: mailConfigured(),
  });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const fields: { name?: string; email?: string | null; emailReminders?: boolean } = {};
  if (body.name !== undefined) fields.name = String(body.name).trim().slice(0, 80);
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (email && !validEmail(email)) {
      return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
    }
    fields.email = email || null;
  }
  if (body.emailReminders !== undefined) fields.emailReminders = Boolean(body.emailReminders);

  await updateUserProfile(session.userId, fields);
  return NextResponse.json({ success: true });
}
