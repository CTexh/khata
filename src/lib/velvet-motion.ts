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

/* ---------- numbers that count up ---------- */

// An amount as it is shown - "6,174", "Rs 23,000" - split into what is around
// the number and the number itself, so it can be shown at any value in
// between exactly as the page would have written it.
export type Amount = { prefix: string; value: number; decimals: number; suffix: string };

export function parseAmount(text: string | null | undefined): Amount | null {
  const m = /^(\D*?)(\d{1,3}(?:,\d{2,3})*|\d+)(?:\.(\d+))?(\D*)$/.exec(text ?? "");
  if (!m) return null;
  const value = Number(`${m[2].replace(/,/g, "")}${m[3] ? `.${m[3]}` : ""}`);
  if (!Number.isFinite(value)) return null;
  return { prefix: m[1], value, decimals: m[3]?.length ?? 0, suffix: m[4] };
}

// The same formatting the app uses for money (format.ts), at any value.
export function formatAmount(a: Amount, value: number): string {
  const n = value.toLocaleString("en-PK", {
    minimumFractionDigits: a.decimals,
    maximumFractionDigits: a.decimals,
  });
  return `${a.prefix}${n}${a.suffix}`;
}

// Where a count is after t (0..1) of its run: quick off the mark and easing
// into the final figure, the way an odometer settles. Rounded to what the
// amount can show, and never past either end.
export function countAt(from: number, to: number, t: number, decimals = 0): number {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
  const scale = 10 ** decimals;
  const v = Math.round((from + (to - from) * k) * scale) / scale;
  return to >= from ? Math.min(Math.max(v, from), to) : Math.max(Math.min(v, from), to);
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

// The amounts that count: the big figure on each section's summary, and the
// figures on the cards that open something.
const AMOUNTS = ".hero-panel .tabular > .leading-none, a.card .tabular";
// How long a count runs, and when it starts after a page arrives - as its
// figure lands, not before (velvet.css drops the summary first and lets its
// contents fall onto it).
const COUNT_MS = { hero: 1250, card: 1000 };
const COUNT_AFTER_ARRIVAL_MS = { hero: 560, card: 520 };

export type VelvetMotion = {
  /** A new page has arrived: count its figures up as they land. */
  arrive(): void;
  stop(): void;
};

export function startVelvetMotion(): VelvetMotion {
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

  /* ---------- counting ---------- */
  //
  // The figure is React's text, and React keeps a hold of the very text node
  // it wrote. So the count writes to that same node - never replacing it -
  // and stops the instant anything else writes there: React showing a new
  // value takes over at once, and the count then rolls from wherever it had
  // got to toward the new figure. Every count ends by writing back exactly
  // what React wrote, so the page is never left showing a figure of ours.
  type Count = { frame: number; timer: number; final: string; region: Element | null };
  const counts = new Map<Text, Count>();
  // The last thing written to each figure by a count, to tell our own writes
  // apart from React's when the observer reports them.
  const written = new WeakMap<Text, string>();
  const watched = new Set<Element>();
  const arrived = new WeakSet<Text>();
  let scans: number[] = [];

  const textOf = (el: Element): Text | null =>
    el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE ? (el.firstChild as Text) : null;
  const put = (node: Text, value: string) => {
    written.set(node, value);
    node.nodeValue = value;
  };

  const finish = (node: Text, restore: boolean) => {
    const c = counts.get(node);
    if (!c) return;
    cancelAnimationFrame(c.frame);
    window.clearTimeout(c.timer);
    counts.delete(node);
    if (restore && node.isConnected && node.nodeValue === written.get(node)) put(node, c.final);
    // The summary is a live region; it was told to wait while the figure ran
    // so a screen reader announces the result once, not every step.
    if (c.region && ![...counts.values()].some((o) => o.region === c.region)) c.region.removeAttribute("aria-busy");
  };

  const count = (el: Element, node: Text, from: number, delay: number) => {
    const final = node.nodeValue ?? "";
    const amount = parseAmount(final);
    finish(node, false);
    if (!amount || amount.value === from) return;
    const hero = el.closest(".hero-panel");
    const ms = hero ? COUNT_MS.hero : COUNT_MS.card;
    const region = el.closest("[aria-live]");
    region?.setAttribute("aria-busy", "true");
    // A figure is money, and must never be left showing anything but itself.
    // So nothing is written until the first frame actually runs - a page whose
    // frames never come (hidden, suspended) keeps the real figure - and should
    // the frames stall part-way, this puts the real figure back regardless.
    const timer = window.setTimeout(() => finish(node, true), delay + ms + 400);
    const c: Count = { frame: 0, timer, final, region };
    counts.set(node, c);
    let started = false;
    const begin = performance.now() + delay;
    const step = (now: number) => {
      // Gone, or written by someone else - React showing a new figure before
      // the count began, or during it: that value stands.
      const changed = started ? node.nodeValue !== written.get(node) : node.nodeValue !== final;
      if (!node.isConnected || changed) {
        finish(node, false);
        return;
      }
      started = true;
      const t = (now - begin) / ms;
      if (t >= 1) {
        finish(node, true);
        return;
      }
      put(node, formatAmount(amount, t > 0 ? countAt(from, amount.value, t, amount.decimals) : from));
      c.frame = requestAnimationFrame(step);
    };
    c.frame = requestAnimationFrame(step);
  };

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      const el = (r.target.nodeType === Node.TEXT_NODE ? r.target.parentElement : (r.target as Element))?.closest(AMOUNTS);
      if (!el) continue;
      const node = textOf(el);
      if (!node || node.nodeValue === written.get(node)) continue;
      // React has shown a new figure. Roll to it from whatever was showing -
      // the old figure, a count part-way, or nothing at all (a skeleton).
      const before = r.type === "characterData" ? parseAmount(r.oldValue)?.value ?? 0 : 0;
      arrived.add(node);
      count(el, node, before, 0);
    }
  });

  const scan = (delayed: boolean) => {
    for (const el of document.querySelectorAll(AMOUNTS)) {
      if (!watched.has(el)) {
        watched.add(el);
        observer.observe(el, { childList: true, characterData: true, characterDataOldValue: true, subtree: true });
      }
      const node = textOf(el);
      if (!node || arrived.has(node)) continue;
      arrived.add(node);
      const hero = el.closest(".hero-panel");
      count(el, node, 0, delayed ? (hero ? COUNT_AFTER_ARRIVAL_MS.hero : COUNT_AFTER_ARRIVAL_MS.card) : 0);
    }
  };

  const arrive = () => {
    scans.forEach((t) => window.clearTimeout(t));
    // Once the page has rendered, and twice more for figures whose sections
    // only appear when their data does.
    scans = [0, 300, 900].map((ms, i) => window.setTimeout(() => scan(i === 0), ms));
  };
  arrive();

  return {
    arrive,
    stop() {
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
      scans.forEach((t) => window.clearTimeout(t));
      observer.disconnect();
      // Any figure part-way through a count is put back to the real one.
      for (const node of [...counts.keys()]) finish(node, true);
      watched.clear();
    },
  };
}
