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

export type ThemeInfo = {
  value: ThemeChoice;
  label: string;
  tagline: string;
  /** A word on the card when the theme does something the others do not. */
  tag?: string;
};

export const THEMES: ThemeInfo[] = [
  { value: "light", label: "Light", tagline: "Bright and clear" },
  { value: "dark", label: "Dark", tagline: "Easy on the eyes at night" },
  { value: "system", label: "System", tagline: "Follows your phone" },
  { value: "velvet", label: "Velvet", tagline: "Clay and glass in plum and gold", tag: "3D" },
];

// What a stored value means. Anything else - nothing saved, a value written by
// some later version, storage that could not be read - follows the phone.
export function parseTheme(saved: string | null | undefined): ThemeChoice {
  return saved === "light" || saved === "dark" || saved === "velvet" ? saved : "system";
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
export const THEME_INIT_SCRIPT =
  `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});` +
  `if(t==="light"||t==="dark"||t==="velvet"){var d=document.documentElement;d.dataset.theme=t;` +
  `if(t==="velvet"){var m=document.createElement("meta");m.name="theme-color";` +
  `m.content=${JSON.stringify(VELVET_BAR)};m.id=${JSON.stringify(VELVET_BAR_ID)};document.head.prepend(m)}}}catch(e){}`;
