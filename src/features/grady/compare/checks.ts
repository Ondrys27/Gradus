/**
 * Format checks of one compared answer (step 28.9): deterministic, no model.
 * Each job lists the checks that matter for it (server/compare.ts): every
 * answer must be there and not cut off; a job that answers JSON must parse
 * with the job's own schema; a text job must fit its length, stay plain
 * text when the bubble shows plain text, and answer in the sample's
 * language; the summaries keep their shape.
 */

export const CHECK_KEYS = [
  "answered",
  "complete",
  "json",
  "length",
  "plain",
  "language",
  "shape",
] as const;
export type CheckKey = (typeof CHECK_KEYS)[number];
export type CheckResult = { key: CheckKey; ok: boolean };

export type CheckSpec = {
  /** The job answers one JSON object: true when the job's parser accepts it. */
  json?: (text: string) => boolean;
  /** The most characters the job keeps (the rest is cut off when saved). */
  maxChars?: number;
  /** Plain text without markdown headings, bold or tables (a bubble or an e-mail). */
  plain?: boolean;
  /** The answer should be in the sample's language (text jobs). */
  language?: boolean;
  /** A job-specific shape (three lines, numbered points…). */
  shape?: (text: string) => boolean;
};

const CZECH_LETTERS = /[ěščřžýáíéůúťďň]/i;
const CZECH_SHARE = 0.12;

/** Czech text has its letters; an English answer has none of them in its own words. */
export function looksLikeLanguage(text: string, lang: "cs" | "en"): boolean {
  // Names and quotes from the data may carry Czech letters into an English answer: count them.
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const czech = words.filter((word) => CZECH_LETTERS.test(word)).length;
  // Czech prose has these letters in well over a tenth of its words; names alone stay below.
  const share = czech / words.length;
  return lang === "cs" ? share >= CZECH_SHARE : share < CZECH_SHARE;
}

/** Markdown the plain-text jobs must not write: headings, bold, tables. */
export function hasMarkdown(text: string): boolean {
  return /(^|\n)\s{0,3}#{1,6}\s|\*\*[^*]+\*\*|(^|\n)\s*\|.*\|\s*(\n|$)/.test(text);
}

export function runChecks(
  spec: CheckSpec,
  answer: { text: string; stopReason: string | null | undefined; lang: "cs" | "en" },
): CheckResult[] {
  const text = answer.text.trim();
  const results: CheckResult[] = [
    { key: "answered", ok: text.length > 0 },
    { key: "complete", ok: answer.stopReason !== "max_tokens" },
  ];
  if (spec.json) results.push({ key: "json", ok: !!text && spec.json(text) });
  if (spec.maxChars !== undefined) results.push({ key: "length", ok: text.length <= spec.maxChars });
  if (spec.plain) results.push({ key: "plain", ok: !!text && !hasMarkdown(text) });
  if (spec.language) results.push({ key: "language", ok: looksLikeLanguage(text, answer.lang) });
  if (spec.shape) results.push({ key: "shape", ok: !!text && spec.shape(text) });
  return results;
}

/** Share of the checks that passed, 0–1; null without checks. */
export function passShare(results: readonly CheckResult[]): number | null {
  if (!results.length) return null;
  return results.filter((result) => result.ok).length / results.length;
}

/** At most `max` non-empty lines. */
export const atMostLines = (max: number) => (text: string) =>
  text.split("\n").filter((line) => line.trim()).length <= max;

/** Lines starting with "1.", "2." and "3." (the summaries' three things). */
export function hasThreePoints(text: string): boolean {
  return ["1.", "2.", "3."].every((point) =>
    text.split("\n").some((line) => line.trim().startsWith(point)),
  );
}
