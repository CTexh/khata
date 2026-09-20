// What a form says when the server refuses, or when there is no server to ask.
// Run with: node --experimental-strip-types scripts/test-submit.ts
import { OFFLINE_MESSAGE, failureMessage } from "../src/lib/submit.ts";

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

// What the server says always wins: it knows what was actually wrong.
check("the server's own words are used", failureMessage(400, "Amount must be a positive number"), "Amount must be a positive number");
check("even on a server error", failureMessage(500, "The database is asleep"), "The database is asleep");
check("blank explanations are ignored", failureMessage(400, "   "), "Something went wrong. Please try again.");
check("so are non-strings", failureMessage(400, { message: "no" }), "Something went wrong. Please try again.");

check("being signed out says so", failureMessage(401), "You've been signed out. Log in again and retry.");
check("a missing record says so", failureMessage(404), "That's gone — it may have been deleted already.");
check("a clash asks for a refresh", failureMessage(409), "That has changed since you opened it. Refresh and try again.");
check("a server fault is not the user's fault", failureMessage(503), "Khata couldn't save that just now. Please try again.");
check("and an odd status still says something", failureMessage(418), "Something went wrong. Please try again.");

// The one that matters on a phone: no signal at all.
check("offline is plain about what happened", OFFLINE_MESSAGE.includes("Nothing was saved"), true);
check("and tells you what to do", OFFLINE_MESSAGE.includes("try again"), true);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
