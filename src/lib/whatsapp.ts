// Sends via Meta's official WhatsApp Cloud API. A reminder is a
// business-initiated message (not a reply inside a live 24-hour customer
// conversation window), so it MUST go through a pre-approved message
// template - a free-form text message would be rejected outside that
// window. This expects a template named "subscription_due_reminder",
// category Utility, approved in WhatsApp Manager, with a static header
// ("Subscription Reminder from Chattha Technologies") and body:
//   "Hi! This is a reminder that your {{sub_name}} subscription payment of
//   {{amount}} is due {{due_when}}. Please make sure you have funds ready
//   to avoid any interruption."
// Meta's newer templates require named (not positional {{1}}/{{2}}) body
// variables, sent via `parameter_name` matching the template exactly.
//
// Needs WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN set - one shared
// sending number + permanent access token for the whole app, not per-user.
export type WhatsAppSendResult = { ok: boolean; error?: string };

async function sendTemplate(
  phone: string,
  templateName: string,
  languageCode: string,
  components: unknown[]
): Promise<WhatsAppSendResult> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    return { ok: false, error: "WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN not set" };
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone.replace(/[^\d]/g, ""), // Meta expects digits only, no "+"
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    }),
  });

  if (res.ok) return { ok: true };

  // Surface Meta's actual error (invalid token, unapproved template, phone
  // not registered, etc.) instead of a generic failure - this is what
  // /api/settings/notifications/test returns to the Settings page.
  const body = await res.text();
  let error = body;
  try {
    const parsed = JSON.parse(body);
    error = parsed?.error?.message ?? body;
  } catch {
    // Not JSON - use the raw body as-is.
  }
  return { ok: false, error };
}

export async function sendWhatsAppReminder(
  phone: string,
  subscriptionName: string,
  amount: string,
  when: "today" | "tomorrow"
): Promise<WhatsAppSendResult> {
  return sendTemplate(phone, "subscription_due_reminder", "en_US", [
    {
      type: "body",
      parameters: [
        { type: "text", parameter_name: "sub_name", text: subscriptionName },
        { type: "text", parameter_name: "amount", text: amount },
        { type: "text", parameter_name: "due_when", text: when },
      ],
    },
  ]);
}
