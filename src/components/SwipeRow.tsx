"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CONFIRM_PX, REVEAL_PX, direction, offsetWhileDragging, settle, type Direction } from "@/lib/swipe";
import { haptic } from "@/lib/motion";

// Swipe a row to the left and a Delete button appears behind it; tap that and
// the row asks whether you meant it, Yes or No. Used for expenses, loans and
// subscriptions.
//
// Two things matter for this to feel right on a phone. First, a row must not
// move until the finger has clearly gone sideways, or scrolling a list drags
// every row on the way past. That is what `direction` decides, and why the
// row sets `touch-action: pan-y`: vertical scrolling stays with the browser
// and never waits for this code. Second, only one row is ever open, so there
// is never a second Delete lurking off-screen.

// The row that is currently open, so opening another closes it.
let openRow: (() => void) | null = null;

export function SwipeRow({
  children,
  onDelete,
  question = "Delete this?",
  label = "row",
  disabled,
}: {
  children: React.ReactNode;
  onDelete: () => Promise<{ ok: boolean; error?: string } | void>;
  // What the row asks once Delete is tapped.
  question?: string;
  // Named for a screen reader: "Delete Careem, Rs 849".
  label?: string;
  disabled?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  const start = useRef<{ x: number; y: number; at: number; from: number } | null>(null);
  const way = useRef<Direction>("unknown");
  const closeRef = useRef<() => void>(() => {});

  const close = useCallback(() => {
    setOffset(0);
    setAsking(false);
    setError("");
    if (openRow === closeRef.current) openRow = null;
  }, []);
  closeRef.current = close;

  // A row left open and forgotten is a trap; leaving the page closes it.
  useEffect(() => () => {
    if (openRow === closeRef.current) openRow = null;
  }, []);

  const open = useCallback(
    (to: number) => {
      if (openRow && openRow !== closeRef.current) openRow();
      openRow = closeRef.current;
      setOffset(to);
    },
    []
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || busy || asking) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, at: e.timeStamp, from: offset };
    way.current = "unknown";
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const from = start.current;
    if (!from) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;

    if (way.current === "unknown") {
      way.current = direction(dx, dy);
      // A scroll: let go of this gesture entirely.
      if (way.current === "down") {
        start.current = null;
        return;
      }
      if (way.current === "across") {
        setDragging(true);
        // Keeps the gesture even if the finger leaves the row. Refused for a
        // pointer the browser no longer considers active, which must not take
        // the swipe down with it.
        try {
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        } catch {}
      }
      if (way.current !== "across") return;
    }
    setOffset(offsetWhileDragging(from.from, dx));
  };

  const endDrag = (e: React.PointerEvent) => {
    const from = start.current;
    start.current = null;
    setDragging(false);
    if (!from || way.current !== "across") return;
    const dx = e.clientX - from.x;
    const ms = Math.max(1, e.timeStamp - from.at);
    const landed = settle(from.from + dx, dx / ms);
    if (landed === 0) {
      close();
    } else {
      haptic(8);
      open(landed);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError("");
    const result = await onDelete();
    setBusy(false);
    if (result && result.ok === false) {
      setError(result.error ?? "Couldn't delete that.");
      return;
    }
    // Gone: the list will no longer render this row.
    close();
  };

  const shownOffset = asking ? -CONFIRM_PX : offset;

  return (
    <div className="swipe-row">
      <div className="swipe-actions" aria-hidden={shownOffset === 0}>
        {asking ? (
          <>
            <button type="button" className="swipe-answer" onClick={close} disabled={busy}>
              No
            </button>
            <button type="button" className="swipe-answer swipe-answer-yes" onClick={remove} disabled={busy}>
              {busy ? "…" : "Yes"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="swipe-delete"
            aria-label={`Delete ${label}`}
            tabIndex={offset === 0 ? -1 : 0}
            onClick={() => {
              setAsking(true);
              open(-CONFIRM_PX);
            }}
          >
            Delete
          </button>
        )}
      </div>

      <div
        className="swipe-content"
        style={{
          transform: `translate3d(${shownOffset}px, 0, 0)`,
          transition: dragging ? "none" : "transform var(--dur-press, 260ms) var(--ease-press, cubic-bezier(0.16,1,0.3,1))",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        // A row that is open swallows the next tap: it closes instead of
        // opening whatever was underneath the finger.
        onClickCapture={(e) => {
          if (offset !== 0 || asking) {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      >
        {children}
      </div>

      {asking && (
        <p className="swipe-question" role="status">
          {error || question}
        </p>
      )}
    </div>
  );
}
