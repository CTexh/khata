// How a category looks: its colours and an emoji for list rows.
//
// Category colours live in globals.css as --cat-<slug>-bg/fg, defined once per
// theme. Reading them as CSS variables means the badge is correct on the very
// first paint: nothing here has to know whether the app is in dark mode, which
// is what used to make these colours disagree with the server-rendered HTML.
// The var() fallback covers categories with no palette entry of their own.
export function categorySlug(category?: string | null): string {
  return (category ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function categoryVars(category?: string | null): { bg: string; fg: string } {
  const slug = categorySlug(category);
  if (!slug) return { bg: "var(--cat-default-bg)", fg: "var(--cat-default-fg)" };
  return {
    bg: `var(--cat-${slug}-bg, var(--cat-default-bg))`,
    fg: `var(--cat-${slug}-fg, var(--cat-default-fg))`,
  };
}

const EMOJI: Record<string, string> = {
  uncategorised: "❔",
  family: "👨‍👩‍👧",
  donations: "🤲",
  groceries: "🛒",
  "food-dining": "🍽️",
  car: "🚗",
  tech: "💻",
  shopping: "🛍️",
  "personal-care": "💈",
  entertainment: "🎬",
  medical: "💊",
  subscriptions: "🔁",
  investment: "📈",
  rent: "🏠",
  "bills-utilities": "💡",
};

// A few words that give a user-made category a fitting emoji too.
const WORDS: [RegExp, string][] = [
  [/travel|flight|hotel|trip/, "✈️"],
  [/fuel|petrol/, "⛽"],
  [/mobile|phone|load/, "📱"],
  [/educ|school|fee|book/, "🎓"],
  [/gift/, "🎁"],
  [/pet/, "🐾"],
  [/gym|fitness|sport/, "🏋️"],
  [/cloth|fashion/, "👕"],
  [/salary|income/, "💼"],
];

export function categoryEmoji(category?: string | null): string {
  const slug = categorySlug(category);
  if (!slug) return "❔";
  if (EMOJI[slug]) return EMOJI[slug];
  return WORDS.find(([re]) => re.test(slug))?.[1] ?? "🧾";
}
