"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ENTER_MS, haptic, morphFrom, reducedMotion, rubberBand, takeOrigin, watchOrigins } from "@/lib/motion";

// One detail view for the whole app: slides up from the bottom on a phone,
// sits in the middle on a wide screen. Udhar Khata people and subscriptions
// both open in it, so every record looks and behaves the same.
//
// Three things make it feel like part of the phone rather than a web page:
// it grows out of whatever was tapped, it follows a finger dragged down it
// (resisting upwards, carrying a flick into the dismissal), and the app behind
// it sits back while it is open. All of it is transform and opacity, so it
// runs on the compositor and leaves the main thread free.
//
// Locking the page behind a sheet. Hiding overflow is not enough on a phone:
// iOS keeps scrolling the page behind the dialog, and the reader loses their
// place. Fixing the body in position - offset by how far it was scrolled -
// holds it still, and the offset is put back on close so nothing jumps.
// Counted, so a sheet opened on top of another doesn't unlock the page early
// or restore the wrong position.
let locks = 0;
let lockedAt = 0;

function lockPage() {
  if (locks++ > 0) return;
  const body = document.body;
  lockedAt = window.scrollY;
  body.style.position = "fixed";
  body.style.top = `-${lockedAt}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.overflow = "hidden";
  // The app recedes; the depth itself is described in globals.css.
  document.documentElement.setAttribute("data-depth", "");
}

function unlockPage() {
  if (--locks > 0) return;
  locks = 0;
  const body = document.body;
  body.style.position = "";
  body.style.top = "";
  body.style.left = "";
  body.style.right = "";
  body.style.width = "";
  body.style.overflow = "";
  document.documentElement.removeAttribute("data-depth");
  window.scrollTo(0, lockedAt);
}

// For a dialog that isn't a Sheet but still needs the page held still behind it.
export function usePageLock() {
  useEffect(() => {
    lockPage();
    return unlockPage;
  }, []);
}

// Portals exist so the sheet is a sibling of the app rather than a descendant:
// the app is the thing being scaled and blurred, and nothing inside it can
// escape that.
function usePortal() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

const DISMISS_PX = 110; // far enough to mean it
const FLING_PX = 40; // a flick still has to travel, so a tap can never dismiss
const FLING_VELOCITY = 0.5; // px per ms - a flick that beats the distance test
const EXIT_MS = 260;

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const mounted = usePortal();

  // Leaves the way it was dragged: down and out, then unmounted. Every route
  // out of the sheet comes through here, so the close button, the backdrop,
  // Escape and a flick all end the same way.
  const dismiss = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const panel = panelRef.current;
    const backdrop = backdropRef.current;
    if (!panel || reducedMotion()) {
      onClose();
      return;
    }
    const travel = panel.getBoundingClientRect().height + 24;
    panel.style.transition = `transform ${EXIT_MS}ms var(--ease-settle)`;
    panel.style.transform = `translate3d(0, ${travel}px, 0)`;
    if (backdrop) {
      backdrop.style.transition = `opacity ${EXIT_MS}ms var(--ease-settle)`;
      backdrop.style.opacity = "0";
    }
    window.setTimeout(onClose, EXIT_MS - 40);
  }, [onClose]);

  useEffect(() => {
    watchOrigins();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    lockPage();
    window.addEventListener("keydown", onKey);
    return () => {
      unlockPage();
      window.removeEventListener("keydown", onKey);
    };
  }, [dismiss]);

  // The morph. The panel is put back over whatever was tapped and released to
  // its own position in one movement, so the row and the sheet are visibly the
  // same object. With no recent tap to grow from - opened by keyboard, or by
  // the app itself - the CSS entrance plays instead.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    // Runs on the render that the portal appears in, not the one before it.
    if (!panel || reducedMotion()) return;
    const origin = takeOrigin();
    if (!origin || origin.width < 24) return;

    const rect = panel.getBoundingClientRect();
    panel.style.animation = "none";
    panel.style.transformOrigin = "50% 0%";
    panel.style.transition = "none";
    panel.style.transform = morphFrom(rect, origin);
    panel.style.opacity = "0.35";

    const id = requestAnimationFrame(() => {
      panel.style.transition = `transform ${ENTER_MS}ms var(--ease-enter), opacity 220ms ease-out`;
      panel.style.transform = "translate3d(0, 0, 0)";
      panel.style.opacity = "1";
    });
    return () => cancelAnimationFrame(id);
  }, [mounted]);

  // The drag. Pointer events cover touch, pen and mouse in one path; the sheet
  // follows exactly downwards and gives less and less upwards, so its top edge
  // can be felt without ever being passed.
  // `armed` is a drag that has been started but not claimed. A pull from the
  // handle is a drag at once; anywhere else it only becomes one after the
  // finger has moved down a little, because at the top of the content an
  // upward drag is how you scroll, and that has to stay the browser's.
  const drag = useRef<{ id: number; startY: number; y: number; t: number; v: number; armed: boolean } | null>(null);

  const claim = (e: React.PointerEvent) => {
    const panel = panelRef.current;
    if (!panel || !drag.current) return;
    drag.current.armed = false;
    try {
      panel.setPointerCapture(e.pointerId);
    } catch {}
    panel.style.transition = "none";
    // While the sheet itself is moving, the content inside it doesn't.
    if (bodyRef.current) bodyRef.current.style.touchAction = "none";
  };

  const release = () => {
    if (bodyRef.current) bodyRef.current.style.touchAction = "";
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (closing.current || reducedMotion() || e.button !== 0) return;
    const target = e.target as Element;
    const fromHandle = Boolean(target.closest(".sheet-grip, .sheet-head"));
    // Anywhere else, the drag only takes over once the content is scrolled to
    // the top - otherwise it would steal the scroll.
    if (!fromHandle && (bodyRef.current?.scrollTop ?? 0) > 0) return;
    if (target.closest("button, a, input, select, textarea")) return;
    drag.current = { id: e.pointerId, startY: e.clientY, y: e.clientY, t: performance.now(), v: 0, armed: !fromHandle };
    if (!fromHandle) return;
    claim(e);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const panel = panelRef.current;
    if (!d || !panel || d.id !== e.pointerId) return;

    if (d.armed) {
      const moved = e.clientY - d.startY;
      // Upwards means they are scrolling the content: step out of the way.
      if (moved < -4) {
        drag.current = null;
        return;
      }
      if (moved < 6) return;
      claim(e);
    }

    const now = performance.now();
    const dt = now - d.t;
    if (dt > 0) d.v = (e.clientY - d.y) / dt;
    d.y = e.clientY;
    d.t = now;

    const raw = e.clientY - d.startY;
    // Down is one-to-one; up is rubber, against the sheet's own height.
    const offset = raw >= 0 ? raw : -rubberBand(-raw, panel.getBoundingClientRect().height || 400);
    panel.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
    if (backdropRef.current) {
      const fade = Math.max(0, 1 - Math.max(0, raw) / 420);
      backdropRef.current.style.opacity = String(0.35 + 0.65 * fade);
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    const panel = panelRef.current;
    release();
    if (!d || !panel || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.armed) return; // never became a drag
    const travelled = e.clientY - d.startY;

    if (travelled > DISMISS_PX || (travelled > FLING_PX && d.v > FLING_VELOCITY)) {
      haptic(10);
      dismiss();
      return;
    }
    // Back home on the press spring, carrying the same weight as everything
    // else that is let go of.
    panel.style.transition = "transform var(--dur-press) var(--ease-press)";
    panel.style.transform = "translate3d(0, 0, 0)";
    if (backdropRef.current) {
      backdropRef.current.style.transition = "opacity var(--dur-press) var(--ease-press)";
      backdropRef.current.style.opacity = "1";
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div className="sheet-backdrop" ref={backdropRef} onClick={dismiss}>
      <div
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="sheet-grip" aria-hidden />
        <div className="sheet-head">
          <h2 className="text-[17px] font-extrabold truncate">{title}</h2>
          <button type="button" className="chat-round !w-10 !h-10 shrink-0" aria-label="Close" onClick={dismiss}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="sheet-body" ref={bodyRef}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

// A labelled value row inside a sheet ("Next payment · 5 Oct").
export function SheetRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b last:border-b-0" style={{ borderColor: "var(--hairline)" }}>
      <span className="text-[14px]" style={{ color: "var(--muted)" }}>
        {label}
      </span>
      <span className="text-[15px] font-bold text-right min-w-0">{children}</span>
    </div>
  );
}
