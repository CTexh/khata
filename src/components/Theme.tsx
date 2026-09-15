"use client";

import { useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "khata-theme";

// "system" means no choice of ours: the phone's own light/dark setting wins,
// and keeps winning when it changes during the day.
export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Storage unavailable: the choice holds for this visit only.
  }
}

export function readTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // Storage unavailable: treat it as following the phone.
  }
  return "system";
}

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

// Appearance lives in Settings, next to everything else about the account.
export function ThemePicker() {
  const [choice, setChoice] = useState<ThemeChoice | null>(null);

  // Read after mount: localStorage doesn't exist while the server renders.
  useEffect(() => setChoice(readTheme()), []);

  return (
    <div className="segmented" role="group" aria-label="Appearance">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={choice === o.value}
          onClick={() => {
            applyTheme(o.value);
            setChoice(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
