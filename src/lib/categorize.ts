/* ---------- smart expense categorisation (pure, no DB) ----------
 *
 * Three layers decide an expense's category, in priority order:
 *   1. Rules      - family payees + car keywords (this file). Deterministic,
 *                   and strong enough to OVERRIDE whatever category the
 *                   bank/email feed supplied, because the feed calls money
 *                   sent to family "Transfer", which is exactly the thing
 *                   this is meant to fix.
 *   2. Vendor rules - a category the user explicitly picked for this vendor
 *                   before (stored in expense_vendor_rules). Also overrides.
 *   3. Learned    - the category the user has most often used for this same
 *                   vendor historically. Only fills a blank category.
 *
 * Layers 2 and 3 live in db.ts since they need queries; this file holds the
 * deterministic half plus the normalisers both halves share.
 */

/* ---------- canonical categories ---------- */

// The single source of truth. Everything else is folded into one of these so
// "Grocery"/"Groceries" and "Food & dining"/"Food & Dining" stop splitting the
// same spending across two buckets and making monthly totals lie.
export const CATEGORIES = [
  "Family",
  "Transfer",
  "Donations",
  "Groceries",
  "Food & Dining",
  "Car",
  "Tech",
  "Shopping",
  "Personal Care",
  "Entertainment",
  "Medical",
  "Subscriptions",
  "Investment",
  "Rent",
  "Bills & Utilities",
] as const;

export type Category = (typeof CATEGORIES)[number];

// Variants seen in the existing data (and obvious near-misses) mapped onto the
// canonical name. Keys are compared lowercased + whitespace-collapsed.
const CATEGORY_ALIASES: Record<string, Category> = {
  family: "Family",

  donation: "Donations",
  donations: "Donations",
  charity: "Donations",
  zakat: "Donations",
  sadqa: "Donations",
  sadaqah: "Donations",
  khairat: "Donations",

  investment: "Investment",
  investments: "Investment",
  savings: "Investment",
  stocks: "Investment",
  "mutual fund": "Investment",
  gold: "Investment",
  plot: "Investment",

  car: "Car",
  "car parts": "Car",
  "car part": "Car",
  fuel: "Car",
  petrol: "Car",
  vehicle: "Car",
  auto: "Car",

  grocery: "Groceries",
  groceries: "Groceries",
  kiryana: "Groceries",
  supermarket: "Groceries",

  food: "Food & Dining",
  "food & dining": "Food & Dining",
  "food and dining": "Food & Dining",
  dining: "Food & Dining",
  restaurant: "Food & Dining",
  restaurants: "Food & Dining",
  cafe: "Food & Dining",

  bill: "Bills & Utilities",
  bills: "Bills & Utilities",
  "bill payment": "Bills & Utilities",
  "bill payments": "Bills & Utilities",
  utility: "Bills & Utilities",
  utilities: "Bills & Utilities",
  electricity: "Bills & Utilities",
  internet: "Bills & Utilities",

  rent: "Rent",
  rents: "Rent",
  "house rent": "Rent",

  "mobile top-up": "Bills & Utilities",
  "mobile topup": "Bills & Utilities",
  "top-up": "Bills & Utilities",
  topup: "Bills & Utilities",
  "mobile load": "Bills & Utilities",
  easyload: "Bills & Utilities",
  "bank charges": "Bills & Utilities",
  "bank charge": "Bills & Utilities",
  "bank fees": "Bills & Utilities",
  "bank fee": "Bills & Utilities",

  // Buying a thing from a business is Shopping. Deliberately swallows the
  // narrow one-off buckets ("Furniture", "Electronics", "Clothing") so the
  // category list stays short instead of growing a tail of near-duplicates.
  shopping: "Shopping",
  "online shopping": "Shopping",
  clothing: "Shopping",
  clothes: "Shopping",
  apparel: "Shopping",
  garments: "Shopping",
  shoes: "Shopping",
  footwear: "Shopping",
  furniture: "Shopping",
  appliances: "Shopping",
  decor: "Shopping",
  "home decor": "Shopping",
  stationery: "Shopping",
  gifts: "Shopping",

  tech: "Tech",
  electronics: "Tech",
  gadgets: "Tech",
  laptop: "Tech",
  computer: "Tech",
  hardware: "Tech",
  accessories: "Tech",
  headphones: "Tech",

  pharmacy: "Medical",
  health: "Medical",
  healthcare: "Medical",
  medical: "Medical",
  medicine: "Medical",
  doctor: "Medical",
  hospital: "Medical",
  clinic: "Medical",
  lab: "Medical",

  entertainment: "Entertainment",
  movies: "Entertainment",
  cinema: "Entertainment",

  subscription: "Subscriptions",
  subscriptions: "Subscriptions",

  // Person-to-person money the rules can't place. Kept as a real category so
  // unknown transfers are visibly "a transfer I haven't sorted yet" rather
  // than blank, and so they group together for review.
  transfer: "Transfer",
  transfers: "Transfer",
  "mobile wallet transfer": "Transfer",
  "funds transfer": "Transfer",
  ibft: "Transfer",
  raast: "Transfer",

  "personal care": "Personal Care",
  grooming: "Personal Care",
  salon: "Personal Care",
  saloon: "Personal Care",
  barber: "Personal Care",
  haircut: "Personal Care",
  spa: "Personal Care",
  skincare: "Personal Care",
  gym: "Personal Care",
  fitness: "Personal Care",
};

