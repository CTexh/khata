// Pure pieces of the inbound WhatsApp webhook: authenticating Meta's request,
// pulling messages out of its payload, and matching a sender to an account.
// Nothing here touches the database or the network, so all of it is covered
// by scripts/test-whatsapp.ts.
import { createHmac, timingSafeEqual } from "node:crypto";

// Meta signs every webhook POST with the app secret. Checking it is what lets
// this route skip the session check: without it, anyone who found the URL
// could post "expenses" into an account.
export function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const given = header.slice("sha256=".length);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, "utf8"), Buffer.from(expected, "utf8"));
}

// Profile numbers are typed free-hand ("0300 1234567", "+92-300-1234567"),
// while WhatsApp sends the sender as bare international digits
// ("923001234567"). Both sides go through this before they are compared.
// Local Pakistani numbers are assumed, since that is where the app is used.
export function normalizePhone(raw: string | null | undefined): string | null {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = "92" + digits.slice(1);
  if (digits.length === 10 && digits.startsWith("3")) digits = "92" + digits;
  return digits.length >= 10 ? digits : null;
}

export type InboundMessage = {
  id: string;
  from: string;
  type: string;
  text: string;
  imageId: string | null;
};

// Meta batches: one POST can carry several entries, changes and messages, and
// also delivery-status updates that carry no message at all. Anything without
// an id and a sender is skipped rather than guessed at.
export function extractMessages(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const messages = (change as { value?: { messages?: unknown[] } })?.value?.messages;
      if (!Array.isArray(messages)) continue;
      for (const m of messages as Record<string, any>[]) {
        if (typeof m?.id !== "string" || typeof m?.from !== "string") continue;
        const type = typeof m.type === "string" ? m.type : "unknown";
        out.push({
          id: m.id,
          from: m.from,
          type,
          text: String(
            type === "text" ? m.text?.body ?? "" : type === "image" ? m.image?.caption ?? "" : ""
          ).trim(),
          imageId: type === "image" && typeof m.image?.id === "string" ? m.image.id : null,
        });
      }
    }
  }
  return out;
}

export type Command = "undo" | "help";

// Only a message that is the command and nothing else counts, so "undo the
// fuel 3000 one" or "help with rent 5000" still go through as expenses.
export function detectCommand(text: string): Command | null {
  const raw = text.trim().toLowerCase();
  if (raw === "?") return "help";
  const t = raw.replace(/[.!?]+$/, "");
  if (t === "undo") return "undo";
  if (t === "help") return "help";
  return null;
}
