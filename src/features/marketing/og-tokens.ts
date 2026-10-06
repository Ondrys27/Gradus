/**
 * Colours of the Open Graph image. Satori draws it without CSS, so it cannot
 * read the `@theme` variables; these are the default theme's values from
 * globals.css, and a test keeps them equal.
 */
export const OG_TOKENS = {
  canvas: "#070b1f",
  grid: "#141a3c",
  violet: "#7c5cff",
  teal: "#2fe3c8",
  ink: "#ffffff",
  inkSoft: "#aeb8de",
} as const;

/** The CSS variable each colour comes from. */
export const OG_TOKEN_SOURCES: Record<keyof typeof OG_TOKENS, string> = {
  canvas: "--color-canvas",
  grid: "--color-grid",
  violet: "--color-violet",
  teal: "--color-teal",
  ink: "--color-ink",
  inkSoft: "--color-ink-soft",
};
