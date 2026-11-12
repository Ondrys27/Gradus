import { z } from "zod";
import { MAX_FILES_PER_MESSAGE, type FileKind } from "./files";
import type { ProactiveKind, SummaryPeriod } from "./proactive";
import { OWNER_INSTRUCTIONS_MAX } from "./rules";
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

/** Other jobs of /api/grady besides the chat (POST with a `kind`). */
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
/** Branches for one node of a mind map note; the route reads the map itself with the user's client. */
export const NOTE_MAP_REQUEST_MAX = 300;
export const noteMapSuggestRequestSchema = z.object({
  kind: z.literal("noteMapSuggest"),
  noteId: z.uuid(),
  nodeId: z.string().min(1).max(64),
  request: z.string().max(NOTE_MAP_REQUEST_MAX).optional(),
});
/** Longest received e-mail Grady reads to draft a reply. */
export const RECEIVED_EMAIL_MAX = 8000;
export const emailReplyRequestSchema = z.object({
  kind: z.literal("emailReply"),
  contactId: z.uuid(),
  dealId: z.uuid().nullish(),
  receivedEmail: z.string().trim().min(1).max(RECEIVED_EMAIL_MAX),
});

/** How the user reacted to Grady speaking up on his own; `shown` is logged by the bubble itself. */
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

/** Settings → Integrations: one short question to check that Grady answers. */
export const pingRequestSchema = z.object({ kind: z.literal("ping") });

/** The longest test message of the rules' "Try it". */
export const RULES_TEST_MESSAGE_MAX = 500;

/**
 * Administration → AI and Grady → Rules → "Try it": one message to Grady
 * with the instructions as they stand in the form (saved or not), so the
 * owner sees what they change before saving them.
 */
export const rulesTestRequestSchema = z.object({
  kind: z.literal("rulesTest"),
  instructions: z.string().max(OWNER_INSTRUCTIONS_MAX * 2),
  message: z.string().trim().min(1).max(RULES_TEST_MESSAGE_MAX),
});

/** POST /api/grady { kind: "rulesTest" }: the answer, or why it did not come. */
export type RulesTestResult =
  | { ok: true; text: string; durationMs: number; costUsd: number; model: string }
  | { ok: false; code: ChatErrorCode | "invalid"; durationMs: number | null };

/** Thumb up/down on one of Grady's own answers; sending the same rating again clears it. */
export const RATINGS = ["up", "down"] as const;
export type Rating = (typeof RATINGS)[number];
export const rateMessageRequestSchema = z.object({
  kind: z.literal("rateMessage"),
  messageId: z.uuid(),
  rating: z.enum(RATINGS),
});

/** POST /api/grady { kind: "ping" }; the time is measured on the server around the model call. */
export type PingResult =
  | { ok: true; durationMs: number; costUsd: number; model: string }
  | { ok: false; code: ChatErrorCode; durationMs: number | null; usage?: AiCallUsage };

/** A file shown on a message. */
export type ChatAttachment = { id: string; name: string; kind: FileKind };

export type AiCallUsage = { used: number; limit: number };

/** Why a reply did not come; each has its own text in `grady.error.*`. */
export type ChatErrorCode =
  | "limitReached"
  | "notConfigured"
  /**
   * Grady takes a break until the month ends: the monthly budget is used up
   * or the API has run out of credit. The rest of the app works on.
   */
  | "paused"
  /**
   * This user's own monthly AI cap (set in the administration) is used up or
   * AI is blocked for them. The rest of the app works on.
   */
  | "userLimit"
  /**
   * The company the user works in has used up its monthly AI cap (its owner
   * pays for the calls made there). The rest of the app works on.
   */
  | "spaceLimit"
  | "busy"
  | "unavailable"
  | "notFound"
  | "network"
  | "unknown"
  | FileErrorCode;

/** Why attached files were refused; nothing of the message is saved then. */
export type FileErrorCode =
  "fileType" | "fileTooLarge" | "fileUnreadable" | "fileMissing" | "fileLimit";

/** Lines of the NDJSON stream from POST /api/grady. */
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

/** Chips offered in the panel, chosen from the user's situation. Text in `grady.chip.*`. */
export const SUGGESTION_KEYS = [
  "planDay",
  "planNext",
  "followUps",
  "stalledDeals",
  "overdueTasks",
  "overdueCrmTasks",
  "overdueInvoices",
  "nextMilestoneStep",
  "firstMilestone",
  "firstDeal",
  "monthFinance",
  "startCalling",
] as const;
export type SuggestionKey = (typeof SUGGESTION_KEYS)[number];

/** GET /api/grady */
export type GradyOverview = {
  usage: AiCallUsage;
  /** Files attached this month and the plan's monthly number. */
  files: { used: number; limit: number };
  suggestions: SuggestionKey[];
};

/** One of the things Grady brings up on his own (GET /api/grady?view=proactive). */
export type ProactiveItem = {
  id: string;
  kind: ProactiveKind;
  /** A suggestion type, or "briefing" / "question". */
  type: string;
  text: string;
  action: SuggestionAction;
  /** Proposed tasks, to preview and add only on the user's confirmation. */
  tasks: string[];
  /** A question: its key in GRADY_QUESTIONS. */
  questionKey: string | null;
  createdAt: string;
};

export type ProactiveResponse = {
  /** The queue of one appearance, most urgent first; empty when there is nothing to say. */
  items: ProactiveItem[];
  /** When asking again makes sense (e.g. the 4-hour gap ends); null = the usual interval. */
  retryAt: string | null;
  /**
   * How long a page must settle before Grady appears, by the rules of the
   * administration; the browser keeps it for the next pages.
   */
  settleMs?: number;
};

/**
 * What a summary links to, one row each, counted from the data at the moment
 * it is shown (never from what the text says). The label is
 * `grady.summary.links.<key>` with the count.
 */
export const SUMMARY_LINK_KEYS = [
  "overdueCrmTasks",
  "todayCrmTasks",
  "periodCrmTasks",
  "overdueTasks",
  "events",
  "closePast",
  "overdueDealTasks",
  "noTask",
  "overdueInvoices",
  "followUps",
] as const;
export type SummaryLinkKey = (typeof SUMMARY_LINK_KEYS)[number];
export type SummaryLink = { key: SummaryLinkKey; count: number; href: string };

/** The summary at the first arrival of the day, week or month (GET /api/grady?view=summary). */
export type SummaryItem = {
  /** Its row in jarvis_suggestions (kind briefing): the reactions go there. */
  id: string;
  period: SummaryPeriod;
  text: string;
  links: SummaryLink[];
};

export type SummaryResponse =
  /** Show it now; the bubble reports "shown", which settles the period. */
  | { status: "show"; item: SummaryItem }
  /** Not now (quiet hours, the call timer): ask again on the next page. */
  | { status: "wait" }
  /** Nothing to show in this period (already shown, nothing to say, off): stop asking. */
  | { status: "none" };

/** POST /api/grady { kind: "milestoneReview" } and { kind: "salesAnalysis" } */
export type JobResult<T> =
  ({ ok: true } & T) | { ok: false; code: ChatErrorCode | "locked" | "alreadyReviewed" | "empty" };

/** Sales analysis unlocks after this many meeting surveys. */
export const SALES_ANALYSIS_MIN_SURVEYS = 5;
