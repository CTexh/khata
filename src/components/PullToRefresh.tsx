"use client";

import { useEffect, useRef, useState } from "react";
import { refreshAll } from "@/lib/swr";

// Pull down at the top of a page to fetch it again.
//
// Until now there was no way at all to retry by hand: a screen whose request
// failed stayed as it was until the app was backgrounded and reopened, which
// nobody would ever guess. This is the gesture everyone already knows.
//
// The listeners are the delicate part. A touchmove listener that can call
// preventDefault has to be non-passive, and a non-passive listener on the
// window makes the browser wait for JavaScript before it may scroll - which
// makes every scroll in the app feel heavy. So the only listener that is
// always attached is a passive touchstart; the non-passive one goes on when a
// touch begins at the very top of the page, and comes off as soon as it ends.

const TRIGGER = 34;
// How far the finger travels versus how far the indicator moves: a pull should
// feel like it is resisting.
const DRAG = 0.45;
const MAX = 96;

export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  // Kept in refs so that moving a finger never re-registers a listener.
  const startY = useRef<number | null>(null);
  const pulled = useRef(0);
  const working = useRef(false);

  useEffect(() => {
    // A coarse pointer means a finger; a mouse has a scrollbar and a keyboard.
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    const finish = async () => {
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", finish);
      window.removeEventListener("touchcancel", finish);
      if (startY.current === null) return;
      startY.current = null;
      const reached = pulled.current >= TRIGGER;
      pulled.current = 0;
      if (!reached || working.current) {
        setPull(0);
        return;
      }
      working.current = true;
      setBusy(true);
      setPull(TRIGGER);
      try {
        await refreshAll();
      } finally {
        working.current = false;
        setBusy(false);
        setPull(0);
      }
    };

    function onMove(e: TouchEvent) {
      if (startY.current === null) return;
      const travelled = e.touches[0].clientY - startY.current;
      if (travelled <= 0) {
        // They are scrolling up: hand the gesture back to the page.
        startY.current = null;
        pulled.current = 0;
        setPull(0);
        window.removeEventListener("touchmove", onMove);
        return;
      }
      if (e.cancelable) e.preventDefault();
      pulled.current = Math.min(MAX, travelled * DRAG);
      setPull(pulled.current);
    }

    const onStart = (e: TouchEvent) => {
      if (working.current || e.touches.length !== 1 || window.scrollY > 0) return;
      startY.current = e.touches[0].clientY;
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", finish);
      window.addEventListener("touchcancel", finish);
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", finish);
      window.removeEventListener("touchcancel", finish);
    };
  }, []);

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
        style={{ background: "var(--surface)", border: "1px solid var(--ring)", boxShadow: "0 4px 14px rgba(31,45,90,0.12)" }}
      >
        <span
          className={`w-4 h-4 rounded-full border-2 ${busy ? "animate-spin" : ""}`}
          style={{
            borderColor: "var(--hairline)",
            borderTopColor: "var(--accent)",
            opacity: busy ? 1 : Math.min(1, pull / TRIGGER),
          }}
        />
      </span>
    </div>
  );
}
