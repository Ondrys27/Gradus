/**
 * The suggestion kinds, without zod, so the client can tell them apart without
 * pulling the validation library into the first load. `suggestions.ts` re-exports these.
 */
export const RULE_TYPES = [
  "dealWon",
  "followUps",
  "stalledDeal",
  "overdueTask",
  "milestoneReady",
] as const;
export type RuleType = (typeof RULE_TYPES)[number];
export type SuggestionType = RuleType | "taskCompleted" | "insight" | "pathReady";

export function isRuleType(type: string): type is RuleType {
  return (RULE_TYPES as readonly string[]).includes(type);
}

/** Words of a call or meeting, for insights written before they carried the flag. */
const REACH_WORDS =
  /\b(call|calls|calling|phone|ring|meet|meeting|meetings|visit)\b|zavolej|zavolat|volat|volání|telefon|schůzk|navštiv/i;

/**
 * Whether a suggestion means reaching other people now (a call, a meeting),
 * which only makes sense inside the time window. Follow-ups always do; an
 * insight says so itself (`people` in its payload), older ones by their words.
 */
export function reachesPeople(type: string, people: boolean | undefined, text: string): boolean {
  if (type === "followUps") return true;
  if (type !== "insight") return false;
  return people ?? REACH_WORDS.test(text);
}
