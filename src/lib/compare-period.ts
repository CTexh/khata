// Comparing a period that is still running with the one before it.
//
// A month in progress must be measured against the same days of the month
// before, not against a whole finished one - otherwise every month looks like
// a fall until its last day. Home did this from the start; the expenses page
// compared against the whole previous month, so the two screens said opposite
// things about the same figure.
//
// Pure, so scripts/test-compare-period.ts can check the awkward dates: the
// 31st against a 30-day month, the 29th of a leap February, and January
// reaching back into the year before.

export const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const lastDayOf = (year: number, monthIndex: number) => new Date(year, monthIndex + 1, 0).getDate();

// The same day of the previous month or year. Where that day does not exist -
// the 31st of a 30-day month, the 29th of February in an ordinary year - it is
// the last day of that month, so the comparison covers the whole of it rather
// than spilling into the next.
export function sameDayBefore(now: Date, scope: "month" | "year"): string {
  if (scope === "year") {
    const year = now.getFullYear() - 1;
    const day = Math.min(now.getDate(), lastDayOf(year, now.getMonth()));
    return ymd(new Date(year, now.getMonth(), day));
  }
  const monthIndex = now.getMonth() - 1;
  const year = monthIndex < 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = (monthIndex + 12) % 12;
  return ymd(new Date(year, month, Math.min(now.getDate(), lastDayOf(year, month))));
}

// Whether the period being looked at is still running, so the comparison has
// to stop at the same point. On the last day of a month, or of a year, the
// period is complete and is compared with a complete one.
export function isPartial(now: Date, scope: "month" | "year", year: number, month: number): boolean {
  if (scope === "year") {
    if (year !== now.getFullYear()) return false;
    return !(now.getMonth() === 11 && now.getDate() === 31);
  }
  if (year !== now.getFullYear() || month !== now.getMonth() + 1) return false;
  return now.getDate() !== lastDayOf(now.getFullYear(), now.getMonth());
}
