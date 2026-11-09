import type { Tone } from "@/components/ui/tone";
import type { Json } from "@/types/database";
import { isValidSlug } from "./handle";
import {
  BUFFER_MAX,
  BUILTIN_QUESTIONS,
  CONFIRMATION_NOTE_MAX,
  DEFAULT_QUESTIONS,
  DEFAULT_REMINDERS,
  DESCRIPTION_MAX,
  DURATION_MAX,
  DURATION_MIN,
  HORIZON_MAX_DAYS,
  LABEL_MAX,
  LOCATION_KINDS,
  LOCATION_TEXT_MAX,
  LOCKED_QUESTIONS,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  MAX_REMINDERS,
  NAME_MAX,
  NOTICE_MAX_HOURS,
  OPTION_MAX,
  PER_DAY_MAX,
  QUESTION_TYPES,
  REMINDER_MAX,
  REMINDER_MIN,
  SLOT_STEPS,
  TYPE_TONES,
  type BuiltinQuestion,
  type EventType,
  type EventTypeRow,
  type LocationKind,
  type Question,
  type QuestionType,
  type Reminder,
} from "./types";

/**
 * A meeting type as the editor holds it, and the checks it passes before it
 * is saved. The database checks the same (scheduler_questions_valid,
 * scheduler_reminders_valid and the column checks); these give the message.
 */

const isBuiltin = (key: string): key is BuiltinQuestion =>
  (BUILTIN_QUESTIONS as readonly string[]).includes(key);

/** Questions from the database, anything unexpected dropped; name and e-mail always there. */
export function parseQuestions(value: Json | unknown): Question[] {
  if (!Array.isArray(value)) return DEFAULT_QUESTIONS.map((question) => ({ ...question }));
  const out: Question[] = [];
  const keys = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const key = typeof item.key === "string" ? item.key : "";
    const type = item.type as QuestionType;
    if (!key || keys.has(key) || !(QUESTION_TYPES as readonly string[]).includes(type)) continue;
    keys.add(key);
    const label = typeof item.label === "string" ? item.label : null;
    const options = Array.isArray(item.options)
      ? item.options.filter((option): option is string => typeof option === "string")
      : undefined;
    out.push({
      key,
      label,
      type,
      required: item.required === true,
      ...(type === "select" ? { options: options ?? [] } : {}),
    });
  }
  for (const locked of [...LOCKED_QUESTIONS].reverse()) {
    if (!keys.has(locked)) out.unshift({ ...DEFAULT_QUESTIONS.find((q) => q.key === locked)! });
  }
  return out;
}

export function parseReminders(value: Json | unknown): Reminder[] {
  if (!Array.isArray(value)) return DEFAULT_REMINDERS.map((reminder) => ({ ...reminder }));
  return value
    .filter(
      (raw): raw is { offset_minutes: number } =>
        Boolean(raw) && typeof (raw as Record<string, unknown>).offset_minutes === "number",
    )
    .map((raw) => ({ offset_minutes: raw.offset_minutes, channel: "email" as const }));
}

export function toEventType(row: EventTypeRow): EventType {
  return {
    ...row,
    questions: parseQuestions(row.questions),
    reminders: parseReminders(row.reminders),
    location_kind: (LOCATION_KINDS as readonly string[]).includes(row.location_kind)
      ? (row.location_kind as LocationKind)
      : "video",
    color: (TYPE_TONES as readonly string[]).includes(row.color) ? (row.color as Tone) : "violet",
  };
}

/** What the editor changes; the rest of the row stays as it is. */
export type EventTypeDraft = Pick<
  EventType,
  | "name"
  | "slug"
  | "description"
  | "duration_min"
  | "location_kind"
  | "location_text"
  | "color"
  | "requires_approval"
  | "buffer_before_min"
  | "buffer_after_min"
  | "min_notice_hours"
  | "max_days_ahead"
  | "max_per_day"
  | "slot_step_min"
  | "custom_availability"
  | "questions"
  | "reminders"
  | "deal_stage_id"
  | "confirmation_note"
>;

