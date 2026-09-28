import { z } from "zod";

/** Longest message a user can send; the panel stops typing there too. */
export const MAX_MESSAGE_LENGTH = 4000;

export const chatRequestSchema = z.object({
  conversationId: z.uuid().nullish(),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export type AiCallUsage = { used: number; limit: number };

/** Why a reply did not come; each has its own text in `jarvis.error.*`. */
export type ChatErrorCode =
  "limitReached" | "notConfigured" | "busy" | "unavailable" | "notFound" | "network" | "unknown";

/** Lines of the NDJSON stream from POST /api/jarvis. */
export type ChatEvent =
  | { type: "start"; conversationId: string; userMessageId: string }
  | { type: "delta"; text: string }
  | { type: "done"; messageId: string; usage: AiCallUsage }
  | { type: "error"; code: ChatErrorCode; usage?: AiCallUsage };

/** Chips offered in the panel, chosen from the user's situation. Text in `jarvis.chip.*`. */
export const SUGGESTION_KEYS = [
  "planDay",
  "followUps",
  "stalledDeals",
  "overdueTasks",
  "nextMilestoneStep",
  "firstMilestone",
  "firstDeal",
  "monthFinance",
  "startCalling",
] as const;
export type SuggestionKey = (typeof SUGGESTION_KEYS)[number];

/** GET /api/jarvis */
export type JarvisOverview = { usage: AiCallUsage; suggestions: SuggestionKey[] };
