import type { BillingProfile } from "@/features/subscription/schemas";

/**
 * The Stripe customer of a workspace from its billing details (step 23.1):
 * name or company, address, country, the e-mail for receipts, the VAT number
 * as an `eu_vat` tax id (only a number Stripe accepts as one) and the
 * company ID (IČO) in the metadata and as a custom field of every receipt.
 */

/** EU countries and the prefix of their VAT numbers (Greece uses EL). */
const EU_VAT_PREFIX: Record<string, string> = {
  AT: "AT", BE: "BE", BG: "BG", CY: "CY", CZ: "CZ", DE: "DE", DK: "DK", EE: "EE", ES: "ES",
  FI: "FI", FR: "FR", GR: "EL", HR: "HR", HU: "HU", IE: "IE", IT: "IT", LT: "LT", LU: "LU",
  LV: "LV", MT: "MT", NL: "NL", PL: "PL", PT: "PT", RO: "RO", SE: "SE", SI: "SI", SK: "SK",
};
const PREFIXES = new Set(Object.values(EU_VAT_PREFIX));

/** The VAT number as Stripe's eu_vat wants it ("CZ12345678"), or null when it is not one. */
export function euVatNumber(vatNo: string | null | undefined, country: string | null | undefined): string | null {
  const value = (vatNo ?? "").toUpperCase().replace(/[\s.-]/g, "");
  if (!value) return null;
  const prefixed = /^[A-Z]{2}/.test(value) ? value : `${EU_VAT_PREFIX[(country ?? "").toUpperCase()] ?? ""}${value}`;
  if (!PREFIXES.has(prefixed.slice(0, 2))) return null;
  return /^[A-Z]{2}[0-9A-Z+*]{2,12}$/.test(prefixed) ? prefixed : null;
}

export type CustomerFields = {
  name?: string;
  email?: string;
  address?: { line1?: string; city?: string; postal_code?: string; country: string };
  metadata: Record<string, string>;
  invoiceCustomFields: { name: string; value: string }[];
  preferredLocales: string[];
  euVat: string | null;
};

/** The label of the company ID on receipts, in the customer's language. */
export const companyIdLabel = (locale: string) => (locale === "cs" ? "IČO" : "Company ID");

export function customerFields(input: {
  workspace: string;
  profile: BillingProfile | null;
  /** The account's e-mail, when the profile has none for receipts. */
  email: string | null;
  locale: "cs" | "en";
}): CustomerFields {
  const { profile } = input;
  const regNo = profile?.company_reg_no?.trim() || null;
  const email = profile?.email ?? input.email ?? undefined;
  return {
    ...(profile ? { name: profile.name } : {}),
    ...(email ? { email } : {}),
    ...(profile
      ? {
          address: {
            ...(profile.street ? { line1: profile.street } : {}),
            ...(profile.city ? { city: profile.city } : {}),
            ...(profile.postal_code ? { postal_code: profile.postal_code } : {}),
            country: profile.country,
          },
        }
      : {}),
    metadata: { workspace: input.workspace, company_reg_no: regNo ?? "" },
    invoiceCustomFields: regNo ? [{ name: companyIdLabel(input.locale), value: regNo.slice(0, 140) }] : [],
    preferredLocales: [input.locale],
    euVat: profile ? euVatNumber(profile.vat_no, profile.country) : null,
  };
}
