import { z } from "zod";
import { FIELD_TYPES, MANUAL_ACTIVITY_TYPES, TABLE_TONES } from "./types";

export const NAME_MAX = 120;
export const EMAIL_MAX = 254;
export const PHONE_MAX = 40;
export const WEBSITE_MAX = 300;
export const ADDRESS_MAX = 300;
export const CITY_MAX = 120;
/** Same limit as the database checks. */
export const NOTES_MAX = 5000;
export const ACTIVITY_MAX = 5000;
/** Same limits as the database checks. */
export const TABLE_NAME_MAX = 40;
export const FIELD_LABEL_MAX = 120;
export const OPTION_LABEL_MAX = 80;

/** Translation keys under `contacts.errors`. */
export type ContactErrorKey =
  | "nameRequired"
  | "tooLong"
  | "emailInvalid"
  | "phoneInvalid"
  | "websiteInvalid"
  | "occurredAtRequired"
  | "occurredInFuture"
  | "tableNameRequired"
  | "labelRequired"
  | "optionsRequired"
  | "optionLabelRequired"
  | "optionsDuplicate"
  | "dependencyValueRequired";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "tooLong")
    .transform((value) => value || null);

export const contactSchema = z
  .object({
    company_name: optionalText(NAME_MAX),
    first_name: optionalText(NAME_MAX),
    last_name: optionalText(NAME_MAX),
    email: z
      .string()
      .trim()
      .max(EMAIL_MAX, "tooLong")
      .refine((value) => value === "" || z.email().safeParse(value).success, "emailInvalid")
      .transform((value) => value || null),
    phone: z
      .string()
      .trim()
      .max(PHONE_MAX, "tooLong")
      .refine((value) => value === "" || /^\+?[\d\s()./-]{3,}$/.test(value), "phoneInvalid")
      .transform((value) => value || null),
    website: z
      .string()
      .trim()
      .max(WEBSITE_MAX, "tooLong")
      .refine(
        (value) => value === "" || /^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i.test(value),
        "websiteInvalid",
      )
      .transform((value) => value || null),
    address: optionalText(ADDRESS_MAX),
    city: optionalText(CITY_MAX),
  })
  .refine((value) => value.company_name || value.first_name || value.last_name, {
    message: "nameRequired",
    path: ["company_name"],
  });
export type ContactInput = z.output<typeof contactSchema>;
export type ContactDraft = z.input<typeof contactSchema>;

export const notesSchema = z
  .string()
  .max(NOTES_MAX, "tooLong")
  .transform((value) => (value.trim() ? value : null));

export const activitySchema = z.object({
  type: z.enum(MANUAL_ACTIVITY_TYPES),
  content: optionalText(ACTIVITY_MAX),
  occurred_at: z
    .string("occurredAtRequired")
    .min(1, "occurredAtRequired")
    // A minute of slack for the clock of the device.
    .refine((value) => new Date(value).getTime() <= Date.now() + 60_000, "occurredInFuture"),
});
export type ActivityInput = z.output<typeof activitySchema>;

export const tableSchema = z.object({
  name: z.string().trim().min(1, "tableNameRequired").max(TABLE_NAME_MAX, "tooLong"),
  color: z.enum(TABLE_TONES),
});
export type TableInput = z.output<typeof tableSchema>;

export const fieldSchema = z
  .object({
    label: z.string().trim().min(1, "labelRequired").max(FIELD_LABEL_MAX, "tooLong"),
    type: z.enum(FIELD_TYPES),
    required: z.boolean(),
    options: z.array(
      z.object({
        key: z.string().min(1),
        label: z.string().trim().min(1, "optionLabelRequired").max(OPTION_LABEL_MAX, "tooLong"),
      }),
    ),
    depends_on_field_id: z.string().nullable(),
    depends_on_value: z.string().nullable(),
    meeting: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "select") {
      if (value.options.length === 0) {
        ctx.addIssue({ code: "custom", message: "optionsRequired", path: ["options"] });
      }
      const labels = value.options.map((option) => option.label.trim().toLowerCase());
      if (new Set(labels).size !== labels.length) {
        ctx.addIssue({ code: "custom", message: "optionsDuplicate", path: ["options"] });
      }
    }
    if (value.depends_on_field_id && !value.depends_on_value) {
      ctx.addIssue({
        code: "custom",
        message: "dependencyValueRequired",
        path: ["depends_on_value"],
      });
    }
  });
export type FieldInput = z.output<typeof fieldSchema>;

/** First error per field, as a translation key. */
export function fieldErrors(error: z.ZodError): Partial<Record<string, ContactErrorKey>> {
  const result: Partial<Record<string, ContactErrorKey>> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0]);
    result[field] ??= issue.message as ContactErrorKey;
  }
  return result;
}

/** "acme.cz" → "https://acme.cz"; links need a scheme. */
export function websiteHref(website: string): string {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}
