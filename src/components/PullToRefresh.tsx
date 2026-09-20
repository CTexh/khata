"use client";

import { useEffect, useRef, useState } from "react";
import { refreshAll } from "@/lib/swr";

// Pull down at the top of a page to fetch it again.
//
// Until now there was no way at all to retry by hand: a screen whose request
// failed stayed as it was until the app was backgrounded and reopened, which
// nobody would ever guess. This is the gesture everyone already knows.

const TRIGGER = 72;
// How far the finger travels versus how far the indicator moves: a pull should
// feel like it is resisting.
const DRAG = 0.45;
const MAX = 96;

export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);
  const armed = useRef(false);

  useEffect(() => {
    // A coarse pointer means a finger; a mouse has a scrollbar and a keyboard.
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    const onStart = (e: TouchEvent) => {
      if (busy || e.touches.length !== 1) return;
      // Only from the very top of the page, so it never fights a scroll.
      armed.current = window.scrollY <= 0;
      start.current = armed.current ? e.touches[0].clientY : null;
    };

    const onMove = (e: TouchEvent) => {
      if (start.current === null || busy) return;
      const travelled = e.touches[0].clientY - start.current;
      if (travelled <= 0) {
        // They're scrolling up: hand the gesture back to the page.
        start.current = null;
        setPull(0);
        return;
      }
      if (e.cancelable) e.preventDefault();
      setPull(Math.min(MAX, travelled * DRAG));
    };

    const onEnd = async () => {
      if (start.current === null) return;
      const reached = pull >= TRIGGER * DRAG;
      start.current = null;
      if (!reached) {
        setPull(0);
        return;
      }
      setBusy(true);
      setPull(TRIGGER * DRAG);
      try {
        await refreshAll();
      } finally {
        setBusy(false);
        setPull(0);
      }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    // Not passive: a pull has to be able to stop the page rubber-banding.
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [busy, pull]);

  if (pull <= 0 && !busy) return null;

  return (
    <div
      className="fixed left-1/2 z-50 pointer-events-none"
      style={{
        top: `calc(env(safe-area-inset-top) + ${Math.round(pull)}px)`,
        transform: "translateX(-50%)",
        transition: busy || pull === 0 ? "top 200ms ease-out" : undefined,
      }}
      role="status"
      aria-label={busy ? "Refreshing" : "Pull to refresh"}
    >
      <span
        className="grid place-items-center w-9 h-9 rounded-full"
        style={{ background: "var(--card)", border: "1px solid var(--ring)", boxShadow: "0 4px 14px rgba(31,45,90,0.12)" }}
      >
        <span
          className={`w-4 h-4 rounded-full border-2 ${busy ? "animate-spin" : ""}`}
          style={{
            borderColor: "var(--hairline)",
            borderTopColor: "var(--accent)",
            opacity: busy ? 1 : Math.min(1, pull / (TRIGGER * DRAG)),
          }}
        />
      </span>
    </div>
  );
}
