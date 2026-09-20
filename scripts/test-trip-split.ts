// The trip money: splitting to the paisa, where everyone stands, and the
// settle-up. Run with: node --experimental-strip-types scripts/test-trip-split.ts
import { POT, costToMember, settlementPlan, splitEqually, tripState } from "../src/lib/trip-split.ts";

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
const sum = (ns: number[]) => Math.round(ns.reduce((a, b) => a + b, 0) * 100) / 100;

/* ---------- splitting ---------- */

check("an even split is even", splitEqually(3000, ["a", "b", "c"]), { a: 1000, b: 1000, c: 1000 });
check("one person pays it all", splitEqually(450, ["a"]), { a: 450 });
check("nobody to split between", splitEqually(450, []), {});

// 1000 / 3 is 333.3333…; the odd paisa has to land somewhere.
const odd = splitEqually(1000, ["a", "b", "c"]);
check("the odd paisa goes to the first", odd, { a: 333.34, b: 333.33, c: 333.33 });
check("and the parts add back to the whole", sum(Object.values(odd)), 1000);

const twoOver = splitEqually(30.02, ["a", "b", "c"]);
check("two paisa over, two people get one each", twoOver, { a: 10.01, b: 10.01, c: 10 });
check("still adds back", sum(Object.values(twoOver)), 30.02);
check("a refund splits the same way", sum(Object.values(splitEqually(-1000, ["a", "b", "c"]))), -1000);

/* ---------- where everyone stands ---------- */

const members = [{ id: "me" }, { id: "ali" }, { id: "sara" }];
const deposits = [
  { memberId: "me", amount: 10000 },
  { memberId: "ali", amount: 10000 },
  { memberId: "sara", amount: 10000 },
];

// Everything comes out of the pot and is for everyone: nobody owes anybody.
const evenTrip = tripState({
  members,
  deposits,
  expenses: [{ amount: 30000, paidFrom: "pot", participants: [] }],
});
check("the pot is the budget", [evenTrip.potIn, evenTrip.potSpent, evenTrip.potLeft], [30000, 30000, 0]);
check("an empty tick list means everyone", evenTrip.members.map((m) => m.share), [10000, 10000, 10000]);
check("and nobody is owed anything", evenTrip.members.map((m) => m.net), [0, 0, 0]);

// Money left in the pot comes back to whoever put it in.
const leftOver = tripState({
  members,
  deposits,
  expenses: [{ amount: 15000, paidFrom: "pot", participants: [] }],
});
check("what is left in the pot is owed back", leftOver.members.map((m) => m.net), [5000, 5000, 5000]);
check("and that is exactly what is in it", sum(leftOver.members.map((m) => m.net)), leftOver.potLeft);

// One person pays out of their own pocket for a meal two of them had.
const mixed = tripState({
  members,
  deposits,
  expenses: [
    { amount: 30000, paidFrom: "pot", participants: [] },
    { amount: 3000, paidFrom: "member", payerMemberId: "ali", participants: ["ali", "sara"] },
  ],
});
check("paying out of pocket counts in your favour", mixed.members.map((m) => m.paidOutOfPocket), [0, 3000, 0]);
check("only the two who ate it share it", mixed.members.map((m) => m.share), [10000, 11500, 11500]);
check("so Ali is owed and Sara owes", mixed.members.map((m) => m.net), [0, 1500, -1500]);
check("the trip spent more than the pot held", [mixed.totalSpent, mixed.potSpent], [33000, 30000]);
check("what the trip cost me is my share", costToMember(mixed, "me"), 10000);

// Someone who joined late, deposited nothing and was on nothing.
const bystander = tripState({
  members: [...members, { id: "zain" }],
  deposits,
  expenses: [{ amount: 3000, paidFrom: "pot", participants: ["me", "ali", "sara"] }],
});
check("being on nothing costs nothing", bystander.members[3], {
  memberId: "zain",
  deposited: 0,
  paidOutOfPocket: 0,
  share: 0,
  net: 0,
});
check("an unknown payer's expense still splits", tripState({
  members,
  deposits: [],
  expenses: [{ amount: 300, paidFrom: "member", payerMemberId: "ghost", participants: [] }],
}).members.map((m) => m.share), [100, 100, 100]);

/* ---------- settling up ---------- */

check("nothing to settle when everyone is square", settlementPlan(evenTrip.members, evenTrip.potLeft), []);

const refund = settlementPlan(leftOver.members, leftOver.potLeft);
check("the pot hands its cash back", refund, [
  { from: POT, to: "me", amount: 5000 },
  { from: POT, to: "ali", amount: 5000 },
  { from: POT, to: "sara", amount: 5000 },
]);

check("and whoever owes pays whoever is owed", settlementPlan(mixed.members, mixed.potLeft), [
  { from: "sara", to: "ali", amount: 1500 },
]);

// An awkward one: an empty pot, three debtors and two creditors.
const awkward = tripState({
  members: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
  deposits: [],
  expenses: [
    { amount: 4000, paidFrom: "member", payerMemberId: "a", participants: [] },
    { amount: 2000, paidFrom: "member", payerMemberId: "b", participants: [] },
    { amount: 1000, paidFrom: "member", payerMemberId: "c", participants: ["c", "d"] },
  ],
});
const plan = settlementPlan(awkward.members, awkward.potLeft);
check("everyone owes or is owed something", awkward.members.map((m) => m.net), [2500, 500, -1000, -2000]);
check("the biggest debt is paid to the biggest creditor first", plan, [
  { from: "d", to: "a", amount: 2000 },
  { from: "c", to: "a", amount: 500 },
  { from: "c", to: "b", amount: 500 },
]);
check("and the settle-up balances to zero", sum(plan.map((t) => t.amount)) * 2, sum(awkward.members.map((m) => Math.abs(m.net))));
check("no one pays themselves", plan.every((t) => t.from !== t.to), true);

// Odd paisa across a group must not leave a stray paisa floating.
const paisaTrip = tripState({
  members,
  deposits: [{ memberId: "me", amount: 1000 }],
  expenses: [{ amount: 1000, paidFrom: "pot", participants: [] }],
});
const paisaPlan = settlementPlan(paisaTrip.members, paisaTrip.potLeft);
check("the paisa still balances", sum(paisaTrip.members.map((m) => m.net)), 0);
check("with the smallest possible payments", paisaPlan, [
  { from: "ali", to: "me", amount: 333.33 },
  { from: "sara", to: "me", amount: 333.33 },
]);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
