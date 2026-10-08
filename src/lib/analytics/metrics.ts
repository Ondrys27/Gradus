import { DEFAULT_FORMAT_SETTINGS, todayIsoDate, type IsoDate } from "@/lib/format";
import type { EventName } from "./events";
import type { AnalyticsSection } from "./routes";

/**
 * The registry of every metric in docs/metrics.md. The administration builds
 * its pages only from here: what a metric is called (translation keys under
 * `metrics.items.<key>` in both languages), its category, unit, how it is
 * computed (which SQL function of 20261008120000_metrics.sql with which
 * arguments) and which segments it supports.
 *
 * Compute kinds:
 * - `daily`: one of metric_daily_keys(), read with metric_series() (finished
 *   days from metrics_daily, today live)
 * - `event` / `breakdown` / `percentiles`: metric_event_series(),
 *   metric_event_breakdown(), metric_event_percentiles() over one catalog event
 * - `ratio`: an event count over the sum of others, for the whole range
 * - `breakdown_ratio`: the same, per group of a breakdown
 * - `function`: a dedicated function (funnel, cohorts, retention…)
 * - `distribution`: metric_distribution() — accounts split by an attribute now
 * - `money`: metric_money_by_currency() — always per currency, never summed
 * - `cost`: metric_cost_inputs() priced with src/config/costs.ts
 * - `pending`: measured by a later step; listed so nothing is forgotten
 */

export const METRIC_CATEGORIES = [
  "growth",
  "activation",
  "retention",
  "features",
  "ai",
  "game",
  "costs",
  "health",
  "feedback",
] as const;
export type MetricCategory = (typeof METRIC_CATEGORIES)[number];

export const SEGMENT_KEYS = [
  "plan",
  "mode",
  "industry",
  "locale",
  "country",
  "role",
  "device",
  "signup_week",
] as const;
export type SegmentKey = (typeof SEGMENT_KEYS)[number];
export type Segment = Partial<Record<SegmentKey, string>>;

/** Known values of the closed segments (industry, country and week are open). */
export const SEGMENT_VALUES = {
  plan: ["beta", "trial", "solo", "pro", "team"],
  mode: ["game", "tool"],
  role: ["owner", "worker"],
  device: ["mobile", "tablet", "desktop"],
  locale: ["cs", "en"],
} as const satisfies Partial<Record<SegmentKey, readonly string[]>>;

const ALL: readonly SegmentKey[] = SEGMENT_KEYS;
const USER: readonly SegmentKey[] = SEGMENT_KEYS.filter((key) => key !== "device");
const NONE: readonly SegmentKey[] = [];

export type MetricUnit =
  | "count"
  | "users"
  | "percent"
  | "ratio"
  | "usd"
  | "czk"
  | "money"
  | "minutes"
  | "hours"
  | "days"
  | "ms"
  | "tokens"
  | "kb"
  | "table";

/**
 * Daily metrics and whether a device segment applies to them; the same list
 * as metric_daily_keys() in the database (a test keeps them equal).
 */
export const DAILY_METRICS = {
  signups: { segmentable: true, device: false },
  users_total: { segmentable: true, device: false },
  dau: { segmentable: true, device: true },
  wau: { segmentable: true, device: true },
  mau: { segmentable: true, device: true },
  stickiness: { segmentable: true, device: true },
  new_active: { segmentable: true, device: true },
  returning_active: { segmentable: true, device: true },
  churned: { segmentable: true, device: true },
  sessions: { segmentable: true, device: true },
  app_minutes: { segmentable: true, device: true },
  ai_calls: { segmentable: true, device: false },
  ai_cost_usd: { segmentable: true, device: false },
  places_requests: { segmentable: true, device: true },
  emails_sent: { segmentable: true, device: true },
  xp_awarded: { segmentable: true, device: false },
  events: { segmentable: true, device: true },
  errors: { segmentable: false, device: false },
} as const;
export type DailyMetricKey = keyof typeof DAILY_METRICS;
export const DAILY_METRIC_KEYS = Object.keys(DAILY_METRICS) as DailyMetricKey[];

