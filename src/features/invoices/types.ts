import type { InvoiceItem, VatMode } from "./totals";

/**
 * Invoices as the app reads them. No zod here, so the list and the analytics
 * catalog can use the names without the validation library.
 */

/** Where a new invoice is written. */
export const NEW_INVOICE_PATH = "/app/finance/faktury/nova";

/** A draft opens in the form, an issued invoice in its detail. */
export function invoicePath(id: string) {
  return `/app/finance/faktury/${id}`;
}

export const INVOICE_STYLES = ["clean", "line", "block", "classic"] as const;
export type InvoiceStyle = (typeof INVOICE_STYLES)[number];

/** Accent colours offered for the Line style; any hex can be typed in too. */
export const ACCENT_PRESETS = ["#3B5BDB", "#0B7285", "#2B8A3E", "#C2255C", "#E8590C", "#212529"] as const;
export const DEFAULT_ACCENT = ACCENT_PRESETS[0];

/** Czech VAT rates; elsewhere the rate is typed in. */
export const CZ_VAT_RATES = [21, 12, 0] as const;

export const INVOICE_LOCALES = ["cs", "en"] as const;
export type InvoiceLocale = (typeof INVOICE_LOCALES)[number];

export type InvoiceParty = {
  name?: string;
  company_reg_no?: string;
  vat_no?: string;
  street?: string;
  city?: string;
  postal_code?: string;
  country?: string;
  email?: string;
};

export type SupplierSnapshot = InvoiceParty & {
  vat_payer?: boolean;
  phone?: string;
  account_number?: string;
  bank_code?: string;
  iban?: string;
  bic?: string;
  footer_text?: string;
};

export type InvoiceProfile = {
  user_id: string;
  name: string;
  company_reg_no: string | null;
  vat_no: string | null;
  vat_payer: boolean;
  street: string | null;
  city: string | null;
  postal_code: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  account_number: string | null;
  bank_code: string | null;
  iban: string | null;
  bic: string | null;
  due_days: number;
  currency: string;
  number_prefix: string;
  footer_text: string | null;
  style: InvoiceStyle;
  accent_color: string;
  qr_enabled: boolean;
};

export const PROFILE_COLUMNS =
  "user_id, name, company_reg_no, vat_no, vat_payer, street, city, postal_code, country, email, phone, account_number, bank_code, iban, bic, due_days, currency, number_prefix, footer_text, style, accent_color, qr_enabled";

export type InvoiceKind = "invoice" | "credit_note";
export type InvoiceStatus =
  | "draft"
  | "open"
  | "sent"
  | "overdue"
  | "paid"
  | "cancelled"
  | "uncollectible";

/** Everything the editor and the document need. */
export type InvoiceRecord = {
  id: string;
  user_id: string;
  kind: InvoiceKind;
  number: string | null;
  status: InvoiceStatus;
  credited_invoice_id: string | null;
  issued_on: string | null;
  due_on: string | null;
  taxable_on: string | null;
  paid_on: string | null;
  currency: string;
  contact_id: string | null;
  deal_id: string | null;
  supplier: SupplierSnapshot | null;
  customer: InvoiceParty;
  items: InvoiceItem[];
  vat_mode: VatMode;
  subtotal: number;
  vat_total: number;
  rounding: number;
  total: number;
  variable_symbol: string | null;
  note: string | null;
  style: InvoiceStyle | null;
  accent_color: string | null;
  qr_enabled: boolean;
  locale: InvoiceLocale;
  pdf_path: string | null;
  sent_at: string | null;
};

export const INVOICE_RECORD_COLUMNS =
  "id, user_id, kind, number, status, credited_invoice_id, issued_on, due_on, taxable_on, paid_on, currency, contact_id, deal_id, supplier, customer, items, vat_mode, subtotal, vat_total, rounding, total, variable_symbol, note, style, accent_color, qr_enabled, locale, pdf_path, sent_at";

/** A row of the list. */
export type InvoiceListRow = Pick<
  InvoiceRecord,
  | "id"
  | "kind"
  | "number"
  | "status"
  | "issued_on"
  | "due_on"
  | "paid_on"
  | "currency"
  | "total"
  | "credited_invoice_id"
> & { customer_name: string | null };

export const INVOICE_LIST_COLUMNS =
  "id, kind, number, status, issued_on, due_on, paid_on, currency, total, credited_invoice_id, customer_name";

/** What the list shows; "overdue" is worked out from the due day, never stored. */
export const INVOICE_FILTERS = ["all", "draft", "issued", "overdue", "paid", "cancelled"] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];
export type InvoiceListStatus = Exclude<InvoiceFilter, "all"> | "creditNote";

export const INVOICE_SORTS = ["issuedDesc", "dueAsc", "totalDesc", "numberDesc"] as const;
export type InvoiceSort = (typeof INVOICE_SORTS)[number];

/** Statuses of an issued invoice still waiting for its money. */
export const UNPAID_STATUSES = ["open", "sent", "overdue"] as const;

export function invoiceListStatus(
  invoice: Pick<InvoiceRecord, "kind" | "status" | "due_on">,
  today: string,
): InvoiceListStatus {
  if (invoice.kind === "credit_note") return "creditNote";
  switch (invoice.status) {
    case "draft":
      return "draft";
    case "paid":
      return "paid";
    case "cancelled":
    case "uncollectible":
      return "cancelled";
    default:
      return invoice.due_on && invoice.due_on < today ? "overdue" : "issued";
  }
}

/** Numbers come back from PostgREST as numbers or strings; the editor wants numbers. */
export function toInvoiceRecord(row: Record<string, unknown>): InvoiceRecord {
  const record = row as unknown as InvoiceRecord;
  return {
    ...record,
    subtotal: Number(record.subtotal),
    vat_total: Number(record.vat_total),
    rounding: Number(record.rounding),
    total: Number(record.total),
    customer: (record.customer ?? {}) as InvoiceParty,
    items: Array.isArray(record.items) ? record.items : [],
  };
}

/** What an invoice keeps of the supplier, as `invoice_supplier_snapshot()` freezes it. */
export function supplierFromProfile(profile: InvoiceProfile): SupplierSnapshot {
  const snapshot: SupplierSnapshot = {
    name: profile.name,
    company_reg_no: profile.company_reg_no ?? undefined,
    vat_no: profile.vat_no ?? undefined,
    vat_payer: profile.vat_payer,
    street: profile.street ?? undefined,
    city: profile.city ?? undefined,
    postal_code: profile.postal_code ?? undefined,
    country: profile.country,
    email: profile.email ?? undefined,
    phone: profile.phone ?? undefined,
    account_number: profile.account_number ?? undefined,
    bank_code: profile.bank_code ?? undefined,
    iban: profile.iban ?? undefined,
    bic: profile.bic ?? undefined,
    footer_text: profile.footer_text ?? undefined,
  };
  return Object.fromEntries(
    Object.entries(snapshot).filter(([, value]) => value !== undefined),
  ) as SupplierSnapshot;
}
