"use client";

import { useEffect } from "react";
import Link from "next/link";

// Anything that throws while rendering lands here instead of a blank screen.
// Khata is mostly read from a phone, often on a bad connection, and a failed
// request that takes a component down with it should be one tap from being
// tried again rather than a dead end.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The digest is what ties this to the server log; the message itself may
    // be redacted in production.
    console.error(JSON.stringify({ evt: "render_error", digest: error.digest ?? null, message: error.message.slice(0, 200) }));
  }, [error]);

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-16 flex flex-col items-center text-center gap-4">
      <div className="card p-6 flex flex-col items-center gap-3 w-full">
        <h1 className="text-[20px] font-extrabold">That didn&apos;t load</h1>
        <p className="text-[15px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Something went wrong on this screen. Your data is safe - nothing was saved or changed.
        </p>
        <div className="flex flex-wrap gap-2 justify-center pt-1">
          <button type="button" className="btn btn-primary" onClick={reset}>
            Try again
          </button>
          <Link href="/" className="btn btn-ghost">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