export type EventCalc = "count" | "users" | "sum" | "avg";
export type EventFilter = Readonly<Record<string, string | number | boolean>>;
export type EventQuery = {
  event: EventName;
  calc: EventCalc;
  /** The numeric property summed or averaged, or `$since_signup_days`. */
  prop?: string;
  /** Only events whose props contain these values. */
  filter?: EventFilter;
};
/** A property, or a column the enrichment trigger fills. */
export type EventGrouping = string;

export const METRIC_FUNCTIONS = {
  metric_funnel: USER,
  metric_activation: USER,
  metric_cohorts: USER,
  metric_retention: USER,
  metric_usage_heatmap: ALL,
  metric_active_days: ALL,
  metric_sessions: ALL,
  metric_adoption: ALL,
  metric_ai_usage: USER,
  metric_ai_top_users: USER,
  metric_jarvis_conversations: USER,
  metric_call_time: USER,
  metric_trials: NONE,
  metric_waitlist: NONE,
  metric_workers: NONE,
  metric_cron_runs: NONE,
  metric_generation_keywords: NONE,
} as const satisfies Record<string, readonly SegmentKey[]>;
export type MetricFunction = keyof typeof METRIC_FUNCTIONS;

export const DISTRIBUTION_KINDS = [
  "plan",
  "mode",
  "industry",
  "locale",
  "country",
  "role",
  "signup_week",
  "currency",
  "theme",
  "jarvis_frequency",
  "animations",
  "sounds",
  "jarvis_proactive",
  "device",
  "browser",
  "level",
  "streak",
  "achievement",
  "chapter_completed",
  "unlock_days",
  "fakturoid_connected",
  "workers_per_owner",
  "feature_request_status",
] as const;
export type DistributionKind = (typeof DISTRIBUTION_KINDS)[number];

export const MONEY_METRICS = [
  "deals_created",
  "deals_won",
  "deals_lost",
  "income",
  "expense",
  "invoices_issued",
] as const;
export type MoneyMetric = (typeof MONEY_METRICS)[number];

export const COST_MEASURES = [
  "breakdown",
  "per_active_user",
  "ai_per_active_user",
  "margin_by_plan",
] as const;
export type CostMeasure = (typeof COST_MEASURES)[number];

export type MetricCompute =
  | { kind: "daily"; metric: DailyMetricKey }
  | ({ kind: "event" } & EventQuery)
  | ({ kind: "breakdown"; by: EventGrouping; limit?: number } & EventQuery)
  | {
      kind: "percentiles";
      event: EventName;
      prop: string;
      by?: EventGrouping;
      filter?: EventFilter;
    }
  | { kind: "ratio"; numerator: EventQuery; denominator: readonly EventQuery[] }
  | { kind: "breakdown_ratio"; by: EventGrouping; numerator: EventQuery; denominator: EventQuery }
  | {
      kind: "function";
      fn: MetricFunction;
      args?: Readonly<Record<string, string | number>>;
      /** One value out of the function's rows: the row where `where` matches, its `field`. */
      pick?: { field: string; where?: Readonly<Record<string, string | number>> };
    }
  | { kind: "distribution"; of: DistributionKind }
  | { kind: "money"; metrics: readonly MoneyMetric[] }
  | { kind: "cost"; measure: CostMeasure }
  | { kind: "pending"; step: string };

export type MetricDefinition = {
  key: string;
  category: MetricCategory;
  /** The app section for the Features page. */
  section?: AnalyticsSection;
  unit: MetricUnit;
  compute: MetricCompute;
  segments: readonly SegmentKey[];
  /** Translation keys of the name and description (both languages). */
  nameKey: string;
  descriptionKey: string;
};

/** Events without a person: segments do not apply to them. */
const SYSTEM_EVENTS: readonly EventName[] = ["server_call", "cron_run"];

