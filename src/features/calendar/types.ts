import type { Tone } from "@/components/ui/tone";
import type { IsoDate } from "@/lib/format";
import type { Database } from "@/types/database";

type Tables = Database["public"]["Tables"];

export const EVENT_COLUMNS =
  "id, title, description, kind, starts_at, ends_at, all_day, contact_id, deal_id, source, contact:contacts(id, company_name, first_name, last_name), deal:deals(id, title)";

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
>;

export type EventContact = Pick<
  Tables["contacts"]["Row"],
  "id" | "company_name" | "first_name" | "last_name"
>;

export type CalendarEvent = CalendarEventRow & {
  contact: EventContact | null;
  deal: Pick<Tables["deals"]["Row"], "id" | "title"> | null;
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
  /** Calendar day of the due date or expected close. */
  date: IsoDate;
  /** Where the source lives; opened on click. */
  href: string;
};

type ItemBase = {
  key: string;
  title: string;
  tone: Tone;
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

export type CalendarItem = EventItem | MirrorCalendarItem;

export type MirrorPrefs = { tasks: boolean; deals: boolean };
