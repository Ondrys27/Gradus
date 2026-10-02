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
