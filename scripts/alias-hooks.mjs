// Resolves "@/lib/db" to src/lib/db.ts, the same mapping tsconfig's paths gives
// Next.js.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  }
  return nextResolve(specifier, context);
}
