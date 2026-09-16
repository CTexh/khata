"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePageLock } from "@/components/Sheet";
import { BellIcon } from "@/components/CategoryIcon";

// Shown once, to accounts that existed before reminders did: notifications are
// new, and nobody goes looking in Settings for something they don't know
// about. Someone brand new meets the same thing in the welcome tour instead,
// so they never see both.
//
// The steps are what this device actually needs. An iPhone in a Safari tab
// can't be asked for permission at all until the app is on the Home Screen, so
// that step appears only where it applies.
const isIos = () =>
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true);

export function NotificationsNews({ onSetUp, onClose }: { onSetUp: () => void; onClose: () => void }) {
  usePageLock();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const steps = [
    ...(isIos() && !isStandalone() ? ["Add Khata to your Home Screen, and open it from there."] : []),
    "Settings → Manage notifications.",
    "Switch on Notify this device, and allow the prompt.",
  ];

  if (!mounted) return null;

  return createPortal(
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="news-title">
      <div className="pop-panel">
        <div className="flex flex-col items-center text-center px-6 pt-8">
          <p className="pop-badge" style={{ color: "var(--accent)" }} aria-hidden>
            <BellIcon size={30} />
          </p>
          <h2 id="news-title" className="text-[21px] font-extrabold mt-4">
            Reminders are here
          </h2>
          <p className="text-[15px] leading-relaxed mt-2" style={{ color: "var(--muted)" }}>
            Subscriptions due, udhar follow-ups and your daily recap now arrive on your lock screen, even
            with the app closed.
          </p>
        </div>

        <ol className="flex flex-col gap-2.5 px-6 pt-5">
          {steps.map((text, i) => (
            <li key={text} className="flex items-center gap-3 text-[14px]">
              <span className="pop-step" aria-hidden>
                {i + 1}
              </span>
              <span className="min-w-0">{text}</span>
            </li>
          ))}
        </ol>

        <div className="grid grid-cols-2 gap-2 px-5 py-6">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Later
          </button>
          <button type="button" className="btn btn-primary" onClick={onSetUp}>
            Turn on
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