// Folds a free-text category onto the canonical list.
//
// `strict` is for categories that came from the email-sync routine rather than
// from a person. Those are only ever guesses scraped out of a bank message, so
// anything that isn't recognised is dropped, leaving the expense uncategorised
// and waiting for review - that is what stops the feed inventing categories.
// The bank's own "Transfer"/"RAAST" wording does map, so person-to-person money
// the rules can't place lands in Transfer instead of nowhere.
//
// Left non-strict (the default) an unrecognised value is passed through as-is,
// which is how typing a brand-new category in the form creates one.
export function canonicalCategory(
  raw: string | null | undefined,
  strict = false
): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase().replace(/\s+/g, " ");

  const mapped = CATEGORY_ALIASES[key];
  if (mapped) return mapped;

  const exact = CATEGORIES.find((c) => c.toLowerCase() === key);
  if (exact) return exact;

  return strict ? null : trimmed;
}

/* ---------- vendor normalisation ---------- */

// Bank/wallet names that ride along on feed-imported payee strings, e.g.
// "Jameel Masih (Easypaisa)" or "Arshad Mahmood (JazzCash)". Multi-word bank
// names are stripped as phrases FIRST, before tokenising, so that "Bank Al
// Habib" doesn't leave a stray "habib" token behind that would then collide
// with the family member actually named Habib Ullah.
const BANK_PHRASES = [
  "bank al habib",
  "al habib",
  "bank alfalah",
  "standard chartered",
  "allied bank",
  "askari bank",
  "faysal bank",
  "meezan bank",
  "habib metro",
  "js bank",
  "soneri bank",
  "summit bank",
  "bank of punjab",
  "funds transfer",
  "fund transfer",
];

// Single tokens that are unambiguously a wallet/rail, never part of a person's
// name. "habib" is deliberately NOT here (see BANK_PHRASES above).
const BANK_TOKENS = new Set([
  "easypaisa",
  "jazzcash",
  "nayapay",
  "sadapay",
  "meezan",
  "alfalah",
  "hbl",
  "ubl",
  "mcb",
  "abl",
  "nbp",
  "raast",
  "ibft",
  "atm",
  "pos",
  "trf",
  "transfer",
  "payment",
  "to",
  "from",
  "via",
  "mr",
  "mrs",
  "ms",
  "sb",
  "sahib",
]);

// A stable key for "this is the same payee/merchant". Used to look up learned
// categories and stored vendor rules, so "EURO STORE CROWN" and
// "Euro Store Crown" resolve to the same thing.
export function normalizeVendor(raw: string | null | undefined): string {
  return vendorTokens(raw).join(" ");
}

function vendorTokens(raw: string | null | undefined): string[] {
  let s = (raw ?? "").toLowerCase();
  if (!s.trim()) return [];

  // Drop the trailing "(Easypaisa)" / "(NayaPay)" wallet marker.
  s = s.replace(/\([^)]*\)/g, " ");
  for (const phrase of BANK_PHRASES) s = s.replace(new RegExp(phrase, "g"), " ");

  return s
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !BANK_TOKENS.has(t));
}

