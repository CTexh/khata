// How a category looks: the colours behind its icon in list rows. The icon
// itself is drawn in components/CategoryIcon.tsx.
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
