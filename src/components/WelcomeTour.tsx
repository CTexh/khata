"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { HandshakeIcon, ReceiptIcon, SparkleIcon } from "@/components/icons";
import { BellIcon, RecurringIcon, WaveIcon } from "@/components/CategoryIcon";
import { usePageLock } from "@/components/Sheet";

type Step = { Icon: (p: { size?: number }) => React.ReactElement; title: string; text: string };

const STEPS: Step[] = [
  {
    Icon: WaveIcon,
    title: "Welcome to Khata",
    text: "Spending, loans and subscriptions in one place. On Home, switch between Today, This Week and This Month.",
  },
  {
    Icon: ReceiptIcon,
    title: "Mera Khata",
    text: "Tap + to log an expense - the category fills in for you. Tap a category to filter, or any expense to edit it.",
  },
  {
    Icon: HandshakeIcon,
    title: "Udhar Khata",
    text: "Track who owes you. Record what comes back, and set a follow-up date so you remember to ask.",
  },
  {
    Icon: RecurringIcon,
    title: "Subscriptions",
    text: "Every monthly payment in one list. Mark one paid, pause it, or see what is overdue.",
  },
  {
    Icon: BellIcon,
    title: "Reminders",
    text: "Subscriptions due, udhar follow-ups and new bank expenses, on your lock screen with the app closed. Turn them on in Settings \u2192 Manage notifications. On iPhone, add Khata to your Home Screen first.",
  },
];

const ASSISTANT_STEP: Step = {
  Icon: SparkleIcon,
  title: "Ask the assistant",
  text: "Tap the middle button and just say it: \"fuel 3000 shell\" or \"who owes me?\". Type, talk or snap a bill.",
};

// A few cards that introduce the app. Skippable at any point; finishing or
// skipping both mark it as seen.
export function WelcomeTour({ withAssistant, onClose }: { withAssistant: boolean; onClose: () => void }) {
  const steps = withAssistant ? [...STEPS, ASSISTANT_STEP] : STEPS;
  const [index, setIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const step = steps[index];
  const last = index === steps.length - 1;

  usePageLock();
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, steps.length]);

  if (!mounted) return null;

  return createPortal(
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className="sheet-panel">
        <div className="flex justify-end px-4 pt-3">
          <button type="button" className="min-h-11 px-3 text-[14px] font-bold" style={{ color: "var(--muted)" }} onClick={onClose}>
            Skip
          </button>
        </div>

        <div key={index} className="rise flex flex-col items-center text-center px-6 pb-2">
          <div className="chat-glow-card !py-10 !rounded-[36px] !max-w-none">
            <p className="flex justify-center" style={{ color: "var(--accent)" }} aria-hidden>
              <step.Icon size={56} />
            </p>
          </div>
          <h2 id="tour-title" className="text-[24px] font-extrabold mt-6">
            {step.title}
          </h2>
          <p className="text-[16px] leading-relaxed mt-2 max-w-sm" style={{ color: "var(--muted)" }}>
            {step.text}
          </p>
        </div>

        <div className="flex justify-center gap-2 py-5" aria-label={`Step ${index + 1} of ${steps.length}`}>
          {steps.map((_, i) => (
            <span
              key={i}
              className="h-2 rounded-full transition-all"
              style={{
                width: i === index ? 22 : 8,
                background: i === index ? "var(--accent)" : "var(--hairline)",
              }}
            />
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 px-5 pb-6">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setIndex((i) => i - 1)}
            disabled={index === 0}
            style={index === 0 ? { visibility: "hidden" } : undefined}
          >
            Back
          </button>
          <button type="button" className="btn btn-primary" onClick={() => (last ? onClose() : setIndex((i) => i + 1))}>
            {last ? "Get started" : "Next"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
