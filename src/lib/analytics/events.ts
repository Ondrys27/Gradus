import { z } from "zod";
import { FILE_KINDS } from "@/features/jarvis/files";
import { PROACTIVE_KINDS } from "@/features/jarvis/proactive";
import { PROACTIVE_REACTIONS } from "@/features/jarvis/protocol";
import { INDUSTRY_KEYS } from "@/features/onboarding/industries";
import { XP_REASONS } from "@/features/game/rules";
import { field, isSafeField, isScrubbedTextField } from "./fields";
import { APP_ROUTES, ANALYTICS_SECTIONS, type AnalyticsSection } from "./routes";

/**
 * Every event the app records, with the zod schema of its properties.
 * Properties are identifiers, enums, numbers and booleans only, built from
 * `field` — never names, e-mails, phones, company, deal or task names, or the
 * content of a message. The schemas are strict: an unknown property refuses
 * the whole event. Firsts (first contact, first deal…) are computed from these
 * events, never recorded separately.
 *
 * - `section`: the part of the app, for adoption and "active in 2 sections".
 * - `active`: a meaningful action (create, edit, move, send, finish). Signing
 *   in or viewing a page is not one; docs/metrics.md counts active users by it.
 * - `from`: who may record it. Browser events come through /api/t; server
 *   events only from track() on the server, so the browser can not fake them.
 */

type Origin = "client" | "server" | "both";
type Shape = Record<string, z.ZodType>;
type EventDef<S extends Shape = Shape> = {
  section: AnalyticsSection;
  active: boolean;
  from: Origin;
  props: S;
};

function event<S extends Shape>(
  section: AnalyticsSection,
  from: Origin,
  active: boolean,
  props: S,
): EventDef<S> {
  return { section, from, active, props };
}

const { id, oneOf, key, isoCode, count, number, ms, bool, optional } = field;

const MODES = ["game", "tool"] as const;
const ONBOARDING_STEPS = [
  "welcome",
  "mode",
  "industry",
  "path",
  "region",
  "milestone",
  "contact",
] as const;
const TOUR_STEPS = [
  "dashboard",
  "milestones",
  "jarvis",
  "level",
  "search",
  "settings",
  "finish",
  "workerDashboard",
  "workerTasks",
  "workerFinish",
] as const;
/** System tables by system_key; a table the user made is `custom`. */
const CONTACT_TABLE_KEYS = [
  "unreached",
  "no_answer",
  "failed",
  "meeting_scheduled",
  "email_sent",
  "follow_up",
  "clients",
  "custom",
  "none",
] as const;
/** The default reasons of the Unsuccessful table; one the user added is `custom`. */
const FAILURE_REASONS = [
  "has_solution",
  "not_interested",
  "no_budget",
  "not_target_group",
  "other",
  "custom",
] as const;
const FIELD_TYPES = ["text", "long_text", "date", "datetime", "select", "boolean"] as const;
const ACTIVITY_TYPES = ["call", "email", "meeting", "note", "move", "sms"] as const;
const CALENDAR_KINDS = ["meeting", "call", "reminder", "other"] as const;
const RECURRING_FREQUENCIES = ["weekly", "monthly", "quarterly", "yearly"] as const;
const SETTINGS = [
  "locale",
  "currency",
  "country",
  "timezone",
  "date_format",
  "time_format",
  "number_format",
  "week_start",
  "theme",
  "animations",
  "sounds",
  "jarvis_proactive",
  "jarvis_frequency",
  "jarvis_quiet_hours",
  "reengage_months",
] as const;
const CRON_JOBS = [
  "call_time_stats",
  "recurring_payments",
  "fakturoid_sync",
  "jarvis_watch",
  "jarvis_briefing",
  "analytics_retention",
] as const;
const FILE_ERRORS = [
  "fileType",
  "fileTooLarge",
  "fileUnreadable",
  "fileMissing",
  "fileLimit",
] as const;
const PAID_PLANS = ["solo", "pro", "team"] as const;

