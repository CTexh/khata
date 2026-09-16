"use client";

// The last resort: an error thrown by the root layout itself, where the normal
// error boundary has no page left to render into. It replaces the whole
// document, so it carries its own html and body and cannot rely on any of the
// app's styles having loaded.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "#eef1f9",
          color: "#0b0d14",
          fontFamily: "ui-rounded, system-ui, -apple-system, sans-serif",
          textAlign: "center",
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 8px" }}>Khata couldn&apos;t start</h1>
          <p style={{ fontSize: 15, color: "#5a6275", margin: "0 0 16px" }}>
            Something went wrong before the app loaded. Your data is safe.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 48,
              padding: "12px 22px",
              borderRadius: 999,
              border: "none",
              background: "#2a78d6",
              color: "#fff",
              fontSize: 15,
              fontWeight: 700,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
