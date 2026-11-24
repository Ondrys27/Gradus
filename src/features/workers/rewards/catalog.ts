/**
 * The events a reward rule can listen to (29.1): one catalog in code, the
 * same keys as reward_definition_ok() and the engine in
 * supabase/migrations/20261205090000_reward_event_rules.sql. A new event is
 * one entry here, its texts under `workers.rewardPlan.events.<key>` and its
 * trigger in the database.
 */

export const REWARD_EVENTS = [
  "contact.moved",
  "meeting.booked",
  "meeting.held",
  "booking.received",
  "call.logged",
  "contact.created",
  "deal.moved",
  "deal.won",
  "deal.lost",
  "task.done",
  "milestone.done",
  "invoice.issued",
  "invoice.paid",
  "time.hour",
  "time.month",
] as const;
export type RewardEvent = (typeof REWARD_EVENTS)[number];

export const EVENT_GROUPS = [
  "coldCalling",
  "meetings",
  "contacts",
  "pipeline",
  "tasks",
  "invoices",
  "time",
] as const;
export type EventGroup = (typeof EVENT_GROUPS)[number];

/** Who has to have done it: the worker themself, or anyone on the worker's record. */
export const WHO = ["self", "record"] as const;
export type Who = (typeof WHO)[number];

/** Where a meeting comes from. */
export const VIAS = ["calls", "scheduler", "calendar"] as const;
export type Via = (typeof VIAS)[number];

export const TASK_KINDS = ["crm_task", "worker_task", "task"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const CONTACT_REQUIRES = ["none", "phone", "email", "phone_or_email"] as const;
export type ContactRequire = (typeof CONTACT_REQUIRES)[number];

export const REWARD_TYPES = ["fixed", "percent", "unit", "tiers", "price"] as const;
export type RewardType = (typeof REWARD_TYPES)[number];

export type EventSpec = {
  group: EventGroup;
  /** A move between the user's own contact tables or pipeline stages (from / to by id). */
  move?: "tables" | "stages";
  /** The choices of "who", the first is the default. */
  who: readonly Who[];
  /** The event has a value (a deal's or an invoice's, without VAT): a share and a range. */
  value: boolean;
  /** The event happens to a contact with tags. */
  tags: boolean;
  /**
   * What "only the first time" is counted on (the default is on); null = every
   * event is its own record anyway (a deal is won once, a task done once).
   */
  once: "contact" | "deal" | null;
  /** Moving back (or deleting it) can cancel an unpaid reward. */
  undoable: boolean;
  via?: readonly Via[];
  /** Done on time or any time; the kind of task. */
  task?: true;
  /** What the new contact has to have. */
  require?: true;
  rewards: readonly RewardType[];
  /** Counted per month: tiers and a bonus for a number of them. */
  counted: boolean;
  /** A monthly cap. */
  cap: boolean;
};

export const EVENT_CATALOG: Record<RewardEvent, EventSpec> = {
  "contact.moved": {
    group: "coldCalling",
    move: "tables",
    who: ["self"],
    value: false,
    tags: true,
    once: "contact",
    undoable: true,
    rewards: ["fixed", "tiers"],
    counted: true,
    cap: true,
  },
  "meeting.booked": {
    group: "meetings",
    who: ["self"],
    value: false,
    tags: true,
    once: "contact",
    undoable: true,
    via: ["calls", "scheduler", "calendar"],
    rewards: ["fixed", "tiers"],
    counted: true,
    cap: true,
  },
  "meeting.held": {
    group: "meetings",
    who: ["self"],
    value: false,
    tags: true,
    once: null,
    undoable: false,
    via: ["scheduler", "calendar"],
    rewards: ["fixed", "tiers"],
    counted: true,
    cap: true,
  },
  "booking.received": {
    group: "meetings",
    who: ["self"],
    value: false,
    tags: true,
    once: null,
    undoable: false,
    rewards: ["fixed", "tiers"],
    counted: true,
    cap: true,
  },
  "call.logged": {
    group: "coldCalling",
    who: ["self"],
    value: false,
    tags: true,
    once: "contact",
    undoable: true,
    rewards: ["fixed", "tiers"],
    counted: true,
    cap: true,
  },
  "contact.created": {
    group: "contacts",
    who: ["self"],
    value: false,
    tags: true,
    once: null,
    undoable: false,
    require: true,
    rewards: ["fixed", "tiers"],
    counted: true,
    cap: true,
  },
  "deal.moved": {
    group: "pipeline",
    move: "stages",
    who: ["self", "record"],
    value: true,
    tags: true,
    once: "deal",
    undoable: true,
    rewards: ["fixed", "percent", "tiers"],
    counted: true,
    cap: true,
  },
  "deal.won": {
    group: "pipeline",
    who: ["record", "self"],
    value: true,
    tags: true,
    once: null,
    undoable: false,
    rewards: ["fixed", "percent", "tiers"],
    counted: true,
    cap: true,
  },
  "deal.lost": {
    group: "pipeline",
    who: ["record", "self"],
    value: true,
    tags: true,
    once: null,
    undoable: false,
    rewards: ["fixed", "tiers"],
    counted: true,
    cap: true,
  },
  "task.done": {
    group: "tasks",
    who: ["record", "self"],
    value: false,
    tags: true,
    once: null,
    undoable: false,
    task: true,
    rewards: ["fixed", "tiers", "price"],
    counted: true,
    cap: true,
  },
  "milestone.done": {
    group: "tasks",
    who: ["record"],
    value: false,
    tags: false,
    once: null,
    undoable: false,
    rewards: ["fixed", "tiers"],
    counted: true,
    cap: true,
  },
  "invoice.issued": {
    group: "invoices",
    who: ["self", "record"],
    value: true,
    tags: true,
    once: null,
    undoable: false,
    rewards: ["fixed", "percent", "tiers"],
    counted: true,
    cap: true,
  },
  "invoice.paid": {
    group: "invoices",
    who: ["self", "record"],
    value: true,
    tags: true,
    once: null,
    undoable: false,
    rewards: ["fixed", "percent", "tiers"],
    counted: true,
    cap: true,
  },
  "time.hour": {
    group: "time",
    who: ["self"],
    value: false,
    tags: false,
    once: null,
    undoable: false,
    rewards: ["unit"],
    counted: false,
    cap: true,
  },
  "time.month": {
    group: "time",
    who: ["self"],
    value: false,
    tags: false,
    once: null,
    undoable: false,
    rewards: ["fixed"],
    counted: false,
    cap: false,
  },
};

export function eventSpec(event: RewardEvent): EventSpec {
  return EVENT_CATALOG[event];
}

export function isRewardEvent(value: unknown): value is RewardEvent {
  return typeof value === "string" && (REWARD_EVENTS as readonly string[]).includes(value);
}

/** The events of each group, in catalog order (the picker of the sentence). */
export function eventsByGroup(): Array<{ group: EventGroup; events: RewardEvent[] }> {
  return EVENT_GROUPS.map((group) => ({
    group,
    events: REWARD_EVENTS.filter((event) => EVENT_CATALOG[event].group === group),
  }));
}

/** The event's key in the translations: a dot would nest the message ("contact.moved" → "contact_moved"). */
export function eventMessageKey(event: RewardEvent): string {
  return event.replace(".", "_");
}
