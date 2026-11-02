import { z } from "zod";
import { PAID_PLAN_KEYS } from "@/config/pricing";
import { BILLINGS, CANCEL_NOTE_MAX, CANCEL_REASONS } from "./state";

/**
 * What the subscription page sends to the server. The same limits as the
 * database (billing_profiles, subscription_cancel), so a refusal there is a
 * bug, not a user mistake. Messages are keys under `subscription.errors`.
 */

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "tooLong")
    .transform((value) => (value === "" ? null : value));

export const planChoiceSchema = z.object({
  planKey: z.enum(PAID_PLAN_KEYS),
  billing: z.enum(BILLINGS),
});
export type PlanChoiceInput = z.input<typeof planChoiceSchema>;

export const cancelSchema = z.object({
  reason: z.enum(CANCEL_REASONS, "reasonRequired"),
  note: z
    .string()
    .trim()
    .max(CANCEL_NOTE_MAX, "tooLong")
    .transform((value) => (value === "" ? null : value)),
});
export type CancelInput = z.input<typeof cancelSchema>;

export const billingProfileSchema = z.object({
  name: z.string().trim().min(1, "nameRequired").max(200, "tooLong"),
  company_reg_no: text(20),
  vat_no: text(20),
  street: text(200),
  city: text(100),
  postal_code: text(20),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "countryInvalid"),
  email: z
    .string()
    .trim()
    .max(254, "tooLong")
    .refine((value) => value === "" || z.email().safeParse(value).success, "emailInvalid")
    .transform((value) => (value === "" ? null : value.toLowerCase())),
});
export type BillingProfileInput = z.input<typeof billingProfileSchema>;
export type BillingProfile = z.output<typeof billingProfileSchema>;

export const BILLING_PROFILE_COLUMNS =
  "name, company_reg_no, vat_no, street, city, postal_code, country, email";