export const EVENTS = {
  // --- platform ------------------------------------------------------------
  page_viewed: event("platform", "client", false, {
    route: oneOf(APP_ROUTES),
    section: oneOf(ANALYTICS_SECTIONS),
    /** The first page of a load (with its load time) or a change inside the app. */
    initial: bool(),
    load_ms: optional(ms()),
  }),
  /** Once per load; `ref=email` in the address marks a return from an e-mail. */
  app_opened: event("platform", "client", false, { ref: oneOf(["direct", "email"]) }),
  client_error: event("platform", "client", false, {
    route: oneOf(APP_ROUTES),
    source: oneOf(["boundary", "onerror", "unhandledrejection"]),
    message: field.scrubbedText(),
  }),
  /** A server route or action: how long and how it ended (an error code, never a message). */
  server_call: event("platform", "server", false, {
    name: key(),
    kind: oneOf(["route", "action"]),
    status: optional(count(999)),
    ok: bool(),
    duration_ms: ms(),
    error_code: optional(key()),
  }),
  cron_run: event("platform", "server", false, {
    job: oneOf(CRON_JOBS),
    ok: bool(),
    duration_ms: ms(),
    processed: optional(count()),
    error_code: optional(key()),
  }),

  // --- account -------------------------------------------------------------
  account_registered: event("account", "server", false, {
    method: oneOf(["beta", "worker", "trial"]),
  }),
  signed_in: event("account", "server", false, {}),
  signed_out: event("account", "client", false, {}),
  waitlist_joined: event("account", "server", false, { locale: oneOf(["cs", "en"]) }),
  waitlist_confirmed: event("account", "server", false, {}),
  settings_changed: event("settings", "client", false, {
    setting: oneOf(SETTINGS),
    /** The chosen option (a code such as CZK, CZ, midnight, cs), never free text. */
    value: optional(key()),
    enabled: optional(bool()),
  }),

  // --- onboarding and the tour ----------------------------------------------
  onboarding_step_completed: event("onboarding", "client", false, {
    step: oneOf(ONBOARDING_STEPS),
    index: count(20),
    mode: optional(oneOf(MODES)),
  }),
  onboarding_completed: event("onboarding", "client", false, {
    mode: oneOf(MODES),
    industry: optional(oneOf(INDUSTRY_KEYS)),
    path: optional(key()),
  }),
  tour_step_viewed: event("onboarding", "client", false, {
    step: oneOf(TOUR_STEPS),
    index: count(20),
    total: count(20),
    variant: oneOf(["owner", "worker"]),
    replay: bool(),
  }),
  tour_finished: event("onboarding", "client", false, {
    outcome: oneOf(["completed", "skipped"]),
    step: oneOf(TOUR_STEPS),
    index: count(20),
    total: count(20),
    variant: oneOf(["owner", "worker"]),
    replay: bool(),
  }),

  // --- game ----------------------------------------------------------------
  game_mode_changed: event("game", "client", false, {
    to: oneOf(MODES),
    where: oneOf(["onboarding", "settings"]),
  }),
  path_chosen: event("game", "client", false, {
    path: key(),
    where: oneOf(["onboarding", "settings"]),
  }),
  xp_awarded: event("game", "client", false, {
    reason: oneOf(XP_REASONS),
    xp: count(10_000),
    level: count(100),
    total_xp: count(),
    streak: count(10_000),
  }),
  level_reached: event("game", "client", false, { level: count(100) }),
  achievement_earned: event("game", "client", false, { achievement: key() }),
  section_unlocked: event("game", "client", false, {
    unlock: key(),
    source: oneOf(["level", "milestone"]),
  }),
  celebration_shown: event("game", "client", false, {
    kind: oneOf(["milestone", "win", "level", "achievement", "unlock", "other"]),
    quiet: bool(),
  }),
  level_dialog_opened: event("game", "client", false, { level: count(100) }),

  // --- milestones and tasks ------------------------------------------------
  milestone_created: event("milestones", "client", true, {
    where: oneOf(["form", "onboarding"]),
    category: oneOf(["work", "personal"]),
    has_reward: bool(),
    has_target_date: bool(),
  }),
  milestone_updated: event("milestones", "client", true, { has_reward: bool() }),
  milestone_completed: event("milestones", "client", true, {
    milestone_id: id(),
    from_template: bool(),
    /** The chapter's order in its path, for "where people get stuck". */
    chapter: optional(count(100)),
    task_count: count(10_000),
    days_open: count(100_000),
    has_reward: bool(),
  }),
  milestone_reopened: event("milestones", "client", true, { from_template: bool() }),
  milestone_deleted: event("milestones", "client", true, { from_template: bool() }),
  milestone_review_requested: event("milestones", "client", true, { auto: bool() }),
  task_created: event("milestones", "client", true, {
    depth: count(100),
    is_subtask: bool(),
  }),
  task_updated: event("milestones", "client", true, {}),
  task_completed: event("milestones", "client", true, {
    depth: count(100),
    is_subtask: bool(),
    from_template: bool(),
    where: oneOf(["milestone", "dashboard"]),
  }),
  task_reopened: event("milestones", "client", true, { where: oneOf(["milestone", "dashboard"]) }),
  task_deleted: event("milestones", "client", true, { removed: count(10_000) }),
  tasks_reordered: event("milestones", "client", true, {}),
  view_selected: event("milestones", "client", false, {
    screen: oneOf(["milestones", "tasks"]),
    view: oneOf(["list", "map", "path"]),
    initial: bool(),
  }),

  // --- pipeline ------------------------------------------------------------
  deal_created: event("pipeline", "client", true, {
    currency: isoCode(3),
    value: optional(number()),
    has_contact: bool(),
  }),
  deal_updated: event("pipeline", "client", true, {}),
  deal_moved: event("pipeline", "client", true, {
    from_position: count(1000),
    to_position: count(1000),
    /** How long the deal sat in the stage it left. */
    hours_in_stage: count(1_000_000),
    to_won: bool(),
    to_lost: bool(),
  }),
  deal_won: event("pipeline", "client", true, {
    currency: isoCode(3),
    value: optional(number()),
    days_open: count(100_000),
  }),
  deal_lost: event("pipeline", "client", true, {
    currency: isoCode(3),
    value: optional(number()),
    has_reason: bool(),
  }),
  deal_deleted: event("pipeline", "client", true, {}),
  pipeline_stage_edited: event("pipeline", "client", true, {
    action: oneOf(["create", "rename", "reorder", "remove", "deposit"]),
  }),
  reengage_filter_used: event("pipeline", "client", false, { enabled: bool() }),

  // --- contacts ------------------------------------------------------------
  contact_created: event("contacts", "client", true, {
    source: oneOf(["manual", "generated", "import"]),
    where: oneOf(["contacts", "pipeline", "onboarding"]),
    has_email: bool(),
    has_phone: bool(),
    has_website: bool(),
  }),
  contact_updated: event("contacts", "client", true, {
    has_email: bool(),
    has_phone: bool(),
    has_website: bool(),
  }),
  contact_deleted: event("contacts", "client", true, {}),
  /** A move from `unreached` is a call made (cold calling's "reached"). */
  contact_moved: event("contacts", "client", true, {
    from_table: oneOf(CONTACT_TABLE_KEYS),
    to_table: oneOf(CONTACT_TABLE_KEYS),
    questions: count(100),
    meeting_booked: bool(),
    reason: optional(oneOf(FAILURE_REASONS)),
  }),
  contact_activity_logged: event("contacts", "client", true, { type: oneOf(ACTIVITY_TYPES) }),
  contact_activity_deleted: event("contacts", "client", true, {}),
  contact_duplicate_warned: event("contacts", "client", false, {
    match: oneOf(["phone", "email", "both"]),
  }),
  contact_table_edited: event("contacts", "client", true, {
    action: oneOf(["create", "update", "reorder", "remove"]),
  }),
  contact_field_edited: event("contacts", "client", true, {
    action: oneOf(["create", "update", "reorder", "remove"]),
    type: optional(oneOf(FIELD_TYPES)),
    dependent: optional(bool()),
  }),

  // --- contact generation (server) ------------------------------------------
  /** Every request to Google Places, failures included; the plan's limits count `saved`. */
  places_request: event("generation", "server", false, {
    page: optional(count(10)),
    ok: bool(),
    saved: count(1000),
    results: optional(count(1000)),
    duplicates: optional(count(1000)),
    http_status: optional(count(999)),
    error_code: optional(key()),
  }),
  /** One press of Generate. */
  contacts_generated: event("generation", "server", true, {
    requested: count(1000),
    saved: count(1000),
    duplicates: count(1000),
    pages: count(10),
    exhausted: bool(),
    ok: bool(),
    error_code: optional(key()),
    at_daily_cap: bool(),
    at_monthly_cap: bool(),
  }),

  // --- cold calling ----------------------------------------------------------
  timer_started: event("cold_calling", "client", true, {}),
  timer_paused: event("cold_calling", "client", true, { seconds: optional(count(86_400)) }),

  // --- calendar -----------------------------------------------------------
  calendar_event_created: event("calendar", "client", true, {
    kind: oneOf(CALENDAR_KINDS),
    has_contact: bool(),
  }),
  calendar_event_updated: event("calendar", "client", true, { kind: oneOf(CALENDAR_KINDS) }),
  calendar_event_deleted: event("calendar", "client", true, {}),

  // --- finance -------------------------------------------------------------
  transaction_created: event("finance", "client", true, {
    type: oneOf(["income", "expense"]),
    currency: isoCode(3),
    has_category: bool(),
  }),
  transaction_updated: event("finance", "client", true, { type: oneOf(["income", "expense"]) }),
  transaction_deleted: event("finance", "client", true, {}),
  transaction_confirmed: event("finance", "client", true, {}),
  recurring_payment_saved: event("finance", "client", true, {
    created: bool(),
    type: oneOf(["income", "expense"]),
    frequency: oneOf(RECURRING_FREQUENCIES),
  }),
  recurring_payment_toggled: event("finance", "client", true, { active: bool() }),
  recurring_payment_deleted: event("finance", "client", true, {}),
  invoice_issued: event("finance", "client", true, {}),
  invoice_paid_marked: event("finance", "client", true, {}),
  invoice_deleted: event("finance", "client", true, {}),
  fakturoid_connected: event("finance", "client", true, {}),
  fakturoid_disconnected: event("finance", "client", true, {}),
  fakturoid_synced: event("finance", "client", false, {}),

  // --- workers -------------------------------------------------------------
  worker_invited: event("workers", "client", true, {}),
  worker_invite_renewed: event("workers", "client", true, {}),
  worker_invite_accepted: event("workers", "server", false, {}),
  worker_updated: event("workers", "client", true, {
    status: optional(oneOf(["invited", "active", "inactive"])),
  }),
  worker_permissions_saved: event("workers", "client", true, {
    view_sections: count(20),
    edit_sections: count(20),
  }),
  worker_task_saved: event("workers", "client", true, { created: bool() }),
  worker_task_status_changed: event("workers", "client", true, {
    status: oneOf(["open", "done"]),
    by: oneOf(["owner", "worker"]),
  }),
  worker_task_deleted: event("workers", "client", true, {}),
  worker_earnings_approved: event("workers", "client", true, { count: count(10_000) }),
  worker_payment_recorded: event("workers", "client", true, { currency: isoCode(3) }),
  work_timer_started: event("workers", "client", true, {}),
  work_timer_paused: event("workers", "client", true, {}),
  reward_rules_confirmed: event("workers", "client", true, { rules: count(1000) }),

  // --- search --------------------------------------------------------------
  search_opened: event("search", "client", false, { via: oneOf(["shortcut", "click"]) }),
  search_performed: event("search", "client", false, {
    query_length: count(500),
    results: count(1000),
    filtered: bool(),
  }),
  search_result_opened: event("search", "client", false, {
    kind: key(),
    position: count(1000),
  }),
  search_quick_action_used: event("search", "client", false, { action: key() }),

  // --- e-mail --------------------------------------------------------------
  email_sent: event("email", "client", true, {
    attachments: count(20),
    used_ai_draft: bool(),
    from_deal: bool(),
  }),
  email_draft_requested: event("email", "client", true, {
    ok: bool(),
    error_code: optional(key()),
  }),

  // --- Jarvis --------------------------------------------------------------
  jarvis_opened: event("jarvis", "client", false, {}),
  jarvis_message_sent: event("jarvis", "server", true, {
    new_conversation: bool(),
    attachments: count(10),
    message_length: count(100_000),
    ok: bool(),
    error_code: optional(key()),
  }),
  jarvis_file_attached: event("jarvis", "server", false, {
    kind: optional(oneOf(FILE_KINDS)),
    size_kb: optional(count(20_000)),
  }),
  jarvis_file_rejected: event("jarvis", "server", false, { reason: oneOf(FILE_ERRORS) }),
  jarvis_limit_reached: event("jarvis", "server", false, { feature: key() }),
  /** A bubble shown and every reaction to it (Do = accept, Show = open, Later, Close). */
  jarvis_proactive_reacted: event("jarvis", "server", false, {
    reaction: oneOf(PROACTIVE_REACTIONS),
    kind: oneOf(PROACTIVE_KINDS),
    type: optional(key()),
    tasks_created: optional(count(100)),
    question: optional(key()),
  }),
  jarvis_suggestion_dismissed: event("jarvis", "client", false, {}),
  /** Something Jarvis did on his own, shown with an Undo. */
  jarvis_auto_action: event("jarvis", "client", false, { action: key() }),
  jarvis_auto_action_undone: event("jarvis", "client", true, { action: key() }),
  sales_analysis_requested: event("jarvis", "client", true, { ok: bool() }),

  // --- plan and trial ------------------------------------------------------
  plan_interest_clicked: event("plan", "server", false, { plan: oneOf(PAID_PLANS), ok: bool() }),
  trial_notice_shown: event("plan", "client", false, {
    days_left: count(1000),
    expired: bool(),
  }),
} satisfies Record<string, EventDef>;

