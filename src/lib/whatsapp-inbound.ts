// The WhatsApp side of the Khata assistant: find whose number a message came
// from, fetch any photo, hand the message to runAssistant(), and send the reply
// back on WhatsApp. Runs after the webhook has already answered Meta, so
// nothing here can make Meta retry.
import { runAssistant } from "@/lib/assistant";
import { claimInboundMessage, findUserIdByPhone } from "@/lib/db";
import { downloadWhatsAppMedia, sendWhatsAppText } from "@/lib/whatsapp";
import { extractMessages } from "@/lib/whatsapp-webhook";
import { ERROR_REPLY, UNSUPPORTED_REPLY } from "@/lib/whatsapp-replies";

export async function handleInbound(payload: unknown): Promise<void> {
  for (const message of extractMessages(payload)) {
    const msg = message.id.slice(-8);
    let userId: string | null = null;
    try {
      // Numbers that aren't on any profile get no reply at all: answering would
      // confirm to a stranger that the number is wired to someone's finances.
      userId = await findUserIdByPhone(message.from);
      if (!userId) {
        console.log(JSON.stringify({ evt: "whatsapp", msg, outcome: "ignored_unregistered" }));
        continue;
      }
      if (!(await claimInboundMessage(message.id, userId))) {
        console.log(JSON.stringify({ evt: "whatsapp", msg, outcome: "duplicate" }));
        continue;
      }
      if (message.type !== "text" && message.type !== "image") {
        await send(message.from, UNSUPPORTED_REPLY);
        continue;
      }
      if (message.type === "text" && !message.text) continue;

      const image = message.imageId ? await downloadWhatsAppMedia(message.imageId) : null;
      const { reply } = await runAssistant({
        userId,
        messageId: message.id,
        channel: "whatsapp",
        text: message.text,
        image,
        audio: null, // WhatsApp voice notes aren't handled
      });
      if (reply) await send(message.from, reply);
    } catch (err) {
      console.error(
        JSON.stringify({ evt: "whatsapp", msg, outcome: "error", error: (err as Error).message.slice(0, 300) })
      );
      if (userId) await send(message.from, ERROR_REPLY);
    }
  }
}

async function send(to: string, body: string): Promise<void> {
  const res = await sendWhatsAppText(to, body);
  if (!res.ok) console.error("[whatsapp] reply failed:", res.error);
}
