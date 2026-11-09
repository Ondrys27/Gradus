import type { Tone } from "@/components/ui/tone";
import type { Database } from "@/types/database";

/**
 * The scheduler (24.3): a person's booking page, meeting types and hours.
 * The same limits are checked by the database (20261116090000_scheduler.sql);
 * these only shape the forms.
 */

type Tables = Database["public"]["Tables"];

export type SchedulerProfile = Pick<
  Tables["scheduler_profiles"]["Row"],
  | "id"
  | "user_id"
  | "space_id"
  | "handle"
  | "display_name"
  | "headline"
  | "bio"
  | "time_zone"
  | "video_link"
  | "setup_done_at"
>;
export const PROFILE_COLUMNS =
  "id, user_id, space_id, handle, display_name, headline, bio, time_zone, video_link, setup_done_at";

export type EventTypeRow = Tables["event_types"]["Row"];
export const EVENT_TYPE_COLUMNS =
  "id, profile_id, user_id, space_id, slug, name, description, duration_min, location_kind, location_text, color, active, position, requires_approval, buffer_before_min, buffer_after_min, min_notice_hours, max_days_ahead, max_per_day, slot_step_min, custom_availability, questions, deal_stage_id, reminders, confirmation_note, created_at, updated_at";

export type AvailabilityRule = Pick<
  Tables["availability_rules"]["Row"],
  "id" | "profile_id" | "event_type_id" | "weekday" | "start_time" | "end_time"
>;
export const RULE_COLUMNS = "id, profile_id, event_type_id, weekday, start_time, end_time";

export type AvailabilityOverride = Pick<
  Tables["availability_overrides"]["Row"],
  "id" | "profile_id" | "date" | "start_time" | "end_time"
>;
export const OVERRIDE_COLUMNS = "id, profile_id, date, start_time, end_time";

export type BookingRow = Pick<
  Tables["bookings"]["Row"],
  | "id"
  | "event_type_id"
  | "host_user_id"
  | "space_id"
  | "starts_at"
  | "ends_at"
  | "guest_name"
  | "guest_email"
  | "guest_phone"
  | "guest_company"
  | "guest_time_zone"
  | "status"
  | "hold_expires_at"
  | "contact_id"
  | "cancelled_by"
  | "cancel_reason"
  | "created_at"
>;
export const BOOKING_COLUMNS =
  "id, event_type_id, host_user_id, space_id, starts_at, ends_at, guest_name, guest_email, guest_phone, guest_company, guest_time_zone, status, hold_expires_at, contact_id, cancelled_by, cancel_reason, created_at";

export type CalendarSubscription = Pick<
  Tables["calendar_subscriptions"]["Row"],
  | "id"
  | "name"
  | "color"
  | "url_hint"
  | "show_in_calendar"
  | "last_fetched_at"
  | "last_status"
  | "last_error"
  | "busy_until"
  | "created_at"
>;
/** Never `url_cipher`: the client has no grant on it. */
export const SUBSCRIPTION_COLUMNS =
  "id, name, color, url_hint, show_in_calendar, last_fetched_at, last_status, last_error, busy_until, created_at";

// ---------------------------------------------------------------------------
// Meeting types
// ---------------------------------------------------------------------------

export const DURATION_PRESETS = [15, 20, 30, 45, 60, 90, 120] as const;
export const DURATION_MIN = 5;
export const DURATION_MAX = 480;

export const LOCATION_KINDS = ["video", "phone", "in_person", "custom"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const SLOT_STEPS = [15, 30, 60] as const;
export type SlotStep = (typeof SLOT_STEPS)[number];

export const TYPE_TONES = [
  "violet",
  "teal",
  "gold",
  "green",
  "pink",
  "neutral",
] as const satisfies readonly Tone[];

export const QUESTION_TYPES = ["text", "textarea", "phone", "email", "select", "checkbox"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Asked on every booking page; the page names them in the guest's language. */
export const BUILTIN_QUESTIONS = ["name", "email", "phone", "company"] as const;
export type BuiltinQuestion = (typeof BUILTIN_QUESTIONS)[number];
/** Never removed, never optional. */
export const LOCKED_QUESTIONS: readonly BuiltinQuestion[] = ["name", "email"];

export type Question = {
  key: string;
  /** Null for the built-in four. */
  label: string | null;
  type: QuestionType;
  required: boolean;
  /** Only for `select`. */
  options?: string[];
};

export const DEFAULT_QUESTIONS: Question[] = [
  { key: "name", label: null, type: "text", required: true },
  { key: "email", label: null, type: "email", required: true },
  { key: "phone", label: null, type: "phone", required: true },
  { key: "company", label: null, type: "text", required: false },
];

export const MAX_QUESTIONS = 20;
export const MAX_OPTIONS = 30;
export const LABEL_MAX = 200;
export const OPTION_MAX = 100;

export type Reminder = { offset_minutes: number; channel: "email" };
export const DEFAULT_REMINDERS: Reminder[] = [
  { offset_minutes: 1440, channel: "email" },
  { offset_minutes: 60, channel: "email" },
];
export const MAX_REMINDERS = 5;
export const REMINDER_MIN = 5;
export const REMINDER_MAX = 10_080;
/** What the reminder picker offers, in minutes before the start. */
export const REMINDER_PRESETS = [10, 15, 30, 60, 120, 240, 1440, 2880, 10_080] as const;

export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 2000;
export const LOCATION_TEXT_MAX = 300;
export const CONFIRMATION_NOTE_MAX = 1000;
export const BUFFER_MAX = 240;
export const NOTICE_MAX_HOURS = 720;
/** The busy times of subscribed calendars reach 60 days ahead; so does booking. */
export const HORIZON_MAX_DAYS = 60;
export const PER_DAY_MAX = 100;

export type EventType = Omit<
  EventTypeRow,
  "questions" | "reminders" | "location_kind" | "color"
> & {
  questions: Question[];
  reminders: Reminder[];
  location_kind: LocationKind;
  color: Tone;
};

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;
export const HEADLINE_MAX = 120;
export const BIO_MAX = 1000;
export const VIDEO_LINK_MAX = 500;

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

export const BOOKING_STATUSES = [
  "held",
  "pending",
  "confirmed",
  "cancelled",
  "declined",
  "rescheduled",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
/** Statuses that hold the host's time (with an unexpired hold for `held`). */
export const ACTIVE_BOOKING_STATUSES: readonly BookingStatus[] = ["held", "pending", "confirmed"];

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export const SUBSCRIPTION_NAME_MAX = 60;
export const MAX_SUBSCRIPTIONS = 10;
/** The cache is refreshed in the background when it is older than this (24.4). */
export const SUBSCRIPTION_STALE_MS = 10 * 60_000;
export const BUSY_HORIZON_DAYS = 60;

/** Where the section lives. */
export const SCHEDULER_PATH = "/app/planovac";
/** Its tabs, `?tab=` in the address. */
export const SCHEDULER_TABS = ["types", "availability", "bookings", "team"] as const;
export type SchedulerTab = (typeof SCHEDULER_TABS)[number];
