import { z } from "zod";

/**
 * What Jarvis noticed, shared by the server (which writes jarvis_suggestions)
 * and the panel (which shows them). Rule suggestions are worded by the panel
 * from `jarvis.suggestion.<type>` with the stored params, so they follow the
 * interface language; insights and automatic actions carry Jarvis's own text.
 */

export const RULE_TYPES = [
  "dealWon",
  "followUps",
  "stalledDeal",
  "overdueTask",
  "milestoneReady",
] as const;
export type RuleType = (typeof RULE_TYPES)[number];
export type SuggestionType = RuleType | "taskCompleted" | "insight";

export function isRuleType(type: string): type is RuleType {
  return (RULE_TYPES as readonly string[]).includes(type);
}

/** Won deals are celebrated for a week, then the suggestion goes. */
export const WON_RECENT_DAYS = 7;
/** A task this many days past its deadline is worth a nudge. */
export const OVERDUE_AFTER_DAYS = 3;
/** Insights of the watch are about the moment; they go after a few days. */
export const INSIGHT_TTL_DAYS = 3;
/** At most this many suggestions of one kind at once. */
export const PER_RULE_LIMIT = 3;

/** Places in the app an action may open; nothing outside them. */
export const APP_PATHS = [
  "/dashboard",
  "/milestones",
  "/pipeline",
  "/contacts",
  "/cold-calling",
  "/calendar",
  "/finance",
] as const;

export function isAppHref(href: string): boolean {
  if (!/^\/[A-Za-z0-9\-/?=&_]*$/.test(href) || href.includes("//")) return false;
  return APP_PATHS.some(
    (path) => href === path || href.startsWith(`${path}/`) || href.startsWith(`${path}?`),
  );
}

const paramsSchema = z.record(z.string(), z.union([z.string(), z.number()])).optional();

export const suggestionActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open"), href: z.string().refine(isAppHref), params: paramsSchema }),
  // An empty prompt means the panel words it from `jarvis.suggestion.<type>.prompt`.
  z.object({ kind: z.literal("ask"), prompt: z.string().max(500), params: paramsSchema }),
  z.object({
    kind: z.literal("undoTask"),
    taskId: z.uuid(),
    previousStatus: z.enum(["todo", "in_progress"]),
    params: paramsSchema,
  }),
]);
export type SuggestionAction = z.infer<typeof suggestionActionSchema>;

export type Suggestion = {
  id: string;
  type: SuggestionType;
  text: string;
  action: SuggestionAction;
  seen: boolean;
  createdAt: string;
};

/** GET /api/jarvis?view=suggestions */
export type SuggestionsResponse = { suggestions: Suggestion[] };

// ---------------------------------------------------------------------------
// Rules: the instant triggers, evaluated without waiting for the watch.
// ---------------------------------------------------------------------------

export type RuleInputs = {
  wonDeals: { id: string; title: string; contactName: string | null }[];
  followUps: { total: number; firstName: string | null; tableId: string | null; today: string };
  stalledDeals: {
    id: string;
    title: string;
    stageName: string;
    enteredStageAt: string;
    days: number;
  }[];
  overdueTasks: {
    id: string;
    title: string;
    milestoneId: string;
    dueDate: string;
    daysLate: number;
  }[];
  readyMilestones: { id: string; title: string }[];
};

export type RuleSuggestion = {
  type: RuleType;
  dedupeKey: string;
  /** Stored for the record; the panel words rule suggestions itself. */
  text: string;
  action: SuggestionAction;
};

export function ruleSuggestions(inputs: RuleInputs): RuleSuggestion[] {
  const out: RuleSuggestion[] = [];

  for (const deal of inputs.wonDeals.slice(0, PER_RULE_LIMIT)) {
    out.push({
      type: "dealWon",
      dedupeKey: `dealWon:${deal.id}`,
      text: `Deal won: ${deal.title}`,
      action: {
        kind: "ask",
        prompt: "",
        params: { deal: deal.title, contact: deal.contactName ?? "" },
      },
    });
  }

  if (inputs.followUps.total > 0) {
    const { tableId } = inputs.followUps;
    out.push({
      type: "followUps",
      dedupeKey: `followUps:${inputs.followUps.today}`,
      text: `${inputs.followUps.total} contacts to follow up today`,
      action: {
        kind: "open",
        href: tableId ? `/contacts?table=${tableId}` : "/dashboard",
        params: { count: inputs.followUps.total, name: inputs.followUps.firstName ?? "" },
      },
    });
  }

  for (const deal of inputs.stalledDeals.slice(0, PER_RULE_LIMIT)) {
    out.push({
      type: "stalledDeal",
      // A deal that moves on and stalls again is a new event.
      dedupeKey: `stalledDeal:${deal.id}:${deal.enteredStageAt.slice(0, 10)}`,
      text: `Deal stalled: ${deal.title}`,
      action: {
        kind: "ask",
        prompt: "",
        params: { deal: deal.title, stage: deal.stageName, days: deal.days },
      },
    });
  }

  for (const task of inputs.overdueTasks.slice(0, PER_RULE_LIMIT)) {
    out.push({
      type: "overdueTask",
      dedupeKey: `overdueTask:${task.id}:${task.dueDate}`,
      text: `Task overdue: ${task.title}`,
      action: {
        kind: "open",
        href: `/milestones/${task.milestoneId}`,
        params: { task: task.title, days: task.daysLate },
      },
    });
  }

  // Finishing a milestone is always the user's own act; Jarvis only points to it.
  for (const milestone of inputs.readyMilestones.slice(0, PER_RULE_LIMIT)) {
    out.push({
      type: "milestoneReady",
      dedupeKey: `milestoneReady:${milestone.id}`,
      text: `All tasks done: ${milestone.title}`,
      action: {
        kind: "open",
        href: `/milestones/${milestone.id}`,
        params: { milestone: milestone.title },
      },
    });
  }

  return out;
}

/** Whole days between two instants, rounded down. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/** Whole days between two calendar dates (YYYY-MM-DD). */
export function calendarDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
