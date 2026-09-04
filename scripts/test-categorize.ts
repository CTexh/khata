import { matchRuleCategory, normalizeVendor, canonicalCategory } from "../src/lib/categorize.ts";

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (ok) pass++;
  else {
    fail++;
    console.log(`FAIL ${label}\n     got: ${JSON.stringify(actual)}  want: ${JSON.stringify(expected)}`);
  }
}

/* --- family: should match despite feed mangling --- */
const familyShouldMatch: [string, string][] = [
  ["Ijaz Ahmad Chatta", "clean full name"],
  ["IJAZ AHMAD CHATT", "truncated surname, uppercase"],
  ["Ijaz A Chatta (Meezan)", "initial + wallet suffix"],
  ["Ijaz Ahmad Chatta (Bank Al Habib)", "bank suffix"],
  ["ijaz ahmad chatta", "lowercase"],
  ["Huda Ijaz", "clean"],
  ["HUDA IJAZ (Easypaisa)", "wallet"],
  ["Huda Ijaz (JazzCash)", "wallet 2"],
  ["Habib Ullah", "clean"],
  ["HABIBULLAH", "run together"],
  ["Habib Ullah (NayaPay)", "wallet"],
  ["H Ullah", "initial + real surname"],
];
for (const [vendor, label] of familyShouldMatch) {
  check(`family "${vendor}" (${label})`, matchRuleCategory(vendor, ""), "Family");
}

/* --- family terms as payee --- */
check('payee "Mom"', matchRuleCategory("Mom", ""), "Family");
check('payee "Ammi"', matchRuleCategory("Ammi", ""), "Family");
check('payee "Bhai"', matchRuleCategory("Bhai", ""), "Family");

/* --- family: must NOT match --- */
const familyShouldNotMatch: [string, string][] = [
  ["Bank Al Habib", "bank name containing 'habib'"],
  ["Al Habib Bank Ltd", "bank name variant"],
  ["Habib Metro", "different bank"],
  ["Muhammad Din Ph", "unrelated person"],
  ["M.Rizwan (NayaPay)", "unrelated person"],
  ["Arshad Mahmood (JazzCash)", "unrelated person"],
  ["Jameel Masih (Easypaisa)", "unrelated person"],
  ["S.Parveen", "unrelated person"],
  ["Euro Store Crow", "shop"],
  ["H U", "initials only - too weak"],
  ["Dahi", "yogurt vendor"],
];
for (const [vendor, label] of familyShouldNotMatch) {
  const got = matchRuleCategory(vendor, "");
  check(`NOT family "${vendor}" (${label})`, got === "Family" ? "Family" : "not-family", "not-family");
}

/* --- note should also catch a family name --- */
check("family named in note", matchRuleCategory("Meezan Bank", "sent to Habib Ullah"), "Family");
// but a relationship word in a note must NOT flip it
check("'gift for mom' note stays uncategorised", matchRuleCategory("Maryum n Maria", "gift for mom"), null);

/* --- car --- */
const carVendors = [
  "PSO Filling Station",
  "Shell Pump Gulberg",
  "Total Parco",
  "Car disk brake",
  "Tyre puncture shop",
  "Suzuki Motors",
  "Toyota Indus Motor",
  "Car Wash",
  "Motorway toll",
  "Parking",
];
for (const v of carVendors) check(`car "${v}"`, matchRuleCategory(v, ""), "Car");
check("car via note", matchRuleCategory("Cash", "petrol for the car"), "Car");
check("car via note 'engine oil'", matchRuleCategory("Random Shop", "engine oil"), "Car");

/* --- car must not over-fire --- */
check("NOT car: grocery", matchRuleCategory("Euro Food Town", ""), "Groceries");
check("NOT car: coffee", matchRuleCategory("Coffee Planet", ""), null);

/* --- vendor normalisation --- */
check("normalize wallet suffix", normalizeVendor("Jameel Masih (Easypaisa)"), "jameel masih");
check("normalize case", normalizeVendor("EURO STORE CROW"), "euro store crow");
check("normalize punctuation", normalizeVendor("M.Rizwan (NayaPay)"), "m rizwan");
check(
  "same vendor different case -> same key",
  normalizeVendor("Euro Store Crow") === normalizeVendor("euro  store   CROW"),
  true
);

/* --- canonical categories --- */
check("Grocery -> Groceries", canonicalCategory("Grocery"), "Groceries");
check("Groceries -> Groceries", canonicalCategory("Groceries"), "Groceries");
check("Food & dining -> Food & Dining", canonicalCategory("Food & dining"), "Food & Dining");
check("Food & Dining stays", canonicalCategory("Food & Dining"), "Food & Dining");
check("Bills -> Bills & Utilities", canonicalCategory("Bills"), "Bills & Utilities");
check("Bill Payment -> Bills & Utilities", canonicalCategory("Bill Payment"), "Bills & Utilities");
check("Rents -> Rent", canonicalCategory("Rents"), "Rent");
check("Car parts -> Car", canonicalCategory("Car parts"), "Car");
check("Pharmacy -> Medical", canonicalCategory("Pharmacy"), "Medical");
check("Subscriptions preserved (cron writes this)", canonicalCategory("Subscriptions"), "Subscriptions");
check("unknown passes through", canonicalCategory("Goat Feed"), "Goat Feed");
check("empty -> null", canonicalCategory(""), null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
