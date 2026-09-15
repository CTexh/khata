"use client";

import { useEffect } from "react";

// One detail view for the whole app: slides up from the bottom on a phone,
// sits in the middle on a wide screen. Udhar Khata people and subscriptions
// both open in it, so every record looks and behaves the same.
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
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
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
