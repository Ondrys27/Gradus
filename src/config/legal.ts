import "server-only";
import { contactEmail } from "@/features/marketing/contact";

/**
 * Who operates the app, for the terms and the privacy policy. From the
 * environment, never written into the code; read when the pages are generated,
 * so a change needs a new deployment. A missing value shows as [DOPLNIT] on
 * the page until it is filled in.
 */
export type LegalOperator = {
  name: string | null;
  /** IČO */
  companyId: string | null;
  address: string | null;
  /** CONTACT_EMAIL, otherwise OWNER_EMAIL (the footer's address). */
  email: string | null;
};

function read(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function legalOperator(): LegalOperator {
  return {
    name: read(process.env.LEGAL_NAME),
    companyId: read(process.env.LEGAL_COMPANY_ID),
    address: read(process.env.LEGAL_ADDRESS),
    email: contactEmail(),
  };
}