export function draftOf(type: EventType): EventTypeDraft {
  return {
    name: type.name,
    slug: type.slug,
    description: type.description,
    duration_min: type.duration_min,
    location_kind: type.location_kind,
    location_text: type.location_text,
    color: type.color,
    requires_approval: type.requires_approval,
    buffer_before_min: type.buffer_before_min,
    buffer_after_min: type.buffer_after_min,
    min_notice_hours: type.min_notice_hours,
    max_days_ahead: type.max_days_ahead,
    max_per_day: type.max_per_day,
    slot_step_min: type.slot_step_min,
    custom_availability: type.custom_availability,
    questions: type.questions.map((question) => ({ ...question })),
    reminders: type.reminders.map((reminder) => ({ ...reminder })),
    deal_stage_id: type.deal_stage_id,
    confirmation_note: type.confirmation_note,
  };
}

export type DraftIssue =
  | { field: "name"; code: "required" | "tooLong" }
  | { field: "slug"; code: "format" | "taken" }
  | { field: "description" | "confirmation_note" | "location_text"; code: "tooLong" }
  | { field: "location_text"; code: "required" }
  | { field: "duration_min" | "buffers" | "notice" | "horizon" | "perDay" | "step"; code: "range" }
  | { field: "questions"; code: "tooMany" | "label" | "options" | "locked"; index?: number }
  | { field: "reminders"; code: "tooMany" | "range" | "duplicate"; index?: number };

const inRange = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max;

/** Everything wrong with a draft, in the editor's order; empty when it can be saved. */
export function draftIssues(
  draft: EventTypeDraft,
  otherSlugs: Iterable<string> = [],
): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const name = draft.name.trim();
  if (!name) issues.push({ field: "name", code: "required" });
  else if (name.length > NAME_MAX) issues.push({ field: "name", code: "tooLong" });
  if (!isValidSlug(draft.slug)) issues.push({ field: "slug", code: "format" });
  else if (new Set(otherSlugs).has(draft.slug)) issues.push({ field: "slug", code: "taken" });
  if ((draft.description ?? "").length > DESCRIPTION_MAX)
    issues.push({ field: "description", code: "tooLong" });
  if ((draft.confirmation_note ?? "").length > CONFIRMATION_NOTE_MAX) {
    issues.push({ field: "confirmation_note", code: "tooLong" });
  }
  const place = (draft.location_text ?? "").trim();
  if (place.length > LOCATION_TEXT_MAX) issues.push({ field: "location_text", code: "tooLong" });
  else if ((draft.location_kind === "in_person" || draft.location_kind === "custom") && !place) {
    issues.push({ field: "location_text", code: "required" });
  }
  if (!inRange(draft.duration_min, DURATION_MIN, DURATION_MAX))
    issues.push({ field: "duration_min", code: "range" });
  if (
    !inRange(draft.buffer_before_min, 0, BUFFER_MAX) ||
    !inRange(draft.buffer_after_min, 0, BUFFER_MAX)
  ) {
    issues.push({ field: "buffers", code: "range" });
  }
  if (!inRange(draft.min_notice_hours, 0, NOTICE_MAX_HOURS))
    issues.push({ field: "notice", code: "range" });
  if (!inRange(draft.max_days_ahead, 1, HORIZON_MAX_DAYS))
    issues.push({ field: "horizon", code: "range" });
  if (draft.max_per_day !== null && !inRange(draft.max_per_day, 1, PER_DAY_MAX)) {
    issues.push({ field: "perDay", code: "range" });
  }
  if (!(SLOT_STEPS as readonly number[]).includes(draft.slot_step_min))
    issues.push({ field: "step", code: "range" });

  if (draft.questions.length > MAX_QUESTIONS) issues.push({ field: "questions", code: "tooMany" });
  for (const locked of LOCKED_QUESTIONS) {
    const question = draft.questions.find((item) => item.key === locked);
    if (!question || !question.required) issues.push({ field: "questions", code: "locked" });
  }
  draft.questions.forEach((question, index) => {
    const label = (question.label ?? "").trim();
    if (!isBuiltin(question.key) && (!label || label.length > LABEL_MAX)) {
      issues.push({ field: "questions", code: "label", index });
    } else if (label.length > LABEL_MAX) {
      issues.push({ field: "questions", code: "label", index });
    }
    if (question.type === "select") {
      const options = (question.options ?? []).map((option) => option.trim()).filter(Boolean);
      if (
        !options.length ||
        options.length > MAX_OPTIONS ||
        options.some((option) => option.length > OPTION_MAX)
      ) {
        issues.push({ field: "questions", code: "options", index });
      }
    }
  });

  if (draft.reminders.length > MAX_REMINDERS) issues.push({ field: "reminders", code: "tooMany" });
  const offsets = new Set<number>();
  draft.reminders.forEach((reminder, index) => {
    if (!inRange(reminder.offset_minutes, REMINDER_MIN, REMINDER_MAX)) {
      issues.push({ field: "reminders", code: "range", index });
    } else if (offsets.has(reminder.offset_minutes)) {
      issues.push({ field: "reminders", code: "duplicate", index });
    }
    offsets.add(reminder.offset_minutes);
  });
  return issues;
}

