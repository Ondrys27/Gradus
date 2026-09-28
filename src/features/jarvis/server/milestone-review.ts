import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { streamModel, type ModelCall, type ModelClient } from "./model";

type Client = SupabaseClient<Database>;

export type ReviewedMilestone = {
  title: string;
  description: string | null;
  category: string;
  target_date: string | null;
};

/**
 * The review task placed after the cached persona. The instruction not to
 * invent criticism for a good milestone is deliberate and must stay.
 */
export function milestoneReviewContext(
  milestone: ReviewedMilestone,
  today: string,
  locale: string,
): string {
  return `<task>
The user has just created a milestone. Review its quality in 2 to 4 sentences of plain text, no list, no heading.
Judge three things: is it specific (clear what "done" means), is it measurable (a number, a result or an obvious finish line), and does it have a realistic deadline.
If the milestone is good, say plainly that it is good and why in one or two sentences, and stop. Do not invent criticism, do not add "but" or "you could also", do not suggest changes for the sake of it.
If something important is missing, name at most the one or two things that matter most and give a concrete better wording or number the user can take over.
Write in the interface language (${locale}) unless the milestone is clearly written in another language; then use that one. Speak to the user directly.
</task>
<milestone>
Title: "${milestone.title}"
Description: ${milestone.description ? `"${milestone.description}"` : "none"}
Category: ${milestone.category}
Deadline: ${milestone.target_date ?? "none"}
Today: ${today}
</milestone>`;
}

export const MAX_FEEDBACK_LENGTH = 1200;

/**
 * Sonnet reviews a new milestone once; the feedback is written to
 * milestones.ai_feedback with the admin client (the column is server-only),
 * always filtered by the session's user id.
 */
export async function reviewMilestone(args: {
  client: ModelClient;
  admin: Client;
  userId: string;
  milestoneId: string;
  milestone: ReviewedMilestone;
  today: string;
  locale: string;
  log: ModelCall["log"];
}) {
  const result = await streamModel({
    client: args.client,
    feature: "milestone_review",
    context: milestoneReviewContext(args.milestone, args.today, args.locale),
    messages: [{ role: "user", content: "Review my new milestone." }],
    log: args.log,
  });
  if (!result.ok) return result;

  const feedback = result.text.trim().slice(0, MAX_FEEDBACK_LENGTH);
  const { error } = await args.admin
    .from("milestones")
    .update({ ai_feedback: feedback, ai_feedback_at: new Date().toISOString() })
    .eq("id", args.milestoneId)
    .eq("user_id", args.userId);
  if (error) throw error;
  return { ...result, text: feedback };
}
