import type { WidgetMeta } from "./catalog";

/** How many widgets the gallery puts forward. */
export const RECOMMENDED_COUNT = 4;

/**
 * The widgets the gallery suggests first (28.6), by what the person uses:
 * a widget of a section they have opened (not fresh in the menu) comes
 * before one of a section they have not, a widget of a category already on
 * the board before one of a new category, and a widget that needs no
 * section at all (today, Grady, quick actions) after those. What is already
 * on the board is never suggested; ties keep the catalog's order.
 */
export function recommendWidgets(
  available: readonly WidgetMeta[],
  placed: readonly string[],
  usedSections: ReadonlySet<string>,
  limit = RECOMMENDED_COUNT,
): WidgetMeta[] {
  const onBoard = new Set(placed);
  const categories = new Set(
    available.filter((meta) => onBoard.has(meta.key)).map((meta) => meta.category),
  );
  return available
    .filter((meta) => !onBoard.has(meta.key))
    .map((meta, index) => {
      let score = 0;
      if (meta.requires.nav && usedSections.has(meta.requires.nav)) score += 3;
      if (categories.has(meta.category)) score += 2;
      if (!meta.requires.nav) score += 1;
      return { meta, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.meta);
}
