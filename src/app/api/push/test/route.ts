import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sendPush } from "@/lib/push";

export const dynamic = "force-dynamic";

// Sends one notification to the devices this account has registered, so the
// phone can be checked without waiting for 6pm. Admin only, like the switch
// itself.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!session.isAdmin) return NextResponse.json({ error: "Not available on this account." }, { status: 403 });

  const delivered = await sendPush(session.userId, {
    // The phone already shows the app's name and icon, so the title is the
    // message itself - never "Khata".
    title: "Notifications are on",
    body: "Reminders will arrive here, like this one.",
    url: "/",
    tag: "khata-test",
  });
  return NextResponse.json({ delivered });
}
