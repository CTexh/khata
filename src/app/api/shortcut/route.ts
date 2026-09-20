import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { claimInboundMessage, findUserByShortcutToken, saveInboundReply, userHasAi } from "@/lib/db";
import { runAssistant } from "@/lib/assistant";
import { speakable } from "@/lib/speakable";

export const dynamic = "force-dynamic";
// The same budget as the in-app assistant: a slow model still has room to
// answer before Shortcuts gives up.
export const maxDuration = 60;

const MAX_TEXT = 1000;

// The way an Apple Shortcut - and so Siri - talks to the assistant.
//
// The phone has no login session, so the Shortcut sends the token from
// Settings > Siri & Shortcuts instead: `Authorization: Bearer <token>`. The
// reply comes back as one short line of text for the Shortcut to speak, which
// is why this waits for the answer rather than handing back a job to poll for,
// as the app's own assistant does.
// `reply` is what Siri reads out; `detail` is the same answer as the app
// writes it, for a Shortcut that would rather show it than speak it.
function spoken(reply: string, heard: string | null, status = 200) {
  return NextResponse.json(
    { reply: speakable(reply), detail: reply, heard },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function tokenFrom(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  // Shortcuts makes a plain header easy to get wrong; accept the obvious
  // alternative rather than answering "not authorised" to a typo.
  return (req.headers.get("x-khata-token") ?? "").trim();
}

async function textFrom(req: Request): Promise<string> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    return String(body.text ?? body.query ?? body.message ?? "");
  }
  const form = await req.formData().catch(() => null);
  return String(form?.get("text") ?? "");
}

export async function POST(req: Request) {
  const user = await findUserByShortcutToken(tokenFrom(req));
  if (!user) {
    return spoken("That Khata shortcut isn't set up. Open Settings, then Siri & Shortcuts, and make a new token.", null, 401);
  }
  if (!(await userHasAi(user.id))) {
    return spoken("The assistant isn't available on this account.", null, 403);
  }

  const text = (await textFrom(req)).trim().slice(0, MAX_TEXT);
  if (!text) return spoken("I didn't catch that. Try again and say what you spent.", null, 400);

  const messageId = `siri-${randomUUID()}`;
  await claimInboundMessage(messageId, user.id);
  try {
    const { reply } = await runAssistant({ userId: user.id, messageId, text, image: null, audio: null, history: [] });
    const final = reply || "Done.";
    // Recorded like any other message, so UNDO in the app can reverse what was
    // just said out loud.
    await saveInboundReply(messageId, final, text);
    return spoken(final, text);
  } catch (err) {
    console.error(JSON.stringify({ evt: "shortcut", error: (err as Error).message.slice(0, 300) }));
    return spoken("Khata couldn't do that just now. Please try again.", text, 502);
  }
}
