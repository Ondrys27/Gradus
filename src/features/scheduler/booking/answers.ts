import { isValidPhone, toE164 } from "@/lib/phone";
import type { Question } from "../types";

/**
 * The guest's answers to a meeting type's questions (24.4), checked the same
 * way in the browser (to show what is missing) and on the server (which
 * trusts nothing it is sent). The four built-in questions become the
 * booking's guest columns; the rest is kept by key in `bookings.answers`.
 */

export const GUEST_NAME_MAX = 120;
export const GUEST_EMAIL_MAX = 254;
export const GUEST_COMPANY_MAX = 160;
export const ANSWER_TEXT_MAX = 500;
export const ANSWER_TEXTAREA_MAX = 2000;

export type AnswerValue = string | boolean;
export type AnswerInput = Record<string, AnswerValue | undefined>;
export type AnswerError = "required" | "invalid" | "tooLong";

export type GuestDetails = {
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
};

export type CheckedAnswers =
  | { ok: true; guest: GuestDetails; answers: Record<string, AnswerValue> }
  | { ok: false; errors: Record<string, AnswerError> };

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function isGuestEmail(value: string): boolean {
  return value.length <= GUEST_EMAIL_MAX && EMAIL.test(value);
}

function textOf(value: AnswerValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function maxFor(question: Question): number {
  if (question.key === "name") return GUEST_NAME_MAX;
  if (question.key === "company") return GUEST_COMPANY_MAX;
  if (question.type === "email") return GUEST_EMAIL_MAX;
  return question.type === "textarea" ? ANSWER_TEXTAREA_MAX : ANSWER_TEXT_MAX;
}

/**
 * `country` reads a phone number typed without a prefix (the guest's country
 * from their time zone, else the host's).
 */
export function checkAnswers(
  questions: readonly Question[],
  input: AnswerInput,
  country: string | null,
): CheckedAnswers {
  const errors: Record<string, AnswerError> = {};
  const answers: Record<string, AnswerValue> = {};
  const guest: GuestDetails = { name: "", email: "", phone: null, company: null };
  // Name and e-mail are asked whatever the stored questions say.
  const list = [...questions];
  if (!list.some((q) => q.key === "name"))
    list.unshift({ key: "name", label: null, type: "text", required: true });
  if (!list.some((q) => q.key === "email"))
    list.splice(1, 0, { key: "email", label: null, type: "email", required: true });

  for (const question of list) {
    const raw = input[question.key];
    const required = question.required || question.key === "name" || question.key === "email";

    if (question.type === "checkbox") {
      const checked = raw === true;
      if (required && !checked) errors[question.key] = "required";
      else answers[question.key] = checked;
      continue;
    }

    const value = textOf(raw);
    if (!value) {
      if (required) errors[question.key] = "required";
      continue;
    }
    if (value.length > maxFor(question)) {
      errors[question.key] = "tooLong";
      continue;
    }

    if (question.type === "email" && !isGuestEmail(value)) {
      errors[question.key] = "invalid";
      continue;
    }
    if (question.type === "select" && !(question.options ?? []).includes(value)) {
      errors[question.key] = "invalid";
      continue;
    }
    if (question.type === "phone") {
      const saved = toE164(value, country);
      if (!saved || !/^\+[1-9]\d{6,14}$/.test(saved) || !isValidPhone(saved, country)) {
        errors[question.key] = "invalid";
        continue;
      }
      if (question.key === "phone") guest.phone = saved;
      else answers[question.key] = saved;
      continue;
    }

    if (question.key === "name") guest.name = value.replace(/\s+/g, " ");
    else if (question.key === "email") guest.email = value.toLowerCase();
    else if (question.key === "company") guest.company = value;
    else answers[question.key] = value;
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, guest, answers };
}

/**
 * The answers to the type's own questions as lines for the host ("Label: value"),
 * in the order of the questions; `yes` and `no` word a checkbox.
 */
export function answerLines(
  questions: readonly Question[],
  answers: Record<string, unknown>,
  words: { yes: string; no: string },
): string[] {
  const out: string[] = [];
  for (const question of questions) {
    if (question.label === null) continue;
    const value = answers[question.key];
    if (value === undefined || value === null || value === "") continue;
    const text =
      typeof value === "boolean" ? (value ? words.yes : words.no) : String(value).slice(0, 2000);
    out.push(`${question.label}: ${text}`);
  }
  return out;
}
