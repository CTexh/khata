"use client";

import { useEffect, useState } from "react";
import { Sheet } from "@/components/Sheet";
import {
  THEMES,
  THEME_KEY,
  VELVET_BAR,
  VELVET_BAR_ID,
  parseTheme,
  revealRadius,
  type ThemeChoice,
} from "@/lib/themes";

export type { ThemeChoice };

// Velvet paints the status bar its own colour with a meta tag of its own - see
// THEME_INIT_SCRIPT. Put back or taken away here so the bar follows the theme
// without a reload.
function syncStatusBar(choice: ThemeChoice) {
  const mine = document.getElementById(VELVET_BAR_ID);
  if (choice !== "velvet") {
    mine?.remove();
    return;
  }
  if (mine) return;
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = VELVET_BAR;
  meta.id = VELVET_BAR_ID;
  document.head.prepend(meta);
}

// "system" means no choice of ours: the phone's own light/dark setting wins,
// and keeps winning when it changes during the day.
export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  syncStatusBar(choice);
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Storage unavailable: the choice holds for this visit only.
  }
}

export function readTheme(): ThemeChoice {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    // Storage unavailable: treat it as following the phone.
    return "system";
  }
}

type WithTransitions = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> };
};

// A theme chosen from its card grows across the screen in a circle from that
// card, rather than the whole app changing colour in one frame. The browser
// photographs the page as it is, the theme changes underneath, and the new
// page is revealed through a widening circle - nothing in the app itself moves
// or re-renders for it.
//
// Where the browser cannot (an older iPhone), or Reduce Motion is on, the
// theme simply changes, exactly as it always has.
export function switchTheme(choice: ThemeChoice, from?: { x: number; y: number }) {
  const doc = document as WithTransitions;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!from || still || typeof doc.startViewTransition !== "function") {
    applyTheme(choice);
    return;
  }
  const root = document.documentElement;
  // Scopes the reveal's styles to this transition and no other.
  root.classList.add("theme-reveal");
  let transition: ReturnType<NonNullable<WithTransitions["startViewTransition"]>>;
  try {
    transition = doc.startViewTransition(() => applyTheme(choice));
  } catch {
    root.classList.remove("theme-reveal");
    applyTheme(choice);
    return;
  }
  const radius = revealRadius(from.x, from.y, window.innerWidth, window.innerHeight);
  transition.ready
    .then(() => {
      root.animate(
        {
          clipPath: [
            `circle(0px at ${from.x}px ${from.y}px)`,
            `circle(${radius}px at ${from.x}px ${from.y}px)`,
          ],
        },
        { duration: 640, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" }
      );
    })
    // A transition the browser abandons still applies the theme; nothing to do.
    .catch(() => {});
  transition.finished.catch(() => {}).finally(() => root.classList.remove("theme-reveal"));
}

function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice | null>(null);
  // Read after mount: localStorage doesn't exist while the server renders.
  useEffect(() => setChoice(readTheme()), []);
  return [choice, setChoice] as const;
}

// Appearance in Settings: the four themes as one row, changing at once.
export function ThemePicker() {
  const [choice, setChoice] = useTheme();

  return (
    <div className="segmented" role="group" aria-label="Appearance">
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          aria-pressed={choice === t.value}
          onClick={() => {
            applyTheme(t.value);
            setChoice(t.value);
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden>
    <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// A small drawing of the app in a theme's own colours - a summary card, two
// cards under it, the tab bar - so a theme can be judged before it is chosen.
// Its colours are fixed per theme, not taken from the theme that is on.
function Miniature({ value }: { value: Exclude<ThemeChoice, "system"> }) {
  return (
    <span className="mini" data-preview={value}>
      {value === "velvet" && (
        <>
          <i className="mini-orb" />
          <i className="mini-orb" />
          <i className="mini-marble" />
        </>
      )}
      <span className="mini-hero">
        <span className="mini-line" />
        <span className="mini-amount" />
      </span>
      <span className="mini-row">
        <span className="mini-card" />
        <span className="mini-card" />
      </span>
      <span className="mini-bar">
        <span className="mini-dot" />
        <span className="mini-pill" />
        <span className="mini-dot" />
      </span>
    </span>
  );
}

function Preview({ value }: { value: ThemeChoice }) {
  return (
    <span className="theme-preview" aria-hidden>
      {value === "system" ? (
        // Half of each, divided on the diagonal: whichever the phone says.
        <>
          <Miniature value="light" />
          <span className="theme-preview-half">
            <Miniature value="dark" />
          </span>
        </>
      ) : (
        <Miniature value={value} />
      )}
    </span>
  );
}

// Themes, from the profile picture: every theme as a card that shows it.
export function ThemeGallery() {
  const [choice, setChoice] = useTheme();

  return (
    <div className="theme-grid" role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          className="theme-card"
          aria-pressed={choice === t.value}
          onClick={(e) => {
            if (choice === t.value) return;
            const r = e.currentTarget.getBoundingClientRect();
            switchTheme(t.value, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
            setChoice(t.value);
          }}
        >
          <Preview value={t.value} />
          <span className="theme-meta">
            <span className="theme-name">
              {t.label}
              {t.tag && <span className="theme-tag">{t.tag}</span>}
            </span>
            <span className="theme-tagline">{t.tagline}</span>
          </span>
          <span className="theme-check" aria-hidden>
            <CheckIcon />
          </span>
        </button>
      ))}
    </div>
  );
}

export function ThemesSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Themes" onClose={onClose}>
      <p className="text-[13px] px-1 -mt-1" style={{ color: "var(--muted)" }}>
        How Khata looks on this device. Velvet adds depth: clay surfaces that lean toward you and press in
        under your finger.
      </p>
      <ThemeGallery />
    </Sheet>
  );
}
