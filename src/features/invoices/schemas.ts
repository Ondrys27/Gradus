import { z } from "zod";
import { isValidIco } from "./ico";
import { BANK_CODE_PATTERN, CZ_ACCOUNT_PATTERN, isValidCzAccount, isValidIban, normalizeIban } from "./iban";
import { INVOICE_LOCALES, INVOICE_STYLES } from "./types";

/**
 * What the screens send to the server. The same limits as the database, so
 * a refusal there is a bug, not a user mistake. Messages are keys under
 * `invoices.errors`.
 */

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "tooLong")
    .transform((value) => (value === "" ? null : value));

const decimals = (value: number, places: number) =>
  Math.abs(Math.round(value * 10 ** places) - value * 10 ** places) < 1e-6;

export const invoiceItemSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().max(200, "tooLong"),
  quantity: z
    .number()
    .finite()
    .min(-1_000_000)
    .max(1_000_000, "quantityInvalid")
    .refine((value) => decimals(value, 3), "quantityInvalid"),
  unit: z.string().trim().max(20, "tooLong"),
  unit_price: z
    .number()
    .finite()
    .min(-1_000_000_000)
    .max(1_000_000_000, "priceInvalid")
    .refine((value) => decimals(value, 2), "priceInvalid"),
  vat_rate: z
    .number()
    .finite()
    .min(0, "rateInvalid")
    .max(100, "rateInvalid")
    .refine((value) => decimals(value, 2), "rateInvalid"),
});

export const invoicePartySchema = z.object({
  name: text(200),
  company_reg_no: text(20),
  vat_no: text(20),
  street: text(200),
  city: text(100),
  postal_code: text(20),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z]{2})?$/)
    .transform((value) => value || null),
  email: z
    .string()
    .trim()
    .max(254)
    .refine((value) => value === "" || z.email().safeParse(value).success, "emailInvalid")
    .transform((value) => (value === "" ? null : value.toLowerCase())),
});
export type InvoicePartyInput = z.input<typeof invoicePartySchema>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

export const invoiceDraftSchema = z.object({
  id: z.uuid().nullable(),
  contactId: z.uuid().nullable(),
  dealId: z.uuid().nullable(),
  /** Also write the customer's details back to the contact. */
  saveToContact: z.boolean(),
  customer: invoicePartySchema,
  items: z.array(invoiceItemSchema).max(100),
  currency: z.string().regex(/^[A-Z]{3}$/),
  issuedOn: isoDate,
  taxableOn: isoDate,
  dueOn: isoDate,
  variableSymbol: z
    .string()
    .trim()
    .regex(/^\d{0,10}$/, "variableSymbolInvalid")
    .transform((value) => value || null),
  note: text(1000),
  locale: z.enum(INVOICE_LOCALES),
});
export type InvoiceDraftInput = z.input<typeof invoiceDraftSchema>;

export const invoiceProfileSchema = z
  .object({
    name: z.string().trim().min(1, "nameRequired").max(200, "tooLong"),
    company_reg_no: text(20),
    vat_no: text(20),
    vat_payer: z.boolean(),
    street: text(200),
    city: text(100),
    postal_code: text(20),
    country: z.string().regex(/^[A-Z]{2}$/),
    email: z
      .string()
      .trim()
      .max(254)
      .refine((value) => value === "" || z.email().safeParse(value).success, "emailInvalid")
      .transform((value) => (value === "" ? null : value.toLowerCase())),
    phone: text(30),
    account_number: z
      .string()
      .transform((value) => value.replace(/\s+/g, ""))
      .refine((value) => value === "" || CZ_ACCOUNT_PATTERN.test(value), "accountInvalid")
      .transform((value) => value || null),
    bank_code: z
      .string()
      .trim()
      .refine((value) => value === "" || BANK_CODE_PATTERN.test(value), "bankCodeInvalid")
      .transform((value) => value || null),
    iban: z
      .string()
      .transform(normalizeIban)
      .refine((value) => value === "" || isValidIban(value), "ibanInvalid")
      .transform((value) => value || null),
    bic: z
      .string()
      .trim()
      .toUpperCase()
      .refine((value) => value === "" || /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(value), "bicInvalid")
      .transform((value) => value || null),
    due_days: z.number().int("dueDaysInvalid").min(0, "dueDaysInvalid").max(365, "dueDaysInvalid"),
    currency: z.string().regex(/^[A-Z]{3}$/),
    number_prefix: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{0,10}$/, "prefixInvalid"),
    footer_text: text(500),
    style: z.enum(INVOICE_STYLES),
    accent_color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/, "colorInvalid")
      .transform((value) => value.toUpperCase()),
    qr_enabled: z.boolean(),
  })
  .superRefine((profile, ctx) => {
    if (profile.vat_payer && !profile.vat_no) {
      ctx.addIssue({ code: "custom", path: ["vat_no"], message: "vatNoRequired" });
    }
    if (profile.country === "CZ" && profile.company_reg_no && !isValidIco(profile.company_reg_no)) {
      ctx.addIssue({ code: "custom", path: ["company_reg_no"], message: "icoInvalid" });
    }
    if (profile.account_number && !isValidCzAccount(profile.account_number)) {
      ctx.addIssue({ code: "custom", path: ["account_number"], message: "accountInvalid" });
    }
    if (Boolean(profile.account_number) !== Boolean(profile.bank_code)) {
      ctx.addIssue({
        code: "custom",
        path: [profile.account_number ? "bank_code" : "account_number"],
        message: "accountIncomplete",
      });
    }
  });
export type InvoiceProfileInput = z.input<typeof invoiceProfileSchema>;
export type InvoiceProfileValues = z.output<typeof invoiceProfileSchema>;

export const invoiceEmailSchema = z.object({
  invoiceId: z.uuid(),
  to: z.email("emailInvalid").max(254),
  subject: z.string().trim().min(1, "subjectRequired").max(200, "tooLong"),
  body: z.string().trim().min(1, "bodyRequired").max(5000, "tooLong"),
  ccSelf: z.boolean(),
});
export type InvoiceEmailInput = z.input<typeof invoiceEmailSchema>;

/** The first message of each field, for the form. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
