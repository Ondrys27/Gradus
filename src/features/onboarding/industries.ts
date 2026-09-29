/**
 * Branches offered in onboarding step 2. The key only selects which sample
 * texts step 4 (first milestone) suggests; visible text lives in
 * `onboarding.industries.<key>.*` in en.json/cs.json.
 */
export const INDUSTRY_KEYS = [
  "realEstate",
  "coaching",
  "ecommerce",
  "trades",
  "freelanceIt",
  "agency",
  "other",
] as const;

export type IndustryKey = (typeof INDUSTRY_KEYS)[number];

export const DEFAULT_INDUSTRY: IndustryKey = "other";

/** Falls back to "other" for anything not in the list (e.g. an older or foreign value). */
export function industryKeyOf(value: string | null | undefined): IndustryKey {
  return (INDUSTRY_KEYS as readonly string[]).includes(value ?? "")
    ? (value as IndustryKey)
    : DEFAULT_INDUSTRY;
}

/** The three suggested task translation keys for an industry's first milestone. */
export const SUGGESTED_TASK_KEYS = ["task1", "task2", "task3"] as const;
