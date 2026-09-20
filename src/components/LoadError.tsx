"use client";

import { useState } from "react";

// When a screen has nothing to show because the request failed. Every page
// used to handle this differently, and three of them didn't handle it at all -
// they showed a spinner that never stopped, with no way to try again short of
// backgrounding the app.
export function LoadError({ what, onRetry }: { what: string; onRetry: () => Promise<unknown> | void }) {
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    setBusy(true);
    try {
      await onRetry();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-8 text-center rise flex flex-col items-center gap-3" role="alert">
      <p className="text-[17px] font-bold">Couldn&apos;t load {what}</p>
      <p className="text-[14px]" style={{ color: "var(--muted)" }}>
        Check your connection — everything you&apos;ve saved is still here.
      </p>
      <button className="btn btn-primary" onClick={retry} disabled={busy}>
        {busy ? "Trying…" : "Try again"}
      </button>
    </div>
  );
}
