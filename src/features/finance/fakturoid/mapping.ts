import type { Database } from "@/types/database";
import type { FakturoidInvoiceInput, FakturoidSubjectInput } from "./client";

/** Pure translations between the app's rows and Fakturoid's documents. */

export type InvoiceStatus = Database["public"]["Enums"]["invoice_status"];

export type ContactForInvoice = Pick<
  Database["public"]["Tables"]["contacts"]["Row"],
  | "id"
  | "company_name"
  | "first_name"
  | "last_name"
  | "email"
  | "phone"
  | "address"
  | "city"
  | "postal_code"
  | "country_code"
  | "website"
>;

export type DealForInvoice = Pick<
  Database["public"]["Tables"]["deals"]["Row"],
  "id" | "title" | "value" | "currency" | "contact_id"
>;

/** Same due period as invoices made in the app. */
export const INVOICE_DUE_DAYS = 14;

/** Marks the Fakturoid subject made for a contact, so it is found and reused later. */
export function contactCustomId(contactId: string): string {
  return `gradus-contact-${contactId}`;
}

export function dealCustomId(dealId: string): string {
  return `gradus-deal-${dealId}`;
}

/** The name a customer goes by: the company, otherwise the person. */
export function customerName(contact: ContactForInvoice): string | null {
  const company = contact.company_name?.trim();
  if (company) return company;
  const person = [contact.first_name, contact.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return person || null;
}

function present(value: string | null | undefined): string | undefined {
  const clean = value?.trim();
  return clean ? clean : undefined;
}

/** A Fakturoid subject from a contact; empty fields are left out, not sent blank. */
export function subjectFromContact(contact: ContactForInvoice): FakturoidSubjectInput | null {
  const name = customerName(contact);
  if (!name) return null;
  const subject: FakturoidSubjectInput = { name, custom_id: contactCustomId(contact.id) };
  const optional: [keyof FakturoidSubjectInput, string | undefined][] = [
    ["email", present(contact.email)],
    ["phone", present(contact.phone)],
    ["street", present(contact.address)],
    ["city", present(contact.city)],
    ["zip", present(contact.postal_code)],
    ["country", present(contact.country_code)?.toUpperCase()],
    ["web", present(contact.website)],
  ];
  for (const [key, value] of optional) if (value) subject[key] = value;
  return subject;
}

/** One line for the deal, its whole value, due in INVOICE_DUE_DAYS. */
export function invoiceFromDeal(
  deal: DealForInvoice & { value: number },
  subjectId: number,
  issuedOn: string,
): FakturoidInvoiceInput {
  return {
    subject_id: subjectId,
    custom_id: dealCustomId(deal.id),
    issued_on: issuedOn,
    due: INVOICE_DUE_DAYS,
    currency: deal.currency,
    lines: [{ name: deal.title, quantity: 1, unit_price: deal.value }],
  };
}

/**
 * Fakturoid's status in the app's terms. "overdue" is never stored (the app
 * works it out from the due day), so it comes back as an open invoice.
 */
export function mapFakturoidStatus(status: string | null | undefined): InvoiceStatus | null {
  switch (status) {
    case "open":
    case "overdue":
      return "open";
    case "sent":
      return "sent";
    case "paid":
      return "paid";
    case "cancelled":
      return "cancelled";
    case "uncollectible":
      return "uncollectible";
    default:
      return null;
  }
}

/** Fakturoid sends money as strings ("1210.0"); anything unusable becomes null. */
export function parseAmount(value: string | number | null | undefined): number | null {
  const amount = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
}

/** Only real calendar dates reach the database. */
export function isoDateOrNull(value: string | null | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/** An hour of overlap, so a change made during the last run is not missed. */
const SYNC_OVERLAP_MS = 60 * 60 * 1000;

/**
 * Where the next sync starts reading: shortly before the last successful one,
 * or, the first time, from the oldest invoice that still waits for payment.
 */
export function syncSince(lastSyncedAt: string | null, oldestOpenCreatedAt: string): Date {
  const oldest = Date.parse(oldestOpenCreatedAt) - SYNC_OVERLAP_MS;
  if (!lastSyncedAt) return new Date(oldest);
  return new Date(Math.min(Date.parse(lastSyncedAt) - SYNC_OVERLAP_MS, Date.now()));
}