function eventSegments(...events: EventName[]): readonly SegmentKey[] {
  return events.some((event) => SYSTEM_EVENTS.includes(event)) ? NONE : ALL;
}

/** The segments a compute supports, from what its SQL function can filter. */
export function segmentsFor(compute: MetricCompute): readonly SegmentKey[] {
  switch (compute.kind) {
    case "daily": {
      const daily = DAILY_METRICS[compute.metric];
      if (!daily.segmentable) return NONE;
      return daily.device ? ALL : USER;
    }
    case "event":
    case "breakdown":
    case "percentiles":
      return eventSegments(compute.event);
    case "ratio":
      return eventSegments(compute.numerator.event, ...compute.denominator.map((d) => d.event));
    case "breakdown_ratio":
      return eventSegments(compute.numerator.event, compute.denominator.event);
    case "function":
      return METRIC_FUNCTIONS[compute.fn];
    case "distribution":
    case "money":
    case "cost":
      return USER;
    case "pending":
      return NONE;
  }
}

type Extra = { section?: AnalyticsSection };

function metric(
  key: string,
  category: MetricCategory,
  unit: MetricUnit,
  compute: MetricCompute,
  extra: Extra = {},
): MetricDefinition {
  return {
    key,
    category,
    unit,
    compute,
    segments: segmentsFor(compute),
    nameKey: `metrics.items.${key}.name`,
    descriptionKey: `metrics.items.${key}.description`,
    ...extra,
  };
}

const daily = (key: DailyMetricKey): MetricCompute => ({ kind: "daily", metric: key });
const fn = (
  name: MetricFunction,
  options: Omit<Extract<MetricCompute, { kind: "function" }>, "kind" | "fn"> = {},
): MetricCompute => ({ kind: "function", fn: name, ...options });
const count = (event: EventName, filter?: EventFilter): EventQuery => ({
  event,
  calc: "count",
  ...(filter ? { filter } : {}),
});
const users = (event: EventName, filter?: EventFilter): EventQuery => ({
  event,
  calc: "users",
  ...(filter ? { filter } : {}),
});
const ev = (query: EventQuery): MetricCompute => ({ kind: "event", ...query });
const split = (by: EventGrouping, query: EventQuery, limit?: number): MetricCompute => ({
  kind: "breakdown",
  by,
  ...query,
  ...(limit ? { limit } : {}),
});
const ratio = (numerator: EventQuery, ...denominator: EventQuery[]): MetricCompute => ({
  kind: "ratio",
  numerator,
  denominator,
});
const percentiles = (
  event: EventName,
  prop: string,
  by?: EventGrouping,
  filter?: EventFilter,
): MetricCompute => ({
  kind: "percentiles",
  event,
  prop,
  ...(by ? { by } : {}),
  ...(filter ? { filter } : {}),
});
const dist = (of: DistributionKind): MetricCompute => ({ kind: "distribution", of });
const pending = (step: string): MetricCompute => ({ kind: "pending", step });

const S = (section: AnalyticsSection): Extra => ({ section });

