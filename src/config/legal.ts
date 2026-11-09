import "server-only";
import { contactEmail } from "@/features/marketing/contact";
import { legalGaps } from "./legal-gaps";

/**
 * Who operates the app, for the terms and the privacy policy. From the
 * environment, never written into the code; read when the pages are generated,
 * so a change needs a new deployment. A missing value shows as [DOPLNIT] on
 * the page until it is filled in, and a production build fails while any is
 * missing (assertLegalComplete, called by the legal pages).
 */
export type LegalOperator = {
  /** The seller and data controller: a name or a company (LEGAL_NAME). */
  name: string | null;
  /** IČO (LEGAL_COMPANY_ID) */
  companyId: string | null;
  /** The registered address (LEGAL_ADDRESS). */
  address: string | null;
  /** CONTACT_EMAIL, otherwise OWNER_EMAIL (the footer's address). */
  email: string | null;
  /** Days until a deleted account is gone from the database backups too (LEGAL_BACKUP_DAYS). */
  backupDays: string | null;
};

/**
 * The version of the terms and the privacy policy an account accepts at
 * registration (profiles.terms_version). A new date with every change of
 * their content.
 */
export const TERMS_VERSION = "2026-11-12";

function read(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function legalOperator(): LegalOperator {
  const backupDays = read(process.env.LEGAL_BACKUP_DAYS);
  return {
    name: read(process.env.LEGAL_NAME),
    companyId: read(process.env.LEGAL_COMPANY_ID),
    address: read(process.env.LEGAL_ADDRESS),
    email: contactEmail(),
    backupDays: backupDays && /^\d{1,3}$/.test(backupDays) ? backupDays : null,
  };
}

/** A production deployment (Vercel's, at build and at run time). */
export function isProductionDeployment(vercelEnv = process.env.VERCEL_ENV): boolean {
  return vercelEnv === "production";
}

/**
 * The website must never show [DOPLNIT] in production: while anything the
 * owner fills in is missing, generating the legal pages fails, so the
 * production build fails and names the variables.
 */
export function assertLegalComplete(operator: LegalOperator, production = isProductionDeployment()): void {
  if (!production) return;
  const gaps = legalGaps(operator);
  if (gaps.length) {
    throw new Error(
      `The terms and the privacy policy still have [DOPLNIT]; set ${gaps.map((gap) => gap.env).join(", ")} for production (docs/stripe.md).`,
    );
  }
}
