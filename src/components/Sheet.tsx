"use client";

import { useEffect } from "react";

// One detail view for the whole app: slides up from the bottom on a phone,
// sits in the middle on a wide screen. Udhar Khata people and subscriptions
// both open in it, so every record looks and behaves the same.
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
  window.scrollTo(0, lockedAt);
}

// For a dialog that isn't a Sheet but still needs the page held still behind it.
export function usePageLock() {
  useEffect(() => {
    lockPage();
    return unlockPage;
  }, []);
}

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    lockPage();
    window.addEventListener("keydown", onKey);
    return () => {
      unlockPage();
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" aria-hidden />
        <div className="sheet-head">
          <h2 className="text-[17px] font-extrabold truncate">{title}</h2>
          <button type="button" className="chat-round !w-10 !h-10 shrink-0" aria-label="Close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
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