export const METRICS: readonly MetricDefinition[] = [
  // --- 1. Growth -------------------------------------------------------------
  metric("signups", "growth", "users", daily("signups")),
  metric("users_total", "growth", "users", daily("users_total")),
  metric("waitlist", "growth", "table", fn("metric_waitlist")),
  metric("dau", "growth", "users", daily("dau")),
  metric("wau", "growth", "users", daily("wau")),
  metric("mau", "growth", "users", daily("mau")),
  metric("stickiness", "growth", "ratio", daily("stickiness")),
  metric("new_active", "growth", "users", daily("new_active")),
  metric("returning_active", "growth", "users", daily("returning_active")),
  metric("users_by_plan", "growth", "users", dist("plan")),
  metric("users_by_industry", "growth", "users", dist("industry")),
  metric("users_by_locale", "growth", "users", dist("locale")),
  metric("users_by_country", "growth", "users", dist("country")),
  metric("users_by_role", "growth", "users", dist("role")),
  metric("users_by_device", "growth", "users", dist("device")),
  metric("users_by_browser", "growth", "users", dist("browser")),
  metric("workers", "growth", "table", fn("metric_workers")),

  // --- 2. Activation ---------------------------------------------------------
  metric("funnel", "activation", "table", fn("metric_funnel")),
  metric(
    "time_to_value",
    "activation",
    "hours",
    fn("metric_funnel", {
      pick: { field: "median_hours_from_start", where: { step_key: "first_meeting" } },
    }),
  ),
  metric(
    "onboarding_steps",
    "activation",
    "users",
    split("step", users("onboarding_step_completed")),
  ),
  metric("onboarding_completed", "activation", "users", ev(users("onboarding_completed"))),
  metric(
    "onboarding_skipped_at",
    "activation",
    "users",
    split("skipped_at", users("onboarding_completed")),
  ),
  metric("tour_outcome", "activation", "users", split("outcome", users("tour_finished"))),
  metric(
    "tour_skipped_at",
    "activation",
    "users",
    split("step", users("tour_finished", { outcome: "skipped" })),
  ),
  metric(
    "activation_rate",
    "activation",
    "percent",
    fn("metric_activation", { pick: { field: "pct" } }),
  ),

  // --- 3. Retention ----------------------------------------------------------
  metric("cohorts", "retention", "table", fn("metric_cohorts", { args: { _weeks: 12 } })),
  metric("retention", "retention", "table", fn("metric_retention")),
  metric(
    "retention_d1",
    "retention",
    "percent",
    fn("metric_retention", { pick: { field: "pct", where: { day_n: 1 } } }),
  ),
  metric(
    "retention_d7",
    "retention",
    "percent",
    fn("metric_retention", { pick: { field: "pct", where: { day_n: 7 } } }),
  ),
  metric(
    "retention_d30",
    "retention",
    "percent",
    fn("metric_retention", { pick: { field: "pct", where: { day_n: 30 } } }),
  ),
  metric("churned", "retention", "users", daily("churned")),
  metric("sessions", "retention", "count", daily("sessions")),
  metric("app_minutes", "retention", "minutes", daily("app_minutes")),
  metric("session_stats", "retention", "table", fn("metric_sessions")),
  metric("active_days_per_week", "retention", "table", fn("metric_active_days")),
  metric("usage_heatmap", "retention", "table", fn("metric_usage_heatmap")),
  metric("returns_from_email", "retention", "users", ev(users("app_opened", { ref: "email" }))),
  metric(
    "returns_from_jarvis",
    "retention",
    "users",
    split("reaction", users("jarvis_proactive_reacted")),
  ),

  // --- 4. Features -----------------------------------------------------------
  metric("feature_adoption", "features", "table", fn("metric_adoption")),

  metric(
    "milestones_created",
    "features",
    "count",
    split("where", count("milestone_created")),
    S("milestones"),
  ),
  metric(
    "milestones_completed",
    "features",
    "count",
    split("from_template", count("milestone_completed")),
    S("milestones"),
  ),
  metric(
    "milestone_completion_rate",
    "features",
    "ratio",
    ratio(count("milestone_completed"), count("milestone_created")),
    S("milestones"),
  ),
  metric(
    "milestone_days_to_complete",
    "features",
    "days",
    percentiles("milestone_completed", "days_open", "from_template"),
    S("milestones"),
  ),
  metric(
    "tasks_created",
    "features",
    "count",
    split("is_subtask", count("task_created")),
    S("milestones"),
  ),
  metric(
    "tasks_completed",
    "features",
    "count",
    split("is_subtask", count("task_completed")),
    S("milestones"),
  ),
  metric(
    "task_tree_depth",
    "features",
    "count",
    split("depth", count("task_created")),
    S("milestones"),
  ),
  metric(
    "milestone_views",
    "features",
    "count",
    split("view", count("view_selected")),
    S("milestones"),
  ),
  metric(
    "milestone_reward_share",
    "features",
    "count",
    split("has_reward", count("milestone_created")),
    S("milestones"),
  ),
  metric(
    "milestone_reviews",
    "features",
    "count",
    ev(count("milestone_review_requested")),
    S("milestones"),
  ),

  metric("deals_created", "features", "count", ev(count("deal_created")), S("pipeline")),
  metric("deal_moves", "features", "count", ev(count("deal_moved")), S("pipeline")),
  metric("deals_won", "features", "count", ev(count("deal_won")), S("pipeline")),
  metric("deals_lost", "features", "count", ev(count("deal_lost")), S("pipeline")),
  metric(
    "win_rate",
    "features",
    "ratio",
    ratio(count("deal_won"), count("deal_won"), count("deal_lost")),
    S("pipeline"),
  ),
  metric(
    "deal_value",
    "features",
    "money",
    { kind: "money", metrics: ["deals_created", "deals_won", "deals_lost"] },
    S("pipeline"),
  ),
  metric(
    "hours_in_stage",
    "features",
    "hours",
    percentiles("deal_moved", "hours_in_stage"),
    S("pipeline"),
  ),
  metric(
    "stages_customized",
    "features",
    "users",
    ev(users("pipeline_stage_edited")),
    S("pipeline"),
  ),
  metric(
    "reengage_used",
    "features",
    "users",
    ev(users("reengage_filter_used", { enabled: true })),
    S("pipeline"),
  ),

  metric(
    "contacts_added",
    "features",
    "count",
    split("source", count("contact_created")),
    S("contacts"),
  ),
  metric("contact_moves", "features", "count", ev(count("contact_moved")), S("contacts")),
  metric(
    "contact_tables_created",
    "features",
    "count",
    ev(count("contact_table_edited", { action: "create" })),
    S("contacts"),
  ),
  metric(
    "contact_fields_created",
    "features",
    "count",
    ev(count("contact_field_edited", { action: "create" })),
    S("contacts"),
  ),
  metric(
    "contact_email_filled",
    "features",
    "ratio",
    ratio(count("contact_created", { has_email: true }), count("contact_created")),
    S("contacts"),
  ),
  metric(
    "contact_phone_filled",
    "features",
    "ratio",
    ratio(count("contact_created", { has_phone: true }), count("contact_created")),
    S("contacts"),
  ),
  metric(
    "contact_website_filled",
    "features",
    "ratio",
    ratio(count("contact_created", { has_website: true }), count("contact_created")),
    S("contacts"),
  ),
  metric(
    "duplicates_caught",
    "features",
    "count",
    split("match", count("contact_duplicate_warned")),
    S("contacts"),
  ),
  metric(
    "activities_logged",
    "features",
    "count",
    split("type", count("contact_activity_logged")),
    S("contacts"),
  ),

  metric(
    "generation_batches",
    "features",
    "count",
    ev(count("contacts_generated")),
    S("generation"),
  ),
  metric(
    "generation_requested",
    "features",
    "count",
    ev({ event: "contacts_generated", calc: "sum", prop: "requested" }),
    S("generation"),
  ),
  metric(
    "generation_saved",
    "features",
    "count",
    ev({ event: "contacts_generated", calc: "sum", prop: "saved" }),
    S("generation"),
  ),
  metric(
    "generation_duplicates",
    "features",
    "count",
    ev({ event: "contacts_generated", calc: "sum", prop: "duplicates" }),
    S("generation"),
  ),
  metric(
    "generation_errors",
    "features",
    "count",
    split("error_code", count("places_request", { ok: false })),
    S("generation"),
  ),
  metric(
    "generation_error_rate",
    "features",
    "ratio",
    ratio(count("places_request", { ok: false }), count("places_request")),
    S("generation"),
  ),
  metric(
    "generation_daily_cap",
    "features",
    "ratio",
    ratio(users("contacts_generated", { at_daily_cap: true }), users("contacts_generated")),
    S("generation"),
  ),
  metric(
    "generation_monthly_cap",
    "features",
    "ratio",
    ratio(users("contacts_generated", { at_monthly_cap: true }), users("contacts_generated")),
    S("generation"),
  ),
  metric(
    "generation_keywords",
    "features",
    "table",
    fn("metric_generation_keywords", { args: { _limit: 20 } }),
    S("generation"),
  ),

  metric("call_time", "features", "table", fn("metric_call_time"), S("cold_calling")),
  metric("timer_sessions", "features", "count", ev(count("timer_started")), S("cold_calling")),
  metric(
    "timer_auto_pauses",
    "features",
    "ratio",
    ratio(count("timer_paused", { found_idle: true }), count("timer_paused")),
    S("cold_calling"),
  ),
  metric(
    "contacts_reached",
    "features",
    "count",
    ev(count("contact_moved", { from_table: "unreached" })),
    S("cold_calling"),
  ),
  metric(
    "reached_to_meeting",
    "features",
    "ratio",
    ratio(
      count("contact_moved", { from_table: "unreached", meeting_booked: true }),
      count("contact_moved", { from_table: "unreached" }),
    ),
    S("cold_calling"),
  ),
  metric(
    "reached_to_failed",
    "features",
    "count",
    split("reason", count("contact_moved", { from_table: "unreached", to_table: "failed" })),
    S("cold_calling"),
  ),
  metric(
    "meetings_per_call_hour",
    "features",
    "ratio",
    fn("metric_call_time", { pick: { field: "meetings_per_hour" } }),
    S("cold_calling"),
  ),

  metric(
    "calendar_events",
    "features",
    "count",
    split("kind", count("calendar_event_created")),
    S("calendar"),
  ),
  metric(
    "google_calendar_connected",
    "features",
    "percent",
    pending("calendar-google"),
    S("calendar"),
  ),
  metric("calendar_sync_errors", "features", "count", pending("calendar-google"), S("calendar")),

  metric(
    "transactions",
    "features",
    "count",
    split("type", count("transaction_created")),
    S("finance"),
  ),
  metric(
    "finance_value",
    "features",
    "money",
    { kind: "money", metrics: ["income", "expense", "invoices_issued"] },
    S("finance"),
  ),
  metric("invoices_issued", "features", "count", ev(count("invoice_issued")), S("finance")),
  metric("fakturoid_connected", "features", "users", dist("fakturoid_connected"), S("finance")),
  metric(
    "recurring_payments",
    "features",
    "count",
    ev(count("recurring_payment_saved", { created: true })),
    S("finance"),
  ),

  metric("worker_invites", "features", "table", fn("metric_workers"), S("workers")),
  metric(
    "worker_tasks_assigned",
    "features",
    "count",
    ev(count("worker_task_saved", { created: true })),
    S("workers"),
  ),
  metric(
    "worker_tasks_done",
    "features",
    "count",
    ev(count("worker_task_status_changed", { status: "done" })),
    S("workers"),
  ),
  metric(
    "worker_earnings_approved",
    "features",
    "count",
    ev(count("worker_earnings_approved")),
    S("workers"),
  ),
  metric("workers_per_owner", "features", "users", dist("workers_per_owner"), S("workers")),

  metric("searches", "features", "count", ev(count("search_performed")), S("search")),
  metric(
    "search_results_opened",
    "features",
    "count",
    split("kind", count("search_result_opened")),
    S("search"),
  ),
  metric(
    "search_no_results",
    "features",
    "ratio",
    ratio(count("search_performed", { results: 0 }), count("search_performed")),
    S("search"),
  ),
  metric(
    "search_opened_via",
    "features",
    "count",
    split("via", count("search_opened")),
    S("search"),
  ),
  metric(
    "search_quick_actions",
    "features",
    "count",
    split("action", count("search_quick_action_used")),
    S("search"),
  ),

  metric("emails_sent", "features", "count", daily("emails_sent"), S("email")),
  metric(
    "email_drafts_requested",
    "features",
    "count",
    ev(count("email_draft_requested")),
    S("email"),
  ),
  metric(
    "email_drafts_used",
    "features",
    "count",
    ev(count("email_sent", { used_ai_draft: true })),
    S("email"),
  ),

  metric("settings_currency", "features", "users", dist("currency"), S("settings")),
  metric("settings_theme", "features", "users", dist("theme"), S("settings")),
  metric("settings_animations", "features", "users", dist("animations"), S("settings")),
  metric("settings_sounds", "features", "users", dist("sounds"), S("settings")),
  metric("settings_jarvis_proactive", "features", "users", dist("jarvis_proactive"), S("settings")),

  // --- 5. AI and Jarvis ------------------------------------------------------
  metric("ai_calls", "ai", "count", daily("ai_calls")),
  metric("ai_by_feature", "ai", "table", fn("metric_ai_usage", { args: { _by: "purpose" } })),
  metric("ai_by_model", "ai", "table", fn("metric_ai_usage", { args: { _by: "model" } })),
  metric("ai_tokens", "ai", "tokens", fn("metric_ai_usage", { args: { _by: "all" } })),
  metric("ai_cost", "ai", "usd", daily("ai_cost_usd")),
  metric("ai_cost_per_active_user", "ai", "usd", { kind: "cost", measure: "ai_per_active_user" }),
  metric("ai_top_users", "ai", "table", fn("metric_ai_top_users", { args: { _limit: 10 } })),
  metric("jarvis_conversations", "ai", "table", fn("metric_jarvis_conversations")),
  metric("ai_errors", "ai", "table", fn("metric_ai_usage", { args: { _by: "error" } })),
  metric("jarvis_files", "ai", "count", split("kind", count("jarvis_file_attached"))),
  metric("jarvis_file_size", "ai", "kb", percentiles("jarvis_file_attached", "size_kb")),
  metric("jarvis_files_rejected", "ai", "count", split("reason", count("jarvis_file_rejected"))),
  metric(
    "proactive_reactions",
    "ai",
    "count",
    split("reaction", count("jarvis_proactive_reacted")),
  ),
  metric("proactive_acceptance", "ai", "ratio", {
    kind: "breakdown_ratio",
    by: "kind",
    numerator: count("jarvis_proactive_reacted", { reaction: "accept" }),
    denominator: count("jarvis_proactive_reacted", { reaction: "shown" }),
  }),
  metric("jarvis_auto_actions", "ai", "count", split("action", count("jarvis_auto_action"))),
  metric(
    "jarvis_auto_actions_undone",
    "ai",
    "ratio",
    ratio(count("jarvis_auto_action_undone"), count("jarvis_auto_action")),
  ),
  metric("jarvis_answer_ratings", "ai", "count", pending("11.5")),
  metric(
    "ai_cap_users",
    "ai",
    "ratio",
    ratio(users("jarvis_limit_reached"), users("jarvis_message_sent")),
  ),

  // --- 6. Game ---------------------------------------------------------------
  metric("users_by_mode", "game", "users", dist("mode")),
  metric(
    "mode_switches",
    "game",
    "count",
    split("to", count("game_mode_changed", { where: "settings" })),
  ),
  metric(
    "mode_switch_days",
    "game",
    "days",
    percentiles("game_mode_changed", "$since_signup_days", "to", { where: "settings" }),
  ),
  metric("level_distribution", "game", "users", dist("level")),
  metric("xp_per_day", "game", "count", daily("xp_awarded")),
  metric(
    "xp_sources",
    "game",
    "count",
    split("reason", { event: "xp_awarded", calc: "sum", prop: "xp" }),
  ),
  metric("chapters_completed", "game", "users", dist("chapter_completed")),
  metric("unlock_days", "game", "days", dist("unlock_days")),
  metric("achievements", "game", "users", dist("achievement")),
  metric("streaks", "game", "users", dist("streak")),
  metric("streak_freezes", "game", "count", pending("game-streak-freeze-log")),
  metric("celebrations", "game", "count", split("kind", count("celebration_shown"))),

  // --- 7. Costs --------------------------------------------------------------
  metric("cost_breakdown", "costs", "usd", { kind: "cost", measure: "breakdown" }),
  metric("places_requests", "costs", "count", daily("places_requests")),
  metric("cost_per_active_user", "costs", "usd", { kind: "cost", measure: "per_active_user" }),
  metric("margin_by_plan", "costs", "table", { kind: "cost", measure: "margin_by_plan" }),
  metric("trials", "costs", "table", fn("metric_trials")),
  metric("plan_interest", "costs", "users", split("plan", users("plan_interest_clicked"))),

  // --- 8. Technical health ---------------------------------------------------
  metric("errors", "health", "count", daily("errors")),
  metric(
    "server_error_rate",
    "health",
    "ratio",
    ratio(count("server_call", { ok: false }), count("server_call")),
  ),
  metric(
    "top_server_errors",
    "health",
    "count",
    split("error_code", count("server_call", { ok: false })),
  ),
  metric("route_latency", "health", "ms", percentiles("server_call", "duration_ms", "name")),
  metric(
    "page_load",
    "health",
    "ms",
    percentiles("page_viewed", "load_ms", "route", { initial: true }),
  ),
  metric("client_errors_by_page", "health", "count", split("route", count("client_error"))),
  metric("cron_runs", "health", "table", fn("metric_cron_runs")),
  metric(
    "integration_errors",
    "health",
    "count",
    split("name", count("server_call", { ok: false })),
  ),

  // --- 9. Feedback -----------------------------------------------------------
  metric("feature_requests", "feedback", "count", dist("feature_request_status")),
  metric("nps", "feedback", "count", pending("11.5")),
];

