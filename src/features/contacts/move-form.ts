import { todayIsoDate, type FormatSettings } from "@/lib/format";
import { byPosition, fieldOptions } from "./field-logic";
import type { ContactField } from "./types";

/** Text, a `yyyy-MM-dd` date, an ISO instant or a yes/no. Keyed by question id. */
export type AnswerValue = string | boolean;
export type Answers = Record<string, AnswerValue | undefined>;
export type AnswerError = "required" | "invalid";

const TEXT_MAX = 5000;

/**
 * Questions shown for the answers so far, in order: those without a dependency,
 * and those whose question is shown and answered with the value they wait for.
 * Mirrors the check in move_contact().
 */
export function shownFields(fields: ContactField[], answers: Answers): ContactField[] {
  const byId = new Map(fields.map((field) => [field.id, field]));
  const memo = new Map<string, boolean>();
  function shown(field: ContactField, depth = 0): boolean {
    const known = memo.get(field.id);
    if (known !== undefined) return known;
    let result = true;
    if (field.depends_on_field_id) {
      const parent = byId.get(field.depends_on_field_id);
      result =
        parent !== undefined &&
        depth < fields.length &&
        shown(parent, depth + 1) &&
        answers[parent.id] === field.depends_on_value;
    }
    memo.set(field.id, result);
    return result;
  }
  return byPosition(fields).filter((field) => shown(field));
}

/** Prefilled answers: "today" for date questions and "now" for date-and-time ones that ask for it. */
export function initialAnswers(
  fields: ContactField[],
  settings: FormatSettings,
  now: Date = new Date(),
): Answers {
  const answers: Answers = {};
  for (const field of fields) {
    if (field.type === "date" && field.default_value === "today") {
      answers[field.id] = todayIsoDate(settings, now);
    } else if (field.type === "datetime" && field.default_value === "now") {
      answers[field.id] = now.toISOString();
    }
  }
  return answers;
}

function isEmpty(value: AnswerValue | undefined) {
  return value === undefined || (typeof value === "string" && value.trim() === "");
}

function isValid(field: ContactField, value: AnswerValue): boolean {
  switch (field.type) {
    case "boolean":
      return typeof value === "boolean";
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
    case "datetime":
      return typeof value === "string" && !Number.isNaN(Date.parse(value));
    case "select":
      return (
        typeof value === "string" &&
        fieldOptions(field.options).some((option) => option.key === value)
      );
    default:
      return typeof value === "string" && value.length <= TEXT_MAX;
  }
}

/** Problems of the shown questions; hidden ones are never checked. */
export function answerErrors(
  fields: ContactField[],
  answers: Answers,
): Record<string, AnswerError> {
  const errors: Record<string, AnswerError> = {};
  for (const field of shownFields(fields, answers)) {
    const value = answers[field.id];
    if (isEmpty(value)) {
      if (field.required) errors[field.id] = "required";
    } else if (!isValid(field, value as AnswerValue)) {
      errors[field.id] = "invalid";
    }
  }
  return errors;
}

/** What gets sent: answers of shown questions only, text trimmed, empty ones left out. */
export function answersToSave(
  fields: ContactField[],
  answers: Answers,
): Record<string, AnswerValue> {
  const result: Record<string, AnswerValue> = {};
  for (const field of shownFields(fields, answers)) {
    const value = answers[field.id];
    if (isEmpty(value)) continue;
    result[field.id] = typeof value === "string" ? value.trim() : (value as boolean);
  }
  return result;
}
