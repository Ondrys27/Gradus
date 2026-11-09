import type { LegalOperator } from "./legal";

/**
 * What the owner still has to fill in for the terms and the privacy policy,
 * and where (docs/stripe.md lists the same). Pure, so a test can check it.
 */
export const LEGAL_FIELDS: readonly { field: keyof LegalOperator; env: string }[] = [
  { field: "name", env: "LEGAL_NAME" },
  { field: "companyId", env: "LEGAL_COMPANY_ID" },
  { field: "address", env: "LEGAL_ADDRESS" },
  { field: "email", env: "CONTACT_EMAIL" },
  { field: "backupDays", env: "LEGAL_BACKUP_DAYS" },
];

/** The marker a missing value shows on the page (`marketing.legal.missing`). */
export const LEGAL_PLACEHOLDER = "[DOPLNIT]";

export function legalGaps(operator: LegalOperator): { field: keyof LegalOperator; env: string }[] {
  return LEGAL_FIELDS.filter(({ field }) => !operator[field]);
}

/** Paths of texts that carry the marker literally instead of a value from the configuration. */
export function placeholdersIn(texts: unknown, path = ""): string[] {
  if (typeof texts === "string") return texts.includes(LEGAL_PLACEHOLDER) ? [path] : [];
  if (!texts || typeof texts !== "object") return [];
  return Object.entries(texts).flatMap(([key, value]) => placeholdersIn(value, path ? `${path}.${key}` : key));
}
