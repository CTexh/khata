// The arithmetic behind swiping a row open, kept apart from the component so
// scripts/test-swipe.ts can check it without a browser.

// How far a row slides to show its Delete button, and again to ask whether you
// meant it.
export const REVEAL_PX = 96;
export const CONFIRM_PX = 168;

// Which way a finger is going. Until that is known the row must not move at
// all, or a scroll down a list drags every row it passes.
export type Direction = "unknown" | "across" | "down";

export function direction(dx: number, dy: number, slop = 8): Direction {
  if (Math.abs(dx) < slop && Math.abs(dy) < slop) return "unknown";
  return Math.abs(dx) > Math.abs(dy) ? "across" : "down";
}

// Where the row sits while a finger is on it. Left is negative. It can be
// pulled a little past the button as resistance, and barely follows a pull to
// the right, because there is nothing over there.
export function offsetWhileDragging(openAt: number, dx: number, max = REVEAL_PX): number {
  const raw = openAt + dx;
  if (raw > 0) return raw * 0.15;
  return Math.max(raw, -(max + 24));
}

// Where it settles when the finger lifts: open if it was pulled most of the
// way, or flicked; shut otherwise.
export function settle(offset: number, velocity: number, max = REVEAL_PX): number {
  if (velocity < -0.45) return -max;
  if (velocity > 0.45) return 0;
  return offset <= -max / 2 ? -max : 0;
}
