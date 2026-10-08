import { z } from "zod";
import { MAX_FILES_PER_MESSAGE, type FileKind } from "./files";
import type { ProactiveKind } from "./proactive";
import type { SuggestionAction } from "./suggestions";

/** Longest message a user can send; the panel stops typing there too. */
export const MAX_MESSAGE_LENGTH = 4000;

/** A file the panel uploaded to the user's folder; the server checks it before use. */
export const attachmentRefSchema = z.object({
  path: z.string().max(200),
  name: z.string().trim().min(1).max(255),
});
export type AttachmentRef = z.infer<typeof attachmentRefSchema>;

export const chatRequestSchema = z
  .object({
    conversationId: z.uuid().nullish(),
    message: z.string().trim().max(MAX_MESSAGE_LENGTH),
    attachments: z.array(attachmentRefSchema).max(MAX_FILES_PER_MESSAGE).default([]),
  })
  .refine((request) => request.message.length > 0 || request.attachments.length > 0, {
    message: "empty",
    path: ["message"],
  });
export type ChatRequest = z.input<typeof chatRequestSchema>;

/** Other jobs of /api/jarvis besides the chat (POST with a `kind`). */
export const milestoneReviewRequestSchema = z.object({
  kind: z.literal("milestoneReview"),
  milestoneId: z.uuid(),
});
export const salesAnalysisRequestSchema = z.object({ kind: z.literal("salesAnalysis") });
/** The reward tree travels as-is; the route checks it against the tree schema. */
export const rewardSetupRequestSchema = z.object({
  kind: z.literal("rewardSetup"),
  tree: z.unknown(),
});
/** Longest received e-mail Jarvis reads to draft a reply. */
export const RECEIVED_EMAIL_MAX = 8000;
export const emailReplyRequestSchema = z.object({
  kind: z.literal("emailReply"),
  contactId: z.uuid(),
  dealId: z.uuid().nullish(),
  receivedEmail: z.string().trim().min(1).max(RECEIVED_EMAIL_MAX),
});

/** How the user reacted to Jarvis speaking up on his own; `shown` is logged by the bubble itself. */
export const PROACTIVE_REACTIONS = ["shown", "open", "accept", "answer", "later", "close"] as const;
export type ProactiveReaction = (typeof PROACTIVE_REACTIONS)[number];

export const proactiveRequestSchema = z.object({
  kind: z.literal("proactive"),
  id: z.uuid(),
  reaction: z.enum(PROACTIVE_REACTIONS),
  /** An option key or a free answer to a question. */
  answer: z.string().max(1000).optional(),
});
export type ProactiveRequest = z.input<typeof proactiveRequestSchema>;

/** Settings → Integrations: one short question to check that Jarvis answers. */
export const pingRequestSchema = z.object({ kind: z.literal("ping") });

/** Thumb up/down on one of Jarvis's own answers; sending the same rating again clears it. */
export const RATINGS = ["up", "down"] as const;
export type Rating = (typeof RATINGS)[number];
export const rateMessageRequestSchema = z.object({
  kind: z.literal("rateMessage"),
  messageId: z.uuid(),
  rating: z.enum(RATINGS),
});

/** POST /api/jarvis { kind: "ping" }; the time is measured on the server around the model call. */
export type PingResult =
  | { ok: true; durationMs: number; costUsd: number; model: string }
  | { ok: false; code: ChatErrorCode; durationMs: number | null; usage?: AiCallUsage };

/** A file shown on a message. */
export type ChatAttachment = { id: string; name: string; kind: FileKind };

export type AiCallUsage = { used: number; limit: number };

/** Why a reply did not come; each has its own text in `jarvis.error.*`. */
export type ChatErrorCode =
  | "limitReached"
  | "notConfigured"
  /** The Anthropic account has run out of credit; only the app's operator can fix it. */
  | "noCredit"
  | "busy"
  | "unavailable"
  | "notFound"
  | "network"
  | "unknown"
  | FileErrorCode;

/** Why attached files were refused; nothing of the message is saved then. */
export type FileErrorCode =
  "fileType" | "fileTooLarge" | "fileUnreadable" | "fileMissing" | "fileLimit";

/** Lines of the NDJSON stream from POST /api/jarvis. */
export type ChatEvent =
  | {
      type: "start";
      conversationId: string;
      userMessageId: string;
      attachments: ChatAttachment[];
    }
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
export type JarvisOverview = {
  usage: AiCallUsage;
  /** Files attached this month and the plan's monthly number. */
  files: { used: number; limit: number };
  suggestions: SuggestionKey[];
};

/** One thing Jarvis brings up on his own (GET /api/jarvis?view=proactive). */
export type ProactiveItem = {
  id: string;
  kind: ProactiveKind;
  /** A suggestion type, or "briefing" / "question". */
  type: string;
  text: string;
  action: SuggestionAction;
  /** Proposed tasks, to preview and add only on the user's confirmation. */
  tasks: string[];
  /** A question: its key in JARVIS_QUESTIONS. */
  questionKey: string | null;
  createdAt: string;
};

export type ProactiveResponse = {
  item: ProactiveItem | null;
  /** When asking again makes sense (e.g. the 4-hour gap ends); null = the usual interval. */
  retryAt: string | null;
};

/** POST /api/jarvis { kind: "milestoneReview" } and { kind: "salesAnalysis" } */
export type JobResult<T> =
  ({ ok: true } & T) | { ok: false; code: ChatErrorCode | "locked" | "alreadyReviewed" | "empty" };

/** Sales analysis unlocks after this many meeting surveys. */
export const SALES_ANALYSIS_MIN_SURVEYS = 5;
