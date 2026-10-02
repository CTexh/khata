// When each card of an arriving page lands, under Velvet: in reading order, by
// where it actually is on the screen - the top first, the left a moment before
// the right - so a page assembles from the top down however it is laid out.
// Anything far below the fold lands soon after the rest rather than waiting.
// Seconds, rounded to the millisecond, for a CSS custom property.
export function landingAt(top: number, left: number, viewHeight: number, viewWidth: number): number {
  const down = Math.min(1.3, Math.max(0, top / (viewHeight || 800)));
  const across = Math.min(1, Math.max(0, left / (viewWidth || 400)));
  return Math.round((0.04 + down * 0.42 + across * 0.05) * 1000) / 1000;
}