/** The draft as the database stores it: trimmed, empty texts null, options cleaned. */
export function draftToRow(draft: EventTypeDraft) {
  const text = (value: string | null) => {
    const clean = (value ?? "").trim();
    return clean ? clean : null;
  };
  return {
    name: draft.name.trim(),
    slug: draft.slug,
    description: text(draft.description),
    duration_min: draft.duration_min,
    location_kind: draft.location_kind,
    location_text:
      draft.location_kind === "in_person" ||
      draft.location_kind === "custom" ||
      draft.location_kind === "phone"
        ? text(draft.location_text)
        : null,
    color: draft.color,
    requires_approval: draft.requires_approval,
    buffer_before_min: draft.buffer_before_min,
    buffer_after_min: draft.buffer_after_min,
    min_notice_hours: draft.min_notice_hours,
    max_days_ahead: draft.max_days_ahead,
    max_per_day: draft.max_per_day,
    slot_step_min: draft.slot_step_min,
    custom_availability: draft.custom_availability,
    questions: draft.questions.map((question) => ({
      key: question.key,
      label:
        isBuiltin(question.key) && !(question.label ?? "").trim()
          ? null
          : (question.label ?? "").trim(),
      type: question.type,
      required: LOCKED_QUESTIONS.includes(question.key as BuiltinQuestion)
        ? true
        : question.required,
      ...(question.type === "select"
        ? { options: (question.options ?? []).map((option) => option.trim()).filter(Boolean) }
        : {}),
    })) as unknown as Json,
    reminders: [...draft.reminders]
      .sort((a, b) => b.offset_minutes - a.offset_minutes)
      .map((reminder) => ({
        offset_minutes: reminder.offset_minutes,
        channel: "email",
      })) as unknown as Json,
    deal_stage_id: draft.deal_stage_id,
    confirmation_note: text(draft.confirmation_note),
  };
}

/** A new custom question with a key nobody else in the list has. */
export function newQuestion(existing: readonly Question[], type: QuestionType = "text"): Question {
  const keys = new Set(existing.map((question) => question.key));
  let n = existing.length + 1;
  while (keys.has(`q${n}`)) n++;
  return {
    key: `q${n}`,
    label: "",
    type,
    required: false,
    ...(type === "select" ? { options: [""] } : {}),
  };
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length)
    return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function isRemovableQuestion(question: Question): boolean {
  return !LOCKED_QUESTIONS.includes(question.key as BuiltinQuestion);
}

export function isBuiltinQuestion(
  question: Question,
): question is Question & { key: BuiltinQuestion } {
  return isBuiltin(question.key);
}

// ---------------------------------------------------------------------------
// Which type to offer
// ---------------------------------------------------------------------------

export type LinkPurpose = "intro" | "meeting";

/**
 * The meeting type to send a link to: active ones only, in the person's
 * order. A first call with a lead ("intro", Cold Calling) is the shortest;
 * a meeting about a deal or an offer (an e-mail) the one closest to 30
 * minutes. Null without an active type.
 */
export function pickEventType<
  T extends Pick<EventType, "id" | "active" | "duration_min" | "position">,
>(types: readonly T[], purpose: LinkPurpose): T | null {
  const active = types.filter((type) => type.active).sort((a, b) => a.position - b.position);
  if (!active.length) return null;
  const score = (type: T) =>
    purpose === "intro"
      ? type.duration_min
      : Math.abs(type.duration_min - 30) * 2 + (type.duration_min < 30 ? 1 : 0);
  return active.reduce((best, type) => (score(type) < score(best) ? type : best));
}
