// Swiping a row open, and what happens when the finger lifts.
// Run with: node --experimental-strip-types scripts/test-swipe.ts
import { CONFIRM_PX, REVEAL_PX, direction, offsetWhileDragging, settle } from "../src/lib/swipe.ts";

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

/* ---------- which way the finger is going ---------- */

check("a barely-moved finger has not decided", direction(3, 2), "unknown");
check("mostly sideways is a swipe", direction(-30, 4), "across");
check("mostly downwards is a scroll", direction(4, 30), "down");
check("a diagonal leaning down scrolls", direction(-20, 26), "down");
check("scrolling up is still scrolling", direction(2, -40), "down");

/* ---------- following the finger ---------- */

check("a shut row follows a pull left", offsetWhileDragging(0, -40), -40);
check("an open row starts from where it is", offsetWhileDragging(-REVEAL_PX, -20), -(REVEAL_PX + 20));
check("it cannot be pulled far past the button", offsetWhileDragging(0, -400), -(REVEAL_PX + 24));
check("and hardly moves to the right", offsetWhileDragging(0, 100), 15);
check("closing an open row works normally", offsetWhileDragging(-REVEAL_PX, 40), -(REVEAL_PX - 40));

/* ---------- where it lands ---------- */

check("pulled most of the way, it opens", settle(-60, 0), -REVEAL_PX);
check("pulled a little, it shuts again", settle(-20, 0), 0);
check("a quick flick opens it from nowhere", settle(-12, -0.9), -REVEAL_PX);
check("a flick back shuts it", settle(-90, 0.9), 0);
check("exactly halfway opens", settle(-REVEAL_PX / 2, 0), -REVEAL_PX);

check("the question needs more room than the button", CONFIRM_PX > REVEAL_PX, true);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
