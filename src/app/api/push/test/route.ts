import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { notify } from "@/lib/notify";

export const dynamic = "force-dynamic";

// One notification to the devices this account has just registered, so
// switching notifications on proves itself instead of leaving the user to
// wonder until the next reminder is due. Scoped to the caller's own devices.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  await notify(
    session.userId,
    {
      // The phone already shows the app's name and icon, so the title is the
      // message itself - never "Khata".
      title: "Notifications are on",
      body: "Reminders will arrive here, like this one.",
      url: "/",
      tag: "khata-test",
    },
    { validForMinutes: 60 }
  );
  return NextResponse.json({ ok: true });
}
