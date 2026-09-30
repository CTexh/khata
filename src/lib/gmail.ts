// Reading Gmail from the app itself.
//
// Only what the import needs: a search, and the text of a message. It speaks
// to Gmail's REST API directly rather than pulling in googleapis, which is a
// large dependency for three endpoints.
//
// Authentication is a refresh token made once by scripts/gmail-authorize.mjs
// and kept in the environment, with the read-only Gmail scope. Access tokens
// last an hour and are cached in the instance, so most runs make no token
// request at all.

const OAUTH = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const REQUEST_MS = 12_000;

export function gmailConfigured(): boolean {
  return !!(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN
  );
}

let cached: { token: string; expiresAt: number } | null = null;
// Refreshed a minute before it actually expires, so a request never goes out
// with a token that dies in flight.
const EARLY_MS = 60_000;

export async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt - EARLY_MS > Date.now()) return cached.token;
  if (!gmailConfigured()) throw new Error("Gmail is not configured (GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN)");

  const res = await fetch(OAUTH, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(REQUEST_MS),
  });
  const body = (await res.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; error?: string; error_description?: string }
    | null;
  if (!res.ok || !body?.access_token) {
    // A revoked or expired refresh token says invalid_grant, and no amount of
    // retrying fixes it - it has to be made again.
    const detail = body?.error_description || body?.error || `HTTP ${res.status}`;
    throw new Error(`Gmail token refresh failed: ${detail}`);
  }
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function gmail<T>(path: string): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_MS),
  });
  if (res.status === 401) {
    // The cached token was rejected: drop it so the next call mints a new one.
    cached = null;
    throw new Error("Gmail refused the access token");
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Gmail ${path.split("?")[0]} HTTP ${res.status} ${detail}`);
  }
  return (await res.json()) as T;
}

/* ---------- searching ---------- */

export type Found = { id: string; threadId: string };
// One search, in pages. Bank alerts come a handful at a time, so the cap is
// generous; a stuck loop is worse than a missed email that the next run finds.
const PAGE_SIZE = 50;
const MAX_PAGES = 4;

export async function searchMessages(query: string): Promise<Found[]> {
  const found: Found[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ q: query, maxResults: String(PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await gmail<{ messages?: Found[]; nextPageToken?: string }>(`/messages?${params}`);
    for (const m of data.messages ?? []) if (m?.id && m?.threadId) found.push({ id: m.id, threadId: m.threadId });
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return found;
}

/* ---------- reading one message ---------- */

type Part = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number };
  parts?: Part[];
};
type RawMessage = {
  id: string;
  internalDate?: string;
  payload?: Part & { headers?: { name?: string; value?: string }[] };
};

export type Email = {
  id: string;
  /** When Gmail received it, as milliseconds. */
  receivedMs: number;
  from: string;
  subject: string;
  /** The message as plain text, HTML stripped if that is all there was. */
  text: string;
};

export function headerValue(
  headers: { name?: string; value?: string }[] | undefined,
  name: string
): string {
  const hit = (headers ?? []).find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return hit?.value ?? "";
}

export function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

// Tags out, entities back to characters, runs of blank space collapsed. Bank
// alerts are mostly tables, and what matters is the words left in the cells.
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|table|h\d|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

// The readable body of a message. text/plain is preferred wherever it appears
// in the tree; an alert sent only as HTML is stripped down instead.
export function plainTextFromPayload(payload: Part | undefined): string {
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (part: Part | undefined) => {
    if (!part) return;
    const data = part.body?.data;
    // Attachments have a filename; their contents are not the message.
    if (data && !part.filename) {
      if (part.mimeType === "text/plain") plain.push(decodeBase64Url(data));
      else if (part.mimeType === "text/html") html.push(decodeBase64Url(data));
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  if (plain.length) return plain.join("\n").trim();
  return stripHtml(html.join("\n"));
}

// How much of one alert is handed to a model. They run to a few hundred
// characters of content and a long legal footer.
export const MAX_EMAIL_CHARS = 4_000;

export async function fetchEmail(id: string): Promise<Email> {
  const raw = await gmail<RawMessage>(`/messages/${encodeURIComponent(id)}?format=full`);
  return {
    id: raw.id,
    receivedMs: Number(raw.internalDate ?? 0),
    from: headerValue(raw.payload?.headers, "from").slice(0, 200),
    subject: headerValue(raw.payload?.headers, "subject").slice(0, 300),
    text: plainTextFromPayload(raw.payload).slice(0, MAX_EMAIL_CHARS),
  };
}
