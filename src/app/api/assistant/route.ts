import { NextResponse, after } from "next/server";
import { getSession } from "@/lib/auth";
import { claimInboundMessage, getInboundReply, saveInboundReply } from "@/lib/db";
import { runAssistant } from "@/lib/assistant";
import { sanitizeHistory, type ChatTurn } from "@/lib/assistant-actions";

export const dynamic = "force-dynamic";
// Bounds the work scheduled with after(): reading a bill photo or voice note
// can take a while, and the model fallbacks are budgeted to fit inside this.
export const maxDuration = 60;

const MAX_TEXT = 1000;
// The page shrinks photos to around 1600px before uploading, so a real bill
// photo arrives far below this; anything larger wasn't sent by the page.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// A minute of 16 kHz mono WAV, the format the page records in, is about 1.9 MB.
const MAX_AUDIO_BYTES = 2.5 * 1024 * 1024;
// Chosen by the page, so a retry after a dropped connection is recognised.
const INLINE_WAIT_MS = 9_000;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function status(requestId: string, reply: string | null) {
  return { id: requestId, status: reply === null ? "pending" : "done", reply };
}

// The in-app assistant, reached with the normal login
// session. The message is accepted straight away and worked on after the
// response: a slow model used to keep the phone's request open long enough
// for the connection to drop, so the page showed an error even though the
// expense had been saved. The page now fetches the reply with GET.
// The AI assistant is for admin accounts only; everyone else uses the app
// without it. Checked here, not just hidden in the page, so it can't be
// reached by calling the API directly.
const NOT_AVAILABLE = { error: "The assistant isn't available on this account." };

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please log in again." }, { status: 401 });
  if (!session.isAdmin) return NextResponse.json(NOT_AVAILABLE, { status: 403 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Couldn't read that message. Please try again." }, { status: 400 });
  }

  const requestId = String(form.get("id") ?? "");
  if (!REQUEST_ID.test(requestId)) {
    return NextResponse.json({ error: "Please refresh the page and try again." }, { status: 400 });
  }

  const text = String(form.get("text") ?? "").trim().slice(0, MAX_TEXT);

  // Recent turns from the page, so a follow-up like "change it to 2500" has
  // something to refer to.
  let history: ChatTurn[] = [];
  try {
    history = sanitizeHistory(JSON.parse(String(form.get("history") ?? "[]")));
  } catch {
    // Unreadable history: the message is answered on its own.
  }

  const file = form.get("image");
  let image: { data: string; mimeType: string } | null = null;
  if (file instanceof File && file.size > 0) {
    if (!IMAGE_TYPES.has(file.type)) {
      return NextResponse.json({ error: "Photos need to be JPEG, PNG or WebP." }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "That photo is too large. Try a screenshot instead." }, { status: 413 });
    }
    image = { data: Buffer.from(await file.arrayBuffer()).toString("base64"), mimeType: file.type };
  }

  const voice = form.get("audio");
  let audio: { data: string; mimeType: string } | null = null;
  if (voice instanceof File && voice.size > 0) {
    // The page converts recordings to WAV, one of the audio formats Gemini
    // documents; browsers' own WebM and MP4 recordings aren't on that list.
    if (voice.type !== "audio/wav") {
      return NextResponse.json({ error: "Voice notes need to be recorded in the app." }, { status: 400 });
    }
    if (voice.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: "That voice note is too long. Keep it under a minute." }, { status: 413 });
    }
    audio = { data: Buffer.from(await voice.arrayBuffer()).toString("base64"), mimeType: "audio/wav" };
  }

  if (!text && !image && !audio) {
    return NextResponse.json({ error: "Type a message, record a voice note, or attach a photo." }, { status: 400 });
  }

  const userId = session.userId;
  const messageId = `app-${requestId}`;
  // A retry of a message that already arrived: report on the original rather
  // than saving it twice. Recording it also ties saved entries to it for UNDO.
  if (!(await claimInboundMessage(messageId, userId))) {
    const existing = await getInboundReply(messageId, userId);
    if (!existing) return NextResponse.json({ error: "Please refresh the page and try again." }, { status: 409 });
    return NextResponse.json(status(requestId, existing.reply));
  }

  const work = (async (): Promise<string | null> => {
    try {
      const { reply } = await runAssistant({ userId, messageId, text, image, audio, history });
      const final = reply || "Done.";
      await saveInboundReply(messageId, final);
      return final;
    } catch (err) {
      console.error(JSON.stringify({ evt: "assistant", msg: requestId.slice(-8), outcome: "reply_not_saved", error: (err as Error).message.slice(0, 300) }));
      return null;
    }
  })();
  // Keeps the function alive until the work is saved, however long it takes.
  after(() => work);

  // Most messages are answered in a couple of seconds, so the reply is sent
  // straight back when it's ready quickly. Only a slow one falls back to the
  // page fetching it, which keeps a phone from holding a long request open.
  const quick = await Promise.race([work, new Promise<null>((r) => setTimeout(() => r(null), INLINE_WAIT_MS))]);
  if (quick !== null) return NextResponse.json(status(requestId, quick));
  return NextResponse.json(status(requestId, null), { status: 202 });
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please log in again." }, { status: 401 });
  if (!session.isAdmin) return NextResponse.json(NOT_AVAILABLE, { status: 403 });

  const requestId = new URL(req.url).searchParams.get("id") ?? "";
  if (!REQUEST_ID.test(requestId)) {
    return NextResponse.json({ error: "Please refresh the page and try again." }, { status: 400 });
  }
  const row = await getInboundReply(`app-${requestId}`, session.userId);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(status(requestId, row.reply), { headers: { "Cache-Control": "no-store" } });
}
