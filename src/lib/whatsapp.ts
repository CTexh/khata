// Sends via Meta's official WhatsApp Cloud API. A reminder is a
// business-initiated message (not a reply inside a live 24-hour customer
// conversation window), so it MUST go through a pre-approved message
// template - a free-form text message would be rejected outside that
// window. This expects a template named "subscription_duedate_reminder",
// category Utility, approved in WhatsApp Manager, with a dynamic header
// ("{{sub_name}} Subscription Reminder") and body:
//   "Hi Walli! This is a reminder that your {{sub_name}} payment of
//   {{amount}} is due on {{due_when}}. Please make sure you have funds
//   ready to avoid any interruption."
// This template uses Meta's "Name" (named, not positional {{1}}/{{2}})
// variable format, sent via `parameter_name` matching the template exactly
// - and sub_name appears in both the header and body components, each of
// which needs its own parameters array.
//
// Needs WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN set - one shared
// sending number + permanent access token for the whole app, not per-user.
export type WhatsAppSendResult = { ok: boolean; error?: string };

const GRAPH = "https://graph.facebook.com/v21.0";

function credentials(): { phoneNumberId: string; accessToken: string } | null {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  return phoneNumberId && accessToken ? { phoneNumberId, accessToken } : null;
}

// Surface Meta's actual error (invalid token, unapproved template, phone
// not registered, etc.) instead of a generic failure.
async function metaError(res: Response): Promise<string> {
  const body = await res.text();
  try {
    return JSON.parse(body)?.error?.message ?? body;
  } catch {
    return body;
  }
}

async function sendMessage(phone: string, message: Record<string, unknown>): Promise<WhatsAppSendResult> {
  const creds = credentials();
  if (!creds) {
    return { ok: false, error: "WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN not set" };
  }
  const res = await fetch(`${GRAPH}/${creds.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone.replace(/[^\d]/g, ""), // Meta expects digits only, no "+"
      ...message,
    }),
  });
  return res.ok ? { ok: true } : { ok: false, error: await metaError(res) };
}

function sendTemplate(
  phone: string,
  templateName: string,
  languageCode: string,
  components: unknown[]
): Promise<WhatsAppSendResult> {
  return sendMessage(phone, {
    type: "template",
    template: { name: templateName, language: { code: languageCode }, components },
  });
}

// A plain reply. Only valid inside the 24-hour window that opens when the
// user messages the business number - which is exactly when the expense
// webhook replies, so no approved template is needed.
export function sendWhatsAppText(phone: string, body: string): Promise<WhatsAppSendResult> {
  return sendMessage(phone, { type: "text", text: { body, preview_url: false } });
}

// Largest image passed on for reading. WhatsApp compresses photos well below
// this; anything bigger is not a receipt photo.
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

// An incoming image arrives as an id, not bytes. The id resolves to a URL
// that is valid for five minutes and itself needs the access token.
export async function downloadWhatsAppMedia(
  mediaId: string
): Promise<{ data: string; mimeType: string }> {
  const creds = credentials();
  if (!creds) throw new Error("WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN not set");
  const auth = { Authorization: `Bearer ${creds.accessToken}` };

  const meta = await fetch(
    `${GRAPH}/${encodeURIComponent(mediaId)}?phone_number_id=${creds.phoneNumberId}`,
    { headers: auth }
  );
  if (!meta.ok) throw new Error(`Media lookup failed: ${await metaError(meta)}`);
  const info = (await meta.json()) as { url?: string; mime_type?: string; file_size?: number };
  if (!info.url) throw new Error("Media lookup returned no URL");
  if ((info.file_size ?? 0) > MAX_MEDIA_BYTES) throw new Error("Image is too large");

  const file = await fetch(info.url, { headers: auth });
  if (!file.ok) throw new Error(`Media download failed: HTTP ${file.status}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > MAX_MEDIA_BYTES) throw new Error("Image is too large");
  return {
    data: bytes.toString("base64"),
    mimeType: info.mime_type?.split(";")[0] || "image/jpeg",
  };
}

export async function sendWhatsAppReminder(
  phone: string,
  subscriptionName: string,
  amount: string,
  when: "today" | "tomorrow"
): Promise<WhatsAppSendResult> {
  return sendTemplate(phone, "subscription_duedate_reminder", "en", [
    {
      type: "header",
      parameters: [{ type: "text", parameter_name: "sub_name", text: subscriptionName }],
    },
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

// This expects a template named "monthly_expense_report", category Utility,
// approved in WhatsApp Manager, with a static header ("Monthly Expense
// Report") and body:
//   "Hi Walli! Here's your expense report for {{1}}: *Total expenses*:
//   {{2}}"
// Unlike subscription_duedate_reminder, this template uses Meta's "Number"
// (positional {{1}}/{{2}}) variable format - parameters are matched by
// array order, so `parameter_name` must be omitted here.
export async function sendWhatsAppMonthlyReport(
  phone: string,
  month: string,
  total: string
): Promise<WhatsAppSendResult> {
  return sendTemplate(phone, "monthly_expense_report", "en", [
    {
      type: "body",
      parameters: [
        { type: "text", text: month },
        { type: "text", text: total },
      ],
    },
  ]);
}
