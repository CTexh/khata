import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getProfileSettings } from "@/lib/db";
import { mailConfigured, sendMail } from "@/lib/mailer";

export const dynamic = "force-dynamic";

// Sends a short email to the address saved in the user's profile, so they can
// see reminders will reach them.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!mailConfigured()) {
    return NextResponse.json({ error: "Email reminders aren't set up on the server yet." }, { status: 503 });
  }
  const settings = await getProfileSettings(session.userId);
  if (!settings?.email) {
    return NextResponse.json({ error: "Save your email address first." }, { status: 400 });
  }
  try {
    await sendMail({
      to: settings.email,
      subject: "Khata: reminders are on",
      text: "This is a test from Khata. Reminders for subscriptions, Udhar reach-out dates and your monthly summary will arrive at this address around 9am.",
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;padding:24px;color:#0b0d14"><p style="font-size:17px;font-weight:700;margin:0 0 8px">Reminders are on</p><p style="font-size:15px;margin:0">Reminders for subscriptions, Udhar reach-out dates and your monthly summary will arrive at this address around 9am.</p></div>`,
    });
  } catch (err) {
    console.error(JSON.stringify({ evt: "test_email", error: (err as Error).message.slice(0, 200) }));
    return NextResponse.json({ error: "Couldn't send the email. Please try again later." }, { status: 502 });
  }
  return NextResponse.json({ sent: true, to: settings.email });
}
