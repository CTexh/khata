// Tests for the rules the server now applies for the email routine: what
// counts as a Gmail message id, and when an imported email is a second copy
// of an expense that is already there.
import { isMessageId, isSameExpense, vendorsMatch } from "../src/lib/routine-match.ts";

let pass = 0;
let fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    console.log(`FAIL ${label}\n     got: ${JSON.stringify(got)}  want: ${JSON.stringify(want)}`);
  }
}

// Message ids, as the Gmail API returns them.
check("a real message id", isMessageId("1a0b6e22d5f4ccb9"), true);
check("too short", isMessageId("abc"), false);
check("a path is not an id", isMessageId("../../etc"), false);
check("an injection is not an id", isMessageId("1' OR 1=1 --"), false);
check("not a string", isMessageId(12345678), false);

// Same payee, either way round, ignoring case and punctuation.
check("short in long", vendorsMatch("PSO", "PSO LAHORE"), true);
check("long in short", vendorsMatch("COFFEE PLANET LHR CITY PK", "Coffee Planet"), true);
check("punctuation ignored", vendorsMatch("Euro-Store, Crow", "euro store crow"), true);
check("different payees", vendorsMatch("Shell", "PSO"), false);
check("a hand-typed entry without a payee still matches", vendorsMatch("PSO LAHORE", null), true);
check("an empty payee still matches", vendorsMatch("", "Daraz"), true);

// The full rule: amount, day and payee.
const email = { amount: 642.6, date: "2026-09-19", vendor: "COFFEE PLANET LHR CITY PK" };
check("the same payment logged by hand", isSameExpense(email, { amount: 642.6, date: "2026-09-19", vendor: "Coffee Planet" }), true);
check("amounts a fraction of a paisa apart", isSameExpense(email, { amount: 642.600001, date: "2026-09-19", vendor: "Coffee Planet" }), true);
check("a different amount", isSameExpense(email, { amount: 642, date: "2026-09-19", vendor: "Coffee Planet" }), false);
check("a different day", isSameExpense(email, { amount: 642.6, date: "2026-09-18", vendor: "Coffee Planet" }), false);
check("a different payee", isSameExpense(email, { amount: 642.6, date: "2026-09-19", vendor: "Gloria Jeans" }), false);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
