import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/auth";
import { claimInboundMessage } from "@/lib/db";
import { runAssistant } from "@/lib/assistant";

export const dynamic = "force-dynamic";
// Reading a bill photo can take several seconds, and the model fallbacks are
// bounded to fit inside this.
export const maxDuration = 60;

const MAX_TEXT = 1000;
// The page shrinks photos to around 1600px before uploading, so a real bill
// photo arrives far below this; anything larger wasn't sent by the page.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// A minute of 16 kHz mono WAV, the format the page records in, is about 1.9 MB.
const MAX_AUDIO_BYTES = 2.5 * 1024 * 1024;

// The in-app assistant. Same engine as WhatsApp, reached with the normal
// login session instead of a phone number.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please log in again." }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Couldn't read that message. Please try again." }, { status: 400 });
  }

  const text = String(form.get("text") ?? "").trim().slice(0, MAX_TEXT);
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

  // Recorded like a WhatsApp message, so anything it saves can be undone.
  const messageId = `app-${randomUUID()}`;
  await claimInboundMessage(messageId, session.userId);
  const { reply, log } = await runAssistant({
    userId: session.userId,
    messageId,
    channel: "app",
    text,
    image,
    audio,
  });
  return NextResponse.json({ reply: reply ?? "", outcome: log.outcome });
}
