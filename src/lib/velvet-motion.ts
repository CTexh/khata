// Velvet's sense of depth: a surface leans toward the mouse as if lit from
// where it points, and presses in under a finger. Started by
// components/VelvetMotion only while Velvet is the theme and Reduce Motion is
// off; nothing here runs, or is even downloaded, otherwise.
//
// All it does is write a few custom properties on the one surface being
// touched. CSS turns them into a transform - rotation for the surface, a shift
// for its glow and its numbers - so every frame is composited and nothing is
// laid out or painted again. The spring back is a CSS transition, which keeps
// running smoothly even while the page is busy.

// How far a surface leans: further under a mouse, which hovers and can be
// watched, than under a finger, which is there for a moment and covers it.
export const MAX_TILT = 7;
export const PRESS_TILT = 3.5;
// How far a pressed surface gives.
export const PRESS_SCALE = 0.985;
// How far the numbers on a surface move against it, which is what makes them
// look as if they float above it.
const FLOAT_PX = 8;

export type Tilt = {
  /** Rotation about the horizontal axis, degrees. */
  rx: number;
  /** Rotation about the vertical axis, degrees. */
  ry: number;
  /** Where the glow sits, as an offset from its resting place, px. */
  glx: number;
  gly: number;
  /** How far the content floats against the surface, px. */
  px: number;
  py: number;
};

type Box = { left: number; top: number; width: number; height: number };

const clamp = (v: number) => Math.max(-0.5, Math.min(0.5, v));
// Two decimals is finer than any screen shows, and keeps the style string short.
const round = (v: number) => Math.round(v * 100) / 100 + 0;

// The tilt for a point on a surface. With a positive angle the side being
// pointed at turns toward the viewer, the way a card turns to look at what
// points at it - right for a mouse. With a negative one it gives way instead,
// as a cushion does under a finger. Either way the glow follows the point and
// the numbers drift toward it.
//
// rotateX tips the bottom edge toward the viewer for a positive angle, and
// rotateY the left edge, so a point low and to the right needs rx > 0, ry < 0.
export function tiltAt(clientX: number, clientY: number, box: Box, maxDeg: number): Tilt {
  if (!(box.width > 0) || !(box.height > 0)) return { rx: 0, ry: 0, glx: 0, gly: 0, px: 0, py: 0 };
  const x = clamp((clientX - box.left) / box.width - 0.5);
  const y = clamp((clientY - box.top) / box.height - 0.5);
  return {
    rx: round(y * 2 * maxDeg),
    ry: round(-x * 2 * maxDeg),
    glx: round(x * box.width * 0.6),
    gly: round(y * box.height * 0.6),
    px: round(x * FLOAT_PX),
    py: round(y * FLOAT_PX),
  };
}

/* ---------- the page ---------- */

// The surfaces that lean: the summary at the top of every section, the cards
// that open something, and the theme cards themselves.
const SURFACES = ".hero-panel, a.card, .theme-card";
const VARS = ["--rx", "--ry", "--glx", "--gly", "--px", "--py", "--press"];

function write(el: HTMLElement, t: Tilt, press: number) {
  const s = el.style;
  s.setProperty("--rx", `${t.rx}deg`);
  s.setProperty("--ry", `${t.ry}deg`);
  s.setProperty("--glx", `${t.glx}px`);
  s.setProperty("--gly", `${t.gly}px`);
  s.setProperty("--px", `${t.px}px`);
  s.setProperty("--py", `${t.py}px`);
  s.setProperty("--press", String(press));
  // Quick to follow while it is being moved; the slow, springing return is the
  // default the moment this comes off.
  el.dataset.tilting = "";
}

function settle(el: HTMLElement | null) {
  if (!el) return;
  for (const name of VARS) el.style.removeProperty(name);
  delete el.dataset.tilting;
}

const surfaceOf = (target: EventTarget | null) =>
  target instanceof Element ? target.closest<HTMLElement>(SURFACES) : null;

export function startVelvetMotion(): () => void {
  // The mouse: whichever surface is under it leans, once a frame.
  let hovered: HTMLElement | null = null;
  // Measured flat, as the pointer arrives. The box of a tilted surface changes
  // with its own tilt, and measuring it every frame would chase its own tail.
  let box: Box | null = null;
  let x = 0;
  let y = 0;
  let mousePress = 1;
  let frame = 0;
  // A finger: the surface it came down on.
  let pressed: HTMLElement | null = null;

  const draw = () => {
    frame = 0;
    if (hovered && box) write(hovered, tiltAt(x, y, box, MAX_TILT), mousePress);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  const leave = () => {
    settle(hovered);
    hovered = null;
    box = null;
    mousePress = 1;
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const el = surfaceOf(e.target);
    if (el !== hovered) {
      leave();
      if (!el) return;
      hovered = el;
      box = el.getBoundingClientRect();
    }
    x = e.clientX;
    y = e.clientY;
    schedule();
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse") {
      if (!hovered) return;
      mousePress = PRESS_SCALE;
      schedule();
      return;
    }
    const el = surfaceOf(e.target);
    if (!el) return;
    settle(pressed);
    pressed = el;
    // Pressed in, not turned toward: the negative angle.
    write(el, tiltAt(e.clientX, e.clientY, el.getBoundingClientRect(), -PRESS_TILT), PRESS_SCALE);
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerType === "mouse") {
      if (mousePress === 1) return;
      mousePress = 1;
      schedule();
      return;
    }
    // A finger that lifts, slides off into a scroll (the browser cancels the
    // pointer then) or leaves the screen: the surface springs back.
    settle(pressed);
    pressed = null;
  };

  // The page moving under a still mouse leaves the measurement behind.
  const onScroll = () => {
    if (hovered) leave();
  };
  const root = document.documentElement;

  const passive = { passive: true } as const;
  document.addEventListener("pointermove", onMove, passive);
  document.addEventListener("pointerdown", onDown, passive);
  document.addEventListener("pointerup", onUp, passive);
  document.addEventListener("pointercancel", onUp, passive);
  root.addEventListener("pointerleave", leave, passive);
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });

  return () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerdown", onDown);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
    root.removeEventListener("pointerleave", leave);
    window.removeEventListener("scroll", onScroll, { capture: true });
    if (frame) cancelAnimationFrame(frame);
    leave();
    settle(pressed);
    pressed = null;
  };
}
