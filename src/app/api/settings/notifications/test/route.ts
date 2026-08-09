import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sendWhatsAppReminder, sendWhatsAppMonthlyReport } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// Sends a one-off test message using whatever phone number is currently
// typed into the Settings form - lets the user confirm a WhatsApp template
// delivers before saving, without waiting for the cron to run for real.
// `type` picks which template: "subscription" (default) or "monthly_report".
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const phone = String(body.phone ?? "").trim();
  const type = String(body.type ?? "subscription");

  if (!phone) {
    return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
  }

  const result =
    type === "monthly_report"
      ? await sendWhatsAppMonthlyReport(phone, "Test Month", "Rs 0")
      : await sendWhatsAppReminder(phone, "Test Subscription", "Rs 0", "today");

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Couldn't send" }, { status: 502 });
  }
  return NextResponse.json({ success: true });
}
