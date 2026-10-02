// The app's themes, as data, so the picker, the page and the script that runs
// before the first paint all agree on what exists.
//
// Light and Dark are the same design in two lights; System is no choice at all,
// and follows the phone. Velvet is the one with depth: clay surfaces, a little
// glass, and movement in three dimensions. Its styles are in app/velvet.css and
// its motion in lib/velvet-motion.ts, and both do nothing while another theme
// is on.

export type ThemeChoice = "light" | "dark" | "system" | "velvet";

export const THEME_KEY = "khata-theme";

// What Safari paints behind the status bar while Velvet is on. Light and Dark
// take theirs from the page's own theme-color metadata, which follows the phone.
export const VELVET_BAR = "#110c22";
export const VELVET_BAR_ID = "velvet-theme-color";

// Velvet is finished but switched off: taken out of the picker and the
// gallery, and a device that already chose it falls back to System. The code
// behind it - app/velvet.css, lib/velvet-motion.ts, components/VelvetMotion -
// is untouched, so turning it back on later is this one line.
const VELVET_ENABLED = false;

export type ThemeInfo = {
  value: ThemeChoice;
  label: string;
  tagline: string;
  /** A word on the card when the theme does something the others do not. */
  tag?: string;
};

const ALL_THEMES: ThemeInfo[] = [
  { value: "light", label: "Light", tagline: "Bright and clear" },
  { value: "dark", label: "Dark", tagline: "Easy on the eyes at night" },
  { value: "system", label: "System", tagline: "Follows your phone" },
  { value: "velvet", label: "Velvet", tagline: "Clay and glass in plum and gold", tag: "3D" },
];

export const THEMES: ThemeInfo[] = VELVET_ENABLED ? ALL_THEMES : ALL_THEMES.filter((t) => t.value !== "velvet");

// What a stored value means. Anything else - nothing saved, a value written by
// some later version, storage that could not be read, or a theme switched off
// since it was chosen - follows the phone.
export function parseTheme(saved: string | null | undefined): ThemeChoice {
  if (saved === "light" || saved === "dark") return saved;
  if (saved === "velvet" && VELVET_ENABLED) return "velvet";
  return "system";
}

// How far a circle growing from (x, y) has to reach to cover the whole screen:
// the distance to the furthest corner.
export function revealRadius(x: number, y: number, width: number, height: number): number {
  return Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
}

// Runs before React, before the first paint, so a saved theme is on the very
// first frame rather than arriving a moment later as a flash of the default.
// It cannot import anything, so it is written out here beside the values it
// has to agree with, and scripts/test-themes.ts runs it to make sure it does.
//
// The status bar colour for Velvet is a meta tag of its own, put first so it
// wins over the page's light and dark ones. Those belong to Next and are left
// untouched; this one belongs to no one else, so it can come and go freely.
const THEME_INIT_VALUES = VELVET_ENABLED ? '"light"||t==="dark"||t==="velvet"' : '"light"||t==="dark"';
const THEME_INIT_VELVET_METADATA = VELVET_ENABLED
  ? `if(t==="velvet"){var m=document.createElement("meta");m.name="theme-color";` +
    `m.content=${JSON.stringify(VELVET_BAR)};m.id=${JSON.stringify(VELVET_BAR_ID)};document.head.prepend(m)}`
  : "";
export const THEME_INIT_SCRIPT =
  `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});` +
  `if(t===${THEME_INIT_VALUES}){var d=document.documentElement;d.dataset.theme=t;` +
  `${THEME_INIT_VELVET_METADATA}}}catch(e){}`;
