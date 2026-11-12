import type { LocalizedText } from "./types";
import { localized } from "./types";

/**
 * The assistant's skills (level rewards) were seeded into unlock_definitions
 * while he was called Jarvis, and their descriptions still say so. The keys
 * stay (DB name kept from Jarvis); the app shows these texts instead, under
 * `game.skillText.<name>`, until the rows are reworded.
 */
export const RENAMED_SKILL_TEXT: Readonly<Record<string, string>> = {
  jarvis_morning_brief: "morningBrief",
  jarvis_weekly_analysis: "weeklyAnalysis",
  jarvis_industry_advice: "industryAdvice",
};

/** The description of an unlockable thing in the interface language. */
export function unlockDescription(
  key: string,
  text: LocalizedText | null | undefined,
  locale: string,
  t: (key: string) => string,
): string {
  const renamed = RENAMED_SKILL_TEXT[key];
  return renamed ? t(`skillText.${renamed}`) : localized(text, locale);
}
