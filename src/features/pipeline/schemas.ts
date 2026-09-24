import { z } from "zod";
import { CURRENCIES } from "@/lib/format";

export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2000;
export const REASON_MAX = 500;
export const STAGE_NAME_MAX = 40;
/** numeric(14, 2) in the database */
export const VALUE_MAX = 999_999_999_999.99;

/** Translation keys under `pipeline.errors`. */
export type PipelineErrorKey =
  | "titleRequired"
  | "titleTooLong"
  | "valueInvalid"
  | "descriptionTooLong"
  | "reasonTooLong"
  | "stageRequired"
  | "nameRequired"
  | "nameTooLong";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** "12 500,50" → 12500.5; empty → null; anything else → NaN. */
export function parseAmount(text: string): number | null {
  const clean = text.replace(/[\s ]/g, "").replace(",", ".");
  if (clean === "") return null;
  return /^\d+(\.\d{1,2})?$/.test(clean) ? Number(clean) : Number.NaN;
}

export const dealSchema = z.object({
  title: z.string().trim().min(1, "titleRequired").max(TITLE_MAX, "titleTooLong"),
  contact_id: z.string().uuid().nullable(),
  value: z
    .number()
    .min(0, "valueInvalid")
    .max(VALUE_MAX, "valueInvalid")
    .nullable()
    .refine((value) => value === null || Number.isFinite(value), "valueInvalid"),
  currency: z.enum(CURRENCIES),
  expected_close_date: isoDate.nullable(),
  stage_id: z.string().uuid("stageRequired"),
  description: z.string().trim().max(DESCRIPTION_MAX, "descriptionTooLong"),
  lost_reason: z.string().trim().max(REASON_MAX, "reasonTooLong"),
});
export type DealInput = z.infer<typeof dealSchema>;

export const stageSchema = z.object({
  name: z.string().trim().min(1, "nameRequired").max(STAGE_NAME_MAX, "nameTooLong"),
  color: z.enum(["violet", "teal", "gold", "green", "pink", "neutral"]),
  kind: z.enum(["open", "won", "lost"]),
});
export type StageInput = z.infer<typeof stageSchema>;

export const lostReasonSchema = z.string().trim().max(REASON_MAX, "reasonTooLong");

/** First error per field, as a translation key. */
export function fieldErrors(error: z.ZodError): Partial<Record<string, PipelineErrorKey>> {
  const result: Partial<Record<string, PipelineErrorKey>> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0]);
    result[field] ??= issue.message as PipelineErrorKey;
  }
  return result;
}
