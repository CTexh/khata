import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sendHelloWorldTest } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// Sends a one-off test reminder using whatever phone number is currently
// typed into the Settings form - lets the user confirm the WhatsApp
// template delivers before saving, without waiting for tomorrow's cron run.
//
// TEMPORARY: using sendHelloWorldTest (Meta's stock template) instead of
// sendWhatsAppReminder while diagnosing why our own template fails - swap
// back once resolved.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const phone = String(body.phone ?? "").trim();

  if (!phone) {
    return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
  }

  const result = await sendHelloWorldTest(phone);

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Couldn't send" }, { status: 502 });
  }
  return NextResponse.json({ success: true });
}
