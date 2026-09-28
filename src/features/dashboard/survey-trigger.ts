import type { Stage } from "@/features/pipeline/types";

/** The stage where a first meeting has taken place and is being followed up. */
export const MEETING_STAGE_KEY = "meeting";

/**
 * A deal that leaves the meeting stage for a later one has had its meeting, so the
 * user is asked how it went. Moving back or sideways to an earlier stage is not asked.
 */
export function offersMeetingSurvey(
  from: Pick<Stage, "id" | "system_key" | "position"> | undefined,
  to: Pick<Stage, "id" | "position">,
): boolean {
  return from?.system_key === MEETING_STAGE_KEY && from.id !== to.id && to.position > from.position;
}