export type EventName = keyof typeof EVENTS;
export type EventProps<E extends EventName> = z.input<z.ZodObject<(typeof EVENTS)[E]["props"]>>;
export type ClientEventName = {
  [E in EventName]: (typeof EVENTS)[E]["from"] extends "server" ? never : E;
}[EventName];

/** Events whose props may carry the scrubbed text of an error. */
export const SCRUBBED_TEXT_EVENTS: readonly EventName[] = ["client_error"];

// Checked once when the module loads: a field not built from `field`, or the
// error text in another event, stops the app from starting instead of leaking.
for (const [name, def] of Object.entries(EVENTS) as [EventName, EventDef][]) {
  for (const [prop, schema] of Object.entries(def.props)) {
    if (!isSafeField(schema)) {
      throw new Error(`analytics: ${name}.${prop} is not built from the catalog's fields`);
    }
    if (isScrubbedTextField(schema) && !SCRUBBED_TEXT_EVENTS.includes(name)) {
      throw new Error(`analytics: ${name}.${prop} may not carry text`);
    }
  }
}

const SCHEMAS = new Map<string, z.ZodType<Record<string, unknown>>>(
  (Object.entries(EVENTS) as [EventName, EventDef][]).map(([name, def]) => [
    name,
    z.strictObject(def.props) as unknown as z.ZodType<Record<string, unknown>>,
  ]),
);

export function isEventName(name: unknown): name is EventName {
  return typeof name === "string" && SCHEMAS.has(name);
}

export type ParsedEvent =
  | { ok: true; event: EventName; props: Record<string, unknown> }
  | { ok: false; reason: "unknownEvent" | "notAllowedHere" | "invalidProps" };

/**
 * Validates one event against the catalog. `origin` is where it came from:
 * the browser may send only client events.
 */
export function parseEvent(
  name: unknown,
  props: unknown,
  origin: "client" | "server",
): ParsedEvent {
  if (!isEventName(name)) return { ok: false, reason: "unknownEvent" };
  const def: EventDef = EVENTS[name];
  if (origin === "client" && def.from === "server") return { ok: false, reason: "notAllowedHere" };
  const parsed = SCHEMAS.get(name)!.safeParse(props ?? {});
  if (!parsed.success) return { ok: false, reason: "invalidProps" };
  return { ok: true, event: name, props: parsed.data };
}

export function eventDefinition(name: EventName): EventDef {
  return EVENTS[name];
}
