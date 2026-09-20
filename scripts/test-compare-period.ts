// Comparing a month or year still in progress with the one before it.
// Run with: node --experimental-strip-types scripts/test-compare-period.ts
import { isPartial, sameDayBefore } from "../src/lib/compare-period.ts";

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
// Local time, like the screens that use this.
const on = (y: number, m: number, d: number) => new Date(y, m - 1, d);

/* ---------- the same day of the month before ---------- */

check("an ordinary day", sameDayBefore(on(2026, 9, 20), "month"), "2026-08-20");
check("the first of the month", sameDayBefore(on(2026, 9, 1), "month"), "2026-08-01");
check("January reaches back a year", sameDayBefore(on(2026, 1, 14), "month"), "2025-12-14");

// The days that do not exist in the month before.
check("the 31st against a 30-day month", sameDayBefore(on(2026, 5, 31), "month"), "2026-04-30");
check("the 31st against February", sameDayBefore(on(2026, 3, 31), "month"), "2026-02-28");
check("the 30th against February", sameDayBefore(on(2026, 3, 30), "month"), "2026-02-28");
check("and against a leap February", sameDayBefore(on(2024, 3, 31), "month"), "2024-02-29");

/* ---------- the same day of the year before ---------- */

check("a year back", sameDayBefore(on(2026, 9, 20), "year"), "2025-09-20");
check("29 February has no counterpart", sameDayBefore(on(2024, 2, 29), "year"), "2023-02-28");
check("but it does four years on", sameDayBefore(on(2025, 2, 28), "year"), "2024-02-28");

/* ---------- is the period still running? ---------- */

check("mid-month is partial", isPartial(on(2026, 9, 20), "month", 2026, 9), true);
check("the last day of the month is not", isPartial(on(2026, 9, 30), "month", 2026, 9), false);
check("nor is the last day of February", isPartial(on(2026, 2, 28), "month", 2026, 2), false);
check("a leap February runs a day longer", isPartial(on(2024, 2, 28), "month", 2024, 2), true);
check("a month already finished is not partial", isPartial(on(2026, 9, 20), "month", 2026, 8), false);
check("nor is one in another year", isPartial(on(2026, 9, 20), "month", 2025, 9), false);

check("this year is partial", isPartial(on(2026, 9, 20), "year", 2026, 9), true);
check("on new year's eve it is not", isPartial(on(2026, 12, 31), "year", 2026, 12), false);
check("last year is not partial", isPartial(on(2026, 9, 20), "year", 2025, 1), false);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
