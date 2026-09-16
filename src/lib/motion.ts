// The app's motion language, in one place.
//
// Everything here is physics rather than timing curves: a sheet that is
// dragged should follow the finger exactly, resist past its limits, and carry
// the speed of the flick into how it leaves. The easings themselves live in
// globals.css as linear() curves sampled from a damped spring, so CSS-driven
// motion and finger-driven motion agree about weight.
//
// Nothing here assumes it is running in a browser that supports any of it.
// Vibration, for one, exists on Android and not on iOS, so it is asked for and
// never depended on.

// Matches --dur-enter / --dur-settle in globals.css. Kept in sync by hand,
// which is cheap for three numbers and avoids reading computed styles on every
// gesture.
export const ENTER_MS = 550;
export const SETTLE_MS = 450;
export const PRESS_MS = 360;

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// A short tick on release or dismissal. Android honours it; iOS ignores it
// (Apple exposes no vibration to web apps), so it is a bonus, never the
// feedback itself - every gesture here also answers visually.
export function haptic(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {}
}

// How far something moves when dragged past where it can go. The further you
// pull, the less it gives, so a sheet can never be dragged off the top of the
// screen and the limit is felt rather than hit.
export function rubberBand(offset: number, dimension: number, constant = 0.55): number {
  if (offset <= 0 || dimension <= 0) return offset;
  return (1 - 1 / ((offset * constant) / dimension + 1)) * dimension;
}

// Where the last tap happened, so a sheet can grow out of the row that opened
// it instead of appearing from the bottom of the screen.
//
// Read from a capture-phase pointerdown, before React's own handlers and
// before any state changes, and kept for a second - long enough for the sheet
// that the tap opens, short enough that an unrelated sheet doesn't inherit it.
type Origin = { rect: DOMRect; at: number };
let lastOrigin: Origin | null = null;
let listening = false;

const MORPH_FROM = "[data-morph], .list-row, .cat-pill, .tile, .card, button, a";

function remember(e: PointerEvent) {
  const el = (e.target as Element | null)?.closest?.(MORPH_FROM);
  if (!el) return;
  lastOrigin = { rect: el.getBoundingClientRect(), at: performance.now() };
}

export function watchOrigins() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("pointerdown", remember, { capture: true, passive: true });
}

export function takeOrigin(maxAgeMs = 1000): DOMRect | null {
  const origin = lastOrigin;
  lastOrigin = null;
  if (!origin || performance.now() - origin.at > maxAgeMs) return null;
  return origin.rect;
}

// The transform that puts `panel` exactly where `from` is, so releasing it to
// its own position reads as one continuous movement. Scaled on one axis only:
// matching both would squash the sheet's content, and a sheet is always the
// full width of the screen on a phone anyway.
export function morphFrom(panel: DOMRect, from: DOMRect): string {
  const scale = Math.max(0.2, Math.min(1, from.width / Math.max(panel.width, 1)));
  const dx = from.left + from.width / 2 - (panel.left + panel.width / 2);
  const dy = from.top + from.height / 2 - (panel.top + panel.height / 2);
  return `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
}

// Reading an easing token out of the stylesheet, so JS-driven motion uses the
// exact same spring as CSS-driven motion. Falls back to a bezier if the
// browser cannot parse linear() - the Web Animations API throws on an easing
// it does not understand, and a sheet that cannot animate must still open.
export function ease(token: "enter" | "settle" | "press" | "page"): string {
  if (typeof window === "undefined") return "ease-out";
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--ease-${token}`).trim();
  return value || "cubic-bezier(0.22, 1, 0.36, 1)";
}

// One spring, run by the browser rather than by us.
//
// This used to be "set the start, wait a frame, set the end", which is fine
// until frames stop coming - a backgrounded tab, a phone that has locked -
// and then the element is left stranded at the start of a movement that never
// ran. An animation object cannot be stranded: it knows where it should be
// whenever the page is shown again, and it hands the element back to the
// stylesheet when it finishes.
export function springTo(
  el: HTMLElement,
  from: Keyframe,
  to: Keyframe,
  ms: number,
  token: "enter" | "settle" | "press" | "page" = "enter"
): Animation | null {
  if (typeof el.animate !== "function") return null;
  try {
    return el.animate([from, to], { duration: ms, easing: ease(token), fill: "none" });
  } catch {
    try {
      return el.animate([from, to], { duration: ms, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "none" });
    } catch {
      return null;
    }
  }
}
