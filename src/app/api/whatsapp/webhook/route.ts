import { after } from "next/server";
import { handleInbound } from "@/lib/whatsapp-inbound";
import { verifySignature } from "@/lib/whatsapp-webhook";

export const dynamic = "force-dynamic";
// Reading a receipt photo can take several seconds; this bounds the work
// scheduled with after(), not the response to Meta, which is immediate.
export const maxDuration = 60;

// Meta calls this once when the webhook URL is saved in the app dashboard,
// and only accepts the URL if the challenge is echoed back.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (
    expected &&
    params.get("hub.mode") === "subscribe" &&
    params.get("hub.verify_token") === expected
  ) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    console.error("[whatsapp] WHATSAPP_APP_SECRET is not set; rejecting webhook");
    return new Response("Not configured", { status: 500 });
  }

  // The signature covers the exact bytes Meta sent, so it is checked against
  // the raw body before anything parses it.
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  // Meta treats a slow answer as a failure and redelivers the same message.
  // Answering first and processing afterwards avoids that; duplicates that
  // still arrive are dropped by the message-id check.
  after(() => handleInbound(payload));
  return new Response("ok", { status: 200 });
}
