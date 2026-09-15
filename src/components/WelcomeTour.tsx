"use client";

import { useEffect, useState } from "react";

type Step = { emoji: string; title: string; text: string };

const STEPS: Step[] = [
  {
    emoji: "👋",
    title: "Welcome to Khata",
    text: "Your spending, loans and subscriptions in one place. Home shows what you spent today, this week or this month.",
  },
  {
    emoji: "🧾",
    title: "Mera Khata",
    text: "Tap + to log an expense. Categories fill in for you, and you can see where your money went each month.",
  },
  {
    emoji: "🤝",
    title: "Udhar Khata",
    text: "Add people who owe you. Tap a name to record more lent or money paid back, and set a date to remind you.",
  },
  {
    emoji: "🔁",
    title: "Subscriptions",
    text: "Keep every monthly payment in one list. Tap one to mark it paid - Khata tells you what's still due.",
  },
];

const ASSISTANT_STEP: Step = {
  emoji: "✨",
  title: "Ask the assistant",
  text: "Tap the middle button and just say it: \"fuel 3000 shell\" or \"who owes me?\". You can type, talk or snap a bill.",
};

// A few cards that introduce the app. Skippable at any point; finishing or
// skipping both mark it as seen.
export function WelcomeTour({ withAssistant, onClose }: { withAssistant: boolean; onClose: () => void }) {
  const steps = withAssistant ? [...STEPS, ASSISTANT_STEP] : STEPS;
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const last = index === steps.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, steps.length]);

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className="sheet-panel">
        <div className="flex justify-end px-4 pt-3">
          <button type="button" className="min-h-11 px-3 text-[14px] font-bold" style={{ color: "var(--muted)" }} onClick={onClose}>
            Skip
          </button>
        </div>

        <div key={index} className="rise flex flex-col items-center text-center px-6 pb-2">
          <div className="chat-glow-card !py-10 !rounded-[36px] !max-w-none">
            <p className="text-[56px] leading-none" aria-hidden>
              {step.emoji}
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
    </div>
  );
}
