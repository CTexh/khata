// Assistant replies, as Siri would read them out.
// Run with: node --experimental-strip-types scripts/test-speakable.ts
import { speakable } from "../src/lib/speakable.ts";

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

check(
  "an added expense reads as a sentence",
  speakable("*Expense added*\n\nAmount: Rs 3,000\nCategory: Car\nVendor: Shell\n\nReply *UNDO* to remove it."),
  "Expense added. Amount, 3,000 rupees. Category, Car. Vendor, Shell. Say undo to remove it."
);
check("bold markers are never read out", speakable("*Done*"), "Done.");
check("rupees are said, not spelled", speakable("You spent Rs 12,450 this month."), "You spent 12,450 rupees this month.");
check("a full stop is not doubled", speakable("All paid."), "All paid.");
check("a question keeps its mark", speakable("Which one did you mean?"), "Which one did you mean?");
check("paisa survive", speakable("Rs 333.33 each"), "333.33 rupees each.");
check("an unspaced amount works too", speakable("Rs1,000 left"), "1,000 rupees left.");
check("blank replies stay blank", speakable("   \n\n "), "");
check(
  "several amounts in one line",
  speakable("Ali owes you Rs 2,000 and Sara owes Rs 500."),
  "Ali owes you 2,000 rupees and Sara owes 500 rupees."
);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
