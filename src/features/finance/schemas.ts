import { z } from "zod";
import { parseAmount, VALUE_MAX } from "@/features/pipeline/schemas";
import { ALL_CATEGORIES, FREQUENCIES, TRANSACTION_TYPES, type Frequency } from "./types";

export const DESCRIPTION_MAX = 200;

/** Translation keys under `finance.errors`. */
export type FinanceErrorKey =
  | "amountInvalid"
  | "descriptionRequired"
  | "descriptionTooLong"
  | "dateRequired"
  | "endBeforeStart";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateRequired");

const money = z
  .number()
  .positive("amountInvalid")
  .max(VALUE_MAX, "amountInvalid")
  .refine(Number.isFinite, "amountInvalid");

const base = {
  type: z.enum(TRANSACTION_TYPES as [string, ...string[]]) as z.ZodType<"income" | "expense">,
  amount: money,
  currency: z.string().length(3),
  category: z.enum(ALL_CATEGORIES as [string, ...string[]]).nullable(),
  description: z.string().trim().max(DESCRIPTION_MAX, "descriptionTooLong"),
};

export const transactionSchema = z.object({ ...base, occurred_on: isoDate });
export type TransactionInput = z.infer<typeof transactionSchema>;

export const recurringSchema = z
  .object({
    ...base,
    description: base.description.min(1, "descriptionRequired"),
    frequency: z.enum(FREQUENCIES as [string, ...string[]]) as z.ZodType<Frequency>,
    next_due_on: isoDate,
    ends_on: isoDate.nullable(),
  })
  .superRefine((payment, context) => {
    if (payment.ends_on && payment.ends_on < payment.next_due_on) {
      context.addIssue({ code: "custom", path: ["ends_on"], message: "endBeforeStart" });
    }
  });
export type RecurringInput = z.infer<typeof recurringSchema>;

export type Validated<T> =
  | { ok: true; data: T }
  | { ok: false; errors: Partial<Record<string, FinanceErrorKey>> };

/** The first message per field, as translation keys. */
function firstErrors(error: z.ZodError): Partial<Record<string, FinanceErrorKey>> {
  const errors: Partial<Record<string, FinanceErrorKey>> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "amount");
    errors[key] ??= issue.message as FinanceErrorKey;
  }
  return errors;
}

/** The amount arrives as typed; anything that is not a positive amount is `amountInvalid`. */
export function amountFromText(text: string): number {
  const value = parseAmount(text);
  return value === null ? Number.NaN : value;
}

export function validateTransaction(draft: {
  type: "income" | "expense";
  amount: string;
  currency: string;
  category: string | null;
  description: string;
  occurred_on: string | null;
}): Validated<TransactionInput> {
  const result = transactionSchema.safeParse({
    ...draft,
    amount: amountFromText(draft.amount),
    occurred_on: draft.occurred_on ?? "",
  });
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, errors: firstErrors(result.error) };
}

export function validateRecurring(draft: {
  type: "income" | "expense";
  amount: string;
  currency: string;
  category: string | null;
  description: string;
  frequency: Frequency;
  next_due_on: string | null;
  ends_on: string | null;
}): Validated<RecurringInput> {
  const result = recurringSchema.safeParse({
    ...draft,
    amount: amountFromText(draft.amount),
    next_due_on: draft.next_due_on ?? "",
  });
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, errors: firstErrors(result.error) };
}
