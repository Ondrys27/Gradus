/**
 * Print colours of the invoice documents. An invoice is paper, not the app:
 * it stays black on white whatever theme the app uses, so these are fixed
 * values for the PDF and its preview only, never for the app's interface.
 */
export const PRINT = {
  paper: "#FFFFFF",
  ink: "#15171C",
  soft: "#3D424D",
  muted: "#737985",
  hairline: "#E4E6EA",
  rule: "#C9CDD4",
  fill: "#F3F4F6",
  block: "#14171F",
  blockSoft: "#A9AFBC",
  blockLine: "#2A2F3B",
} as const;

export const FONT_SANS = "InvoiceSans";
export const FONT_SERIF = "InvoiceSerif";

/** The bundled fonts with the full Czech alphabet (IBM Plex, SIL Open Font License). */
export const FONT_FILES = [
  { family: FONT_SANS, weight: 400, file: "IBMPlexSans-Regular.ttf" },
  { family: FONT_SANS, weight: 600, file: "IBMPlexSans-SemiBold.ttf" },
  { family: FONT_SANS, weight: 700, file: "IBMPlexSans-Bold.ttf" },
  { family: FONT_SERIF, weight: 400, file: "IBMPlexSerif-Regular.ttf" },
  { family: FONT_SERIF, weight: 600, file: "IBMPlexSerif-SemiBold.ttf" },
] as const;

/** Where the browser loads them for the preview (public/fonts/invoice). */
export const FONT_URL_BASE = "/fonts/invoice";

/** A4 in points. */
export const PAGE = { width: 595.28, height: 841.89 } as const;
