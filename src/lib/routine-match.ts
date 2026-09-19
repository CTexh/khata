// The rules the email routine used to apply by reading a month of expenses
// and comparing them itself. They live here now, as plain code, so the server
// can apply them on the routine's behalf: the routine sends what it found and
// never has to download the month to check it.

// A Gmail message id: hex, as the Gmail API returns it. Anything else is
// refused rather than stored.
export function isMessageId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(id);
}

function normVendor(v: string | null | undefined): string {
  return (v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Same payee: one name contained in the other, either way round, ignoring
// case and punctuation - "PSO" and "PSO LAHORE", "Coffee Planet" and
// "COFFEE PLANET LHR CITY PK". An entry typed without a payee counts as
// matching: someone who logged the payment by hand and skipped the vendor
// field still logged this payment.
export function vendorsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normVendor(a);
  const y = normVendor(b);
  if (!x || !y) return true;
  return x.includes(y) || y.includes(x);
}

export type Comparable = { amount: number; date: string; vendor: string | null };

// The routine's duplicate rule: same amount, same day, same payee.
export function isSameExpense(a: Comparable, b: Comparable): boolean {
  return Math.abs(a.amount - b.amount) < 0.005 && a.date === b.date && vendorsMatch(a.vendor, b.vendor);
}
