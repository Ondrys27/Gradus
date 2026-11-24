/**
 * The jobs "Compare models" offers (step 28.9), without their samples: the
 * administration's form imports this in the browser, the samples stay on
 * the server (samples.ts). A test checks it matches samples.ts.
 */
export const COMPARE_FEATURE_KEYS = [
  "chat",
  "milestone_review",
  "classify",
  "opportunity_scan",
  "analysis",
  "email_reply",
  "briefing",
  "period_summary",
  "note_map_suggest",
  "meeting_notes",
] as const;
export type CompareFeatureKey = (typeof COMPARE_FEATURE_KEYS)[number];

export function isCompareFeatureKey(feature: string): feature is CompareFeatureKey {
  return (COMPARE_FEATURE_KEYS as readonly string[]).includes(feature);
}