/* ---------- rule layer: family + car ---------- */

// People whose payments always mean the same thing.
//
// `aliases` exist because banks rarely send a full name. A RAAST transfer to
// Ijaz arrives as "I.AHMED": no surname at all, and "Ahmed" spelled
// differently. Matching the full name alone can never resolve that, so each
// person carries the short forms their transfers actually appear as.
export type PersonRule = { name: string; aliases: string[]; category: Category };

export const PEOPLE: PersonRule[] = [
  {
    name: "Ijaz Ahmad Chatta",
    aliases: ["ijaz ahmad", "ijaz ahmed", "i ahmed", "i ahmad", "ijaz chatta", "ijaz"],
    category: "Family",
  },
  { name: "Huda Ijaz", aliases: ["huda ijaz", "huda"], category: "Family" },
  { name: "Habib Ullah", aliases: ["habib ullah", "habibullah"], category: "Family" },
  { name: "Ansab Bangash", aliases: ["ansab bangash", "ansab"], category: "Donations" },
];

// Kept for the existing tests/imports that reference family names directly.
export const FAMILY_MEMBERS = PEOPLE.filter((p) => p.category === "Family").map((p) => p.name);

// Relationship words that identify a payee as family on their own. Matched
// against the payee/vendor only - never the note - so that a note like
// "gift for mom" stays Shopping instead of becoming Family.
const FAMILY_TERMS = new Set([
  "mom",
  "mama",
  "ammi",
  "ami",
  "abu",
  "abbu",
  "dad",
  "papa",
  "baba",
  "bhai",
  "brother",
  "sister",
  "baji",
  "apa",
]);

// Known merchants whose name alone settles the category. Matched against the
// vendor only - a shop name mentioned in a note is far weaker evidence than
// the payee field actually being that shop. Extend this list as chains repeat.
const MERCHANT_RULES: { keywords: string[]; category: Category }[] = [
  // Every Euro-branded store in this ledger is a grocer: "Euro Store Crow",
  // "Euro Food Town", "Meat Pro Euro S".
  { keywords: ["euro"], category: "Groceries" },

  // Marketplaces and general retail - buying a thing from a brand rather than
  // handing money to a person.
  {
    keywords: [
      "daraz",
      "amazon",
      "aliexpress",
      "alibaba",
      "temu",
      "shein",
      "ebay",
      "olx",
      "khaadi",
      "outfitters",
      "sapphire",
      "gul ahmed",
      "alkaram",
      "bonanza",
      "breakout",
      "limelight",
      "borjan",
      "bata",
      "servis",
      "ikea",
      "interwood",
      "habitt",
    ],
    category: "Shopping",
  },

  // Grooming and fitness places.
  {
    keywords: ["salon", "saloon", "barber", "spa", "grooming", "gym", "fitness"],
    category: "Personal Care",
  },

  // Tech retailers and hardware brands.
  {
    keywords: [
      "apple",
      "samsung",
      "dell",
      "lenovo",
      "asus",
      "xiaomi",
      "logitech",
      "anker",
      "telemart",
      "ishopping",
      "priceoye",
      "symbios",
      "shophive",
      "czone",
      "mega pk",
      "homeshopping",
      "paklap",
      "galaxy",
    ],
    category: "Tech",
  },
];

// Anything that keeps the car running or on the road. Matched against vendor
// and note, since "petrol" typed into the note is as strong a signal as a
// pump's name in the vendor field.
const CAR_KEYWORDS = [
  "fuel",
  "petrol",
  "diesel",
  "cng",
  "pso",
  "shell",
  "parco",
  "attock",
  "byco",
  "hascol",
  "caltex",
  "filling station",
  "petrol pump",
  "tyre",
  "tire",
  "puncture",
  "brake",
  "oil change",
  "engine oil",
  "mobil",
  "mechanic",
  "workshop",
  "denting",
  "car wash",
  "carwash",
  "spare part",
  "auto part",
  "wheel",
  "clutch",
  "suzuki",
  "toyota",
  "honda",
  "indus motor",
  "service station",
  "garage",
  "parking",
  "toll",
  "motorway",
  "m-tag",
  "mtag",
];

