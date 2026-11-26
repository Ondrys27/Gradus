import type { Tone } from "@/components/ui/tone";
import type { IsoDate } from "@/lib/format";
import type { Database } from "@/types/database";
import type { CrmTask } from "@/features/crm-tasks/types";

type Tables = Database["public"]["Tables"];

export const EVENT_COLUMNS =
  "id, title, description, kind, starts_at, ends_at, all_day, contact_id, deal_id, source, actor_id, calendar_owner_id, private, is_demo, link:calendar_external_links(calendar_id), contact:contacts(id, company_name, first_name, last_name), deal:deals(id, title)";

export type CalendarEventRow = Pick<
  Tables["calendar_events"]["Row"],
  | "id"
  | "title"
  | "description"
  | "kind"
  | "starts_at"
  | "ends_at"
  | "all_day"
  | "contact_id"
  | "deal_id"
  | "source"
  | "actor_id"
>;

export type EventContact = Pick<
  Tables["contacts"]["Row"],
  "id" | "company_name" | "first_name" | "last_name"
>;

export type CalendarEvent = CalendarEventRow & {
  contact: EventContact | null;
  deal: Pick<Tables["deals"]["Row"], "id" | "title"> | null;
  /** Sample data of the tutorial (labelled "sample"); absent in older reads. */
  is_demo?: boolean | null;
  /** Whose calendar it is in (30.3); null = whoever made it. Absent in older reads. */
  calendar_owner_id?: string | null;
  /** Others see it only as busy time (30.3). */
  private?: boolean | null;
  /** The Google / Apple calendar it came from or goes to (the account's own events). */
  link?: { calendar_id: string } | null;
  /** Someone else's event read through a share (calendar_shared_events). */
  shared?: SharedInfo;
};

/** What the calendar knows of someone else's event it reads through a share. */
export type SharedInfo = {
  personId: string;
  level: "busy" | "read" | "write" | "invite";
  /** "Made by X" when someone else wrote it into the person's calendar. */
  createdByName: string | null;
  /** Write share: it may be changed through the share. */
  canEdit: boolean;
  /** A meeting the account is invited to, and its answer. */
  inviteStatus: "invited" | "accepted" | "declined" | null;
  location: string | null;
};

/** The three types offered when adding an event. */
export const EVENT_KINDS = ["meeting", "task", "deadline"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type CalendarView = "day" | "week" | "month";
export const CALENDAR_VIEWS: readonly CalendarView[] = ["day", "week", "month"];

/** Read-only items taken from milestones and the pipeline. */
export type MirrorSource = "task" | "deal";
export type MirrorItem = {
  id: string;
  source: MirrorSource;
  title: string;
  /** Calendar day of the due date or the Close Date. */
  date: IsoDate;
  /** Where the source lives; opened on click. */
  href: string;
};

type ItemBase = {
  key: string;
  title: string;
  tone: Tone;
  /** Someone else's calendar (30.3): their initials on the item. */
  person?: { id: string; initials: string; name: string };
  allDay: boolean;
  /** First and last calendar day (user's zone) the item touches, both inclusive. */
  firstDay: IsoDate;
  lastDay: IsoDate;
};

export type EventItem = ItemBase & {
  type: "event";
  event: CalendarEvent;
  kind: EventKind;
  /** Instants in ms; a timed item without an end is shown as one hour. */
  startMs: number;
  endMs: number;
};

export type MirrorCalendarItem = ItemBase & {
  type: "mirror";
  mirror: MirrorItem;
  allDay: true;
};

/**
 * A sales task with a time: drawn at its due moment for its length, outlined
 * (not filled) so it never passes for a meeting. Moving it changes when it is
 * due; its length is changed in the task itself.
 */
export type TaskCalendarItem = ItemBase & {
  type: "task";
  task: CrmTask;
  allDay: false;
  overdue: boolean;
  startMs: number;
  endMs: number;
};

/**
 * Busy time of a subscribed calendar (Settings → Calendar): grey, read only,
 * never a Gradus event; the subscription's name is its title.
 */
export type BusyCalendarItem = ItemBase & {
  type: "busy";
  /** The subscribed calendar, or "person:<id>" for someone's busy time read through a share. */
  subscriptionId: string;
  startMs: number;
  endMs: number;
};

/** Items that sit on the time axis and can be dragged. */
export type TimedItem = EventItem | TaskCalendarItem;
/** Everything drawn on the time axis: the draggable items and the busy times. */
export type LaidOutItem = TimedItem | BusyCalendarItem;

export type CalendarItem = EventItem | MirrorCalendarItem | TaskCalendarItem | BusyCalendarItem;

export type MirrorPrefs = {
  tasks: boolean;
  deals: boolean;
  crmTasks: boolean;
  subscriptions: boolean;
};
