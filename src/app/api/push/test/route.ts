import { NextResponse, after } from "next/server";
import { getSession } from "@/lib/auth";
import { sendPush } from "@/lib/push";
import { sampleMessages } from "@/lib/reminder-messages";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Long enough to put the phone down and lock it before the first one lands.
const FIRST_AFTER_MS = 6_000;
const BETWEEN_MS = 4_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Sends samples to the devices this account has registered - its own devices
// only - so a phone can be checked without waiting for 6pm. `all` sends one of every reminder, each
// built by the same code the scheduled job uses - a sample can't look
// different from the real thing.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const all = body?.all === true;

  if (!all) {
    const delivered = await sendPush(session.userId, {
      // The phone already shows the app's name and icon, so the title is the
      // message itself - never "Khata".
      title: "Notifications are on",
      body: "Reminders will arrive here, like this one.",
      url: "/",
      tag: "khata-test",
    });
    return NextResponse.json({ delivered, samples: 1 });
  }

  const samples = sampleMessages();
  // Spaced out and sent after the response, so they arrive on the lock screen
  // one at a time rather than as a single stack the moment the button is
  // tapped.
  after(async () => {
    await sleep(FIRST_AFTER_MS);
    for (const [i, message] of samples.entries()) {
      if (i) await sleep(BETWEEN_MS);
      try {
        await sendPush(session.userId, message);
      } catch (err) {
        console.error(JSON.stringify({ evt: "push_sample", error: (err as Error).message.slice(0, 200) }));
      }
    }
  });

  return NextResponse.json({
    samples: samples.length,
    startsInMs: FIRST_AFTER_MS,
    everyMs: BETWEEN_MS,
  });
}
