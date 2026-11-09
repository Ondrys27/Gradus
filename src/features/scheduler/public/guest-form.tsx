"use client";

import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import type { AnswerError, AnswerInput } from "../booking/answers";
import type { Question } from "../types";

/**
 * The questions of a meeting type as a form (24.4): the four built-in ones
 * named in the guest's language, the host's own with their labels. A hidden
 * honeypot field (`website`) catches bots; people never see it.
 */
export function GuestForm({
  questions,
  values,
  errors,
  country,
  honeypot,
  onChange,
  onHoneypot,
}: {
  questions: readonly Question[];
  values: AnswerInput;
  errors: Record<string, AnswerError>;
  country: string | null;
  honeypot: string;
  onChange: (key: string, value: string | boolean) => void;
  onHoneypot: (value: string) => void;
}) {
  const t = useTranslations("booking.form");
  return (
    <div className="flex flex-col gap-4" data-testid="booking-form">
      {questions.map((question) => {
        const id = `booking-${question.key}`;
        const label =
          question.label ??
          (["name", "email", "phone", "company"].includes(question.key)
            ? t(`fields.${question.key as "name" | "email" | "phone" | "company"}`)
            : question.key);
        const required = question.required || question.key === "name" || question.key === "email";
        const error = errors[question.key] ? t(`errors.${errors[question.key]}`) : null;
        const shown = required ? `${label} *` : label;
        const value = values[question.key];
        if (question.type === "checkbox") {
          return (
            <div key={question.key} className="flex flex-col gap-1">
              <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
                <Checkbox
                  id={id}
                  checked={value === true}
                  onCheckedChange={(checked) => onChange(question.key, checked === true)}
                  aria-invalid={Boolean(error) || undefined}
                />
                {shown}
              </label>
              {error && <p className="text-xs text-pink">{error}</p>}
            </div>
          );
        }
        const text = typeof value === "string" ? value : "";
        return (
          <FormField key={question.key} id={id} label={shown} error={error}>
            {question.type === "textarea" ? (
              <Textarea
                value={text}
                rows={4}
                onChange={(event) => onChange(question.key, event.target.value)}
                {...fieldA11y(id, error)}
              />
            ) : question.type === "phone" ? (
              <PhoneInput
                value={text}
                country={country}
                onChange={(next) => onChange(question.key, next)}
                autoComplete="tel"
                {...fieldA11y(id, error)}
              />
            ) : question.type === "select" ? (
              <select
                value={text}
                onChange={(event) => onChange(question.key, event.target.value)}
                className="field"
                {...fieldA11y(id, error)}
              >
                <option value="">{t("choose")}</option>
                {(question.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                type={question.type === "email" ? "email" : "text"}
                value={text}
                autoComplete={
                  question.key === "name"
                    ? "name"
                    : question.key === "email"
                      ? "email"
                      : question.key === "company"
                        ? "organization"
                        : "off"
                }
                onChange={(event) => onChange(question.key, event.target.value)}
                {...fieldA11y(id, error)}
              />
            )}
          </FormField>
        );
      })}
      {/* The honeypot: off screen, out of the tab order, never filled by a person. */}
      <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="booking-website">{t("honeypot")}</label>
        <input
          id="booking-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(event) => onHoneypot(event.target.value)}
        />
      </div>
    </div>
  );
}
