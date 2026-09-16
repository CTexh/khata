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
// `additive` stacks this movement on top of whatever is already moving the
// element rather than replacing it - a sheet that grows while it is still
// opening does both at once, instead of one cancelling the other.
export function springTo(
  el: HTMLElement,
  from: Keyframe,
  to: Keyframe,
  ms: number,
  token: "enter" | "settle" | "press" | "page" = "enter",
  additive = false
): Animation | null {
  if (typeof el.animate !== "function") return null;
  const options: KeyframeAnimationOptions = { duration: ms, easing: ease(token), fill: "none" };
  if (additive) options.composite = "add";
  try {
    return el.animate([from, to], options);
  } catch {
    // Either the easing or additive composition was refused; drop both rather
    // than the animation.
    try {
      return el.animate([from, to], { duration: ms, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "none" });
    } catch {
      return null;
    }
  }
}