// Soundex. Names in this ledger arrive spelled however the sending bank felt
// that day - Ahmad/Ahmed, Chatta/Chattha, Habib/Habeeb - and soundex collapses
// exactly that kind of vowel/doubled-consonant variation onto one code.
function soundex(token: string): string {
  const s = token.toUpperCase().replace(/[^A-Z]/g, "");
  if (!s) return "";
  const code = (ch: string) =>
    "BFPV".includes(ch) ? "1"
    : "CGJKQSXZ".includes(ch) ? "2"
    : "DT".includes(ch) ? "3"
    : ch === "L" ? "4"
    : "MN".includes(ch) ? "5"
    : ch === "R" ? "6"
    : "";

  let out = s[0];
  let prev = code(s[0]);
  for (const ch of s.slice(1)) {
    const c = code(ch);
    // H and W are transparent: they don't break a run of the same code.
    if (c && c !== prev) out += c;
    if (!"HW".includes(ch)) prev = c;
    if (out.length === 4) break;
  }
  return (out + "000").slice(0, 4);
}

// True when one vendor token plausibly stands for one name token.
function tokenMatches(vendorTok: string, nameTok: string): boolean {
  if (vendorTok === nameTok) return true;
  // Initials: a lone "i" stands in for "ijaz".
  if (vendorTok.length === 1) return nameTok.startsWith(vendorTok);
  // Truncation in either direction, once there's enough to be meaningful.
  const shorter = vendorTok.length < nameTok.length ? vendorTok : nameTok;
  if (shorter.length >= 3 && (vendorTok.startsWith(nameTok) || nameTok.startsWith(vendorTok))) {
    return true;
  }
  // Spelling variants of the same name.
  return shorter.length >= 3 && soundex(vendorTok) === soundex(nameTok);
}

// True when `vendorToks` plausibly names `target`, tolerant of how bank feeds
// mangle names: truncation ("Ijaz Ahmad Chatt"), initials ("Ijaz A Chatta"),
// wallet suffixes, and run-together spellings ("Habibullah").
//
// Every token of the target must be accounted for, and at least one match must
// be a real word rather than a bare initial - so "H U" never counts as Habib
// Ullah. Short forms are handled by giving each person explicit aliases rather
// than by loosening this, which would start matching unrelated people.
function nameMatches(vendorToks: string[], target: string): boolean {
  const targetToks = vendorTokens(target);
  if (!targetToks.length || !vendorToks.length) return false;

  // "habibullah" written as one word still matches "Habib Ullah".
  if (vendorToks.join("").includes(targetToks.join(""))) return true;

  let strongMatches = 0;
  for (const nt of targetToks) {
    const hit = vendorToks.find((vt) => tokenMatches(vt, nt));
    if (!hit) return false;
    if (hit.length >= 3) strongMatches++;
  }
  return strongMatches >= 1;
}

// A person matches on their full name or on any of their registered aliases.
function matchesPerson(vendorToks: string[], person: PersonRule): boolean {
  if (nameMatches(vendorToks, person.name)) return true;
  return person.aliases.some((a) => nameMatches(vendorToks, a));
}

// Layer 1. Returns a canonical category when a deterministic rule fires,
// otherwise null. This result outranks whatever the feed said.
export function matchRuleCategory(
  vendor: string | null | undefined,
  note: string | null | undefined
): Category | null {
  const vendorToks = vendorTokens(vendor);
  const haystack = `${vendor ?? ""} ${note ?? ""}`.toLowerCase();

  if (vendorToks.some((t) => FAMILY_TERMS.has(t))) return "Family";

  const noteToks = vendorTokens(note);
  for (const person of PEOPLE) {
    // The payee field is the strong signal; a name written into the note
    // ("sent to Habib Ullah") counts too.
    if (matchesPerson(vendorToks, person)) return person.category;
    if (matchesPerson(noteToks, person)) return person.category;
  }

  if (CAR_KEYWORDS.some((k) => haystack.includes(k))) return "Car";

  const vendorText = vendorToks.join(" ");
  for (const m of MERCHANT_RULES) {
    if (m.keywords.some((k) => vendorText.includes(k))) return m.category;
  }

  return null;
}