const BY_KEY = new Map(METRICS.map((definition) => [definition.key, definition]));

export function metricDefinition(key: string): MetricDefinition | undefined {
  return BY_KEY.get(key);
}

export function metricsIn(category: MetricCategory): MetricDefinition[] {
  return METRICS.filter((definition) => definition.category === category);
}

/** Share of input tokens served from the prompt cache, 0–1. */
export function cacheHitRate(row: {
  input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}): number | null {
  const total = row.input_tokens + row.cache_read_tokens + row.cache_write_tokens;
  return total > 0 ? row.cache_read_tokens / total : null;
}

/** Drops empty values and anything the metric can not filter by. */
export function segmentFor(definition: MetricDefinition, segment: Segment): Segment {
  const result: Segment = {};
  for (const key of definition.segments) {
    const value = segment[key];
    if (typeof value === "string" && value !== "") result[key] = value;
  }
  return result;
}

// --- Days ----------------------------------------------------------------------

/** The zone metrics cut days in; the same as metrics_timezone() in the database. */
export const METRICS_TIMEZONE = "Europe/Prague";

/** Today in the metrics zone. */
export function metricsToday(now: Date = new Date()): IsoDate {
  return todayIsoDate({ ...DEFAULT_FORMAT_SETTINGS, timeZone: METRICS_TIMEZONE }, now);
}

/** A calendar date moved by whole days (no zone involved). */
export function shiftDay(day: IsoDate, days: number): IsoDate {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Every date from `from` to `to`, both included. */
export function daysBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const days: IsoDate[] = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) days.push(day);
  return days;
}

/**
 * The finished days the nightly job recomputes: yesterday, and the day before
 * for events that arrived late (a beacon sent after midnight).
 */
export function daysToRefresh(now: Date = new Date()): IsoDate[] {
  const today = metricsToday(now);
  return [shiftDay(today, -2), shiftDay(today, -1)];
}
