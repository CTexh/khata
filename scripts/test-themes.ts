// The themes, the script that applies one before the first paint, and the
// arithmetic behind Velvet's tilt.
// Run with: node --experimental-strip-types scripts/test-themes.ts
import {
  THEMES,
  THEME_INIT_SCRIPT,
  THEME_KEY,
  parseTheme,
  revealRadius,
} from "../src/lib/themes.ts";
import { MAX_TILT, PRESS_TILT, countAt, formatAmount, parseAmount, tiltAt } from "../src/lib/velvet-motion.ts";
import { landingAt } from "../src/lib/velvet-stage.ts";

let pass = 0;
let fail = 0;
function check(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL ${label}\n     got: ${JSON.stringify(got)}  want: ${JSON.stringify(want)}`);
  }
}

/* ---------- which themes there are ---------- */

check("three themes offered while Velvet is switched off", THEMES.map((t) => t.value), ["light", "dark", "system"]);
check("every name is different", new Set(THEMES.map((t) => t.label)).size, THEMES.length);
check("nothing carries a tag while Velvet is off", THEMES.filter((t) => t.tag).map((t) => t.value), []);

/* ---------- reading what was saved ---------- */

check("light", parseTheme("light"), "light");
check("dark", parseTheme("dark"), "dark");
check("velvet falls back to system while switched off", parseTheme("velvet"), "system");
check("nothing saved follows the phone", parseTheme(null), "system");
check("nor does a missing value", parseTheme(undefined), "system");
// System is never stored: choosing it removes the saved value.
check("a stored 'system' is the same as none", parseTheme("system"), "system");
check("case matters - this is not ours", parseTheme("Velvet"), "system");
check("a theme from some other version", parseTheme("midnight"), "system");

/* ---------- the script that runs before the first paint ---------- */

type FakeMeta = { name?: string; content?: string; id?: string };
function runInit(stored: string | null, storageThrows = false) {
  const head: FakeMeta[] = [];
  const dataset: Record<string, string> = {};
  const storage = {
    getItem(key: string) {
      if (storageThrows) throw new Error("SecurityError");
      return key === THEME_KEY ? stored : null;
    },
  };
  const doc = {
    documentElement: { dataset },
    head: { prepend: (m: FakeMeta) => head.unshift(m) },
    createElement: () => ({}) as FakeMeta,
  };
  new Function("localStorage", "document", THEME_INIT_SCRIPT)(storage, doc);
  return { theme: dataset.theme ?? null, head };
}

for (const t of ["light", "dark"]) {
  check(`a saved ${t} is on the first frame`, runInit(t).theme, t);
}
check("nothing saved leaves the phone in charge", runInit(null).theme, null);
check("something unknown is ignored", runInit("midnight").theme, null);
check("storage that refuses to be read is not an error", runInit(null, true), { theme: null, head: [] });
check("a stored velvet is ignored while the theme is switched off", runInit("velvet").theme, null);
check("and colours no status bar", runInit("velvet").head, []);
check("Light leaves the status bar to the page", runInit("light").head, []);
check("so does Dark", runInit("dark").head, []);
// The script and the parser must agree on what a theme is.
for (const value of ["light", "dark", "velvet", "system", null, "x"]) {
  const parsed = parseTheme(value);
  check(`script and parser agree on ${JSON.stringify(value)}`, runInit(value).theme, parsed === "system" ? null : parsed);
}

/* ---------- the circle a new theme grows in ---------- */

check("from the middle it reaches the corners", revealRadius(50, 50, 100, 100), Math.hypot(50, 50));
check("from a corner it crosses the whole screen", revealRadius(0, 0, 300, 400), 500);
check("from near one side it reaches the far one", revealRadius(290, 10, 300, 400), Math.hypot(290, 390));

/* ---------- tilt ---------- */

const box = { left: 100, top: 200, width: 400, height: 200 };
const at = (fx: number, fy: number, max = MAX_TILT) =>
  tiltAt(box.left + fx * box.width, box.top + fy * box.height, box, max);

check("dead centre is flat", at(0.5, 0.5), { rx: 0, ry: 0, glx: 0, gly: 0, px: 0, py: 0 });
// rotateY tips the left edge toward the viewer for a positive angle, so the
// right edge comes forward for a negative one.
check("pointing at the right edge turns it toward you", at(1, 0.5).ry, -MAX_TILT);
check("and the left edge the other way", at(0, 0.5).ry, MAX_TILT);
// rotateX tips the bottom edge forward for a positive angle.
check("pointing at the bottom turns it toward you", at(0.5, 1).rx, MAX_TILT);
check("and the top the other way", at(0.5, 0).rx, -MAX_TILT);
check("a corner leans both ways at once", [at(1, 1).rx, at(1, 1).ry], [MAX_TILT, -MAX_TILT]);
check("a point past the edge leans no further", at(3, -2), at(1, 0));

const pressed = tiltAt(box.left + box.width, box.top + box.height / 2, box, -PRESS_TILT);
check("a finger presses the side it is on away from you", pressed.ry, PRESS_TILT);
check("and leans less than a mouse does", Math.abs(pressed.ry) < MAX_TILT, true);

check("the glow follows the point", [at(1, 0.5).glx, at(0.5, 0).gly], [120, -60]);
check("and the numbers drift toward it", [at(1, 1).px, at(0, 0).py], [4, -4]);
check("same whichever way the surface leans", tiltAt(500, 400, box, -PRESS_TILT).glx, at(1, 1).glx);

check(
  "a surface with no size does not lean (and is not NaN)",
  tiltAt(10, 10, { left: 0, top: 0, width: 0, height: 0 }, MAX_TILT),
  { rx: 0, ry: 0, glx: 0, gly: 0, px: 0, py: 0 }
);
check("values are kept short for the style string", at(0.333, 0.777).ry, 2.34);
check("never negative zero", Object.is(at(0.5, 0.5).ry, -0), false);

/* ---------- figures that count up ---------- */

check("a bare figure", parseAmount("6,174"), { prefix: "", value: 6174, decimals: 0, suffix: "" });
check("with the currency in front", parseAmount("Rs 23,000"), { prefix: "Rs ", value: 23000, decimals: 0, suffix: "" });
check("negative, as the app writes it", parseAmount("−Rs 500"), { prefix: "−Rs ", value: 500, decimals: 0, suffix: "" });
check("with paisa", parseAmount("Rs 1,234.50"), { prefix: "Rs ", value: 1234.5, decimals: 2, suffix: "" });
check("no separators", parseAmount("23000"), { prefix: "", value: 23000, decimals: 0, suffix: "" });
check("zero", parseAmount("0")?.value, 0);
check("a word is not a figure", parseAmount("All paid"), null);
check("nor is nothing", parseAmount(""), null);
check("nor is a missing text", parseAmount(null), null);
check("two figures are not one", parseAmount("3 of 4"), null);

const rs = parseAmount("Rs 23,000")!;
check("shown as the app shows money", formatAmount(rs, 23000), "Rs 23,000");
check("at any value in between", formatAmount(rs, 1234), "Rs 1,234");
check("from nothing", formatAmount(rs, 0), "Rs 0");
check("paisa kept to the places shown", formatAmount(parseAmount("1,234.50")!, 617.25), "617.25");
// It must end on exactly what the page wrote, or a count would leave the
// page showing a figure of its own.
for (const text of ["6,174", "Rs 23,000", "Rs 3,379", "492,325", "Rs 1,234.50", "0"]) {
  const a = parseAmount(text)!;
  check(`round trip: ${text}`, formatAmount(a, a.value), text);
}

check("a count starts where it starts", countAt(0, 6174, 0), 0);
check("and ends exactly on the figure", countAt(0, 6174, 1), 6174);
check("before the start is the start", countAt(0, 6174, -0.5), 0);
check("after the end is the end", countAt(0, 6174, 1.7), 6174);
check("quick off the mark", countAt(0, 1000, 0.1) > 400, true);
check("and slow into the figure", countAt(0, 1000, 0.9) > 995, true);
check("whole rupees while counting", Number.isInteger(countAt(0, 6174, 0.37)), true);
check("never past the figure on the way up", countAt(0, 10, 0.999), 10);
check("counting down works too", countAt(24523, 6174, 1), 6174);
check("never past the figure on the way down", countAt(24523, 6174, 0.6) >= 6174, true);
check("and paisa where there are paisa", countAt(0, 10.5, 1, 1), 10.5);

/* ---------- when each card lands ---------- */

check("the top of the screen lands first", landingAt(0, 0, 800, 400), 0.04);
check("further down lands later", landingAt(400, 0, 800, 400) > landingAt(100, 0, 800, 400), true);
check("left before right on the same row", landingAt(400, 0, 800, 400) < landingAt(400, 200, 800, 400), true);
check("far below the fold does not wait for ever", landingAt(9000, 0, 800, 400), landingAt(1040, 0, 800, 400));
check("something scrolled past lands at once", landingAt(-500, 0, 800, 400), 0.04);
check("no screen size to measure is not an error", Number.isFinite(landingAt(100, 10, 0, 0)), true);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
