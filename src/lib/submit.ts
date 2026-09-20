// Sending something to the server, from a form.
//
// Every form in Khata used to do this by hand: set a busy flag, await fetch,
// clear the flag. When fetch *rejects* - no signal, or Safari cutting off a
// request as the app is backgrounded - the line that clears the flag never
// runs, so the button sits on "Saving…" for ever and the only way out is to
// force-quit the app. That is the worst way for an app to fail: it looks like
// it is still working.
//
// So: one place that always answers, either with what the server said or with
// a sentence worth showing.

export const OFFLINE_MESSAGE = "No connection. Nothing was saved — try again when you're back online.";

// What to say when the server refused but did not explain itself.
export function failureMessage(status: number, given?: unknown): string {
  const said = typeof given === "string" ? given.trim() : "";
  if (said) return said;
  if (status === 401) return "You've been signed out. Log in again and retry.";
  if (status === 403) return "That isn't allowed on this account.";
  if (status === 404) return "That's gone — it may have been deleted already.";
  if (status === 409) return "That has changed since you opened it. Refresh and try again.";
  if (status === 413) return "That's too large to send.";
  if (status === 429) return "Too many attempts. Wait a moment and try again.";
  if (status >= 500) return "Khata couldn't save that just now. Please try again.";
  return "Something went wrong. Please try again.";
}

export type Sent<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

// `body` is sent as JSON unless it is already a FormData. A rejected request -
// which is what being offline looks like - comes back as a failure like any
// other, never as a thrown error.
export async function send<T = Record<string, unknown>>(
  url: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {}
): Promise<Sent<T>> {
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "POST",
      headers: init.body === undefined || isForm ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch {
    // 0 is not a real HTTP status; it means the request never got an answer.
    return { ok: false, error: OFFLINE_MESSAGE, status: 0 };
  }

  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { ok: false, error: failureMessage(res.status, payload?.error), status: res.status };
  return { ok: true, data: payload as T };
}
