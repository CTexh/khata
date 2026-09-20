"use client";

import { useCallback, useEffect, useState } from "react";
import { Sheet } from "@/components/Sheet";

// Setting up "Hey Siri" for Khata. Siri cannot speak to a web app directly, so
// the phone runs an Apple Shortcut instead: it listens, sends what was said to
// the assistant, and reads the answer back. The Shortcut proves who it is with
// the token made here, since a phone has no login session.

type State = { token: string | null; available: boolean } | null;

const ENDPOINT = "/api/shortcut";

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className="shrink-0 w-6 h-6 rounded-full grid place-items-center text-[12px] font-bold"
        style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
      >
        {n}
      </span>
      <span className="min-w-0 text-[14px] leading-relaxed">{children}</span>
    </li>
  );
}

export function SiriSettings({ onBack }: { onBack: () => void }) {
  const [state, setState] = useState<State>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);

  const load = useCallback(async () => {
    const data = await fetch("/api/profile/shortcut", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    setState(data ?? { token: null, available: false });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const make = async () => {
    setBusy(true);
    setNote("");
    const res = await fetch("/api/profile/shortcut", { method: "POST" });
    setBusy(false);
    setConfirmNew(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setNote(j.error ?? "Couldn't make a token — try again.");
      return;
    }
    const { token } = await res.json();
    setState({ token, available: true });
    setRevealed(true);
    setNote("New token ready. Any Shortcut using the old one has stopped working.");
  };

  const turnOff = async () => {
    setBusy(true);
    await fetch("/api/profile/shortcut", { method: "DELETE" });
    setBusy(false);
    setState({ token: null, available: state?.available ?? true });
    setRevealed(false);
    setNote("Turned off. Siri can no longer reach Khata.");
  };

  const copy = async () => {
    if (!state?.token) return;
    try {
      await navigator.clipboard.writeText(`Bearer ${state.token}`);
      setNote("Copied. Paste it as the Authorization header.");
    } catch {
      setRevealed(true);
      setNote("Couldn't copy here — select the token above and copy it by hand.");
    }
  };

  const url = typeof window === "undefined" ? ENDPOINT : `${window.location.origin}${ENDPOINT}`;

  return (
    <Sheet title="Siri & Shortcuts" onClose={onBack}>
      <div className="card p-4 flex flex-col gap-3">
        <div>
          <p className="text-[15px] font-bold">Talk to Khata</p>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--muted)" }}>
            Say what you spent and let the assistant log it, without opening the app. Siri runs a Shortcut you make
            once on your phone.
          </p>
        </div>

        {state === null ? (
          <p className="text-[14px]" style={{ color: "var(--muted)" }}>
            Loading…
          </p>
        ) : !state.available ? (
          <p className="text-[14px]" style={{ color: "var(--muted)" }}>
            This needs the assistant, which isn&apos;t switched on for this account.
          </p>
        ) : state.token ? (
          <>
            <div className="flex flex-col gap-2">
              <span className="text-[13px]" style={{ color: "var(--muted)" }}>
                Your token
              </span>
              <code
                className="text-[12px] break-all rounded-xl p-3"
                style={{ background: "var(--accent-soft)", color: "var(--ink-2)" }}
              >
                {revealed ? state.token : "•".repeat(32)}
              </code>
              <div className="flex gap-2">
                <button className="btn btn-ghost flex-1" onClick={() => setRevealed((v) => !v)}>
                  {revealed ? "Hide" : "Show"}
                </button>
                <button className="btn btn-primary flex-1" onClick={copy}>
                  Copy
                </button>
              </div>
            </div>
          </>
        ) : (
          <button className="btn btn-primary" onClick={make} disabled={busy}>
            {busy ? "Making…" : "Create a token"}
          </button>
        )}

        {note && (
          <p className="text-[13px]" style={{ color: "var(--muted)" }} role="status">
            {note}
          </p>
        )}
      </div>

      {state?.token && (
        <div className="card p-4 mt-3 flex flex-col gap-3">
          <p className="text-[15px] font-bold">Make the Shortcut</p>
          <ol className="flex flex-col gap-2.5">
            <Step n={1}>
              Open the <b>Shortcuts</b> app on your iPhone and tap <b>+</b>.
            </Step>
            <Step n={2}>
              Add <b>Dictate Text</b>. This is what listens to you.
            </Step>
            <Step n={3}>
              Add <b>Get Contents of URL</b> and paste this address:
              <code
                className="block text-[12px] break-all rounded-xl p-2.5 mt-1.5"
                style={{ background: "var(--accent-soft)" }}
              >
                {url}
              </code>
            </Step>
            <Step n={4}>
              Tap <b>Show More</b> on that step. Set <b>Method</b> to <b>POST</b>. Under <b>Headers</b> add
              <b> Authorization</b> with the token you copied (it starts with <b>Bearer</b>).
            </Step>
            <Step n={5}>
              Set <b>Request Body</b> to <b>JSON</b>, add a field named <b>text</b>, and set its value to the{" "}
              <b>Dictated Text</b> from step 2.
            </Step>
            <Step n={6}>
              Add <b>Get Dictionary Value</b>, key <b>reply</b>, then <b>Speak Text</b> with that value — so Khata
              answers out loud.
            </Step>
            <Step n={7}>
              Name the Shortcut something you can say, like <b>Khata</b>. Then: &ldquo;Hey Siri, Khata&rdquo;, and
              speak — &ldquo;three thousand for fuel at Shell&rdquo;.
            </Step>
          </ol>
          <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>
            Anything you can type to the assistant works out loud too: adding an expense, recording that someone paid
            you back, or asking what you&apos;ve spent this month. Say <b>undo</b> to reverse the last change.
          </p>
        </div>
      )}

      {state?.token && (
        <div className="card p-4 mt-3 flex flex-col gap-3">
          <div>
            <p className="text-[15px] font-bold">If you lose your phone</p>
            <p className="text-[13px] mt-0.5" style={{ color: "var(--muted)" }}>
              Anyone holding this token can add and change records through the assistant. Making a new one stops every
              Shortcut using the old one, on every phone.
            </p>
          </div>
          {confirmNew ? (
            <div className="flex flex-col gap-3">
              <p className="text-[14px] font-semibold">
                Make a new token? You&apos;ll have to paste it into your Shortcut again.
              </p>
              <div className="form-actions">
                <button className="btn btn-ghost" onClick={() => setConfirmNew(false)}>
                  Cancel
                </button>
                <button className="btn btn-danger" onClick={make} disabled={busy}>
                  {busy ? "Making…" : "New token"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => setConfirmNew(true)}>
                New token
              </button>
              <button className="btn btn-ghost flex-1" style={{ color: "var(--bad)" }} onClick={turnOff} disabled={busy}>
                Turn off
              </button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
