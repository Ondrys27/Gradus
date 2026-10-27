import { addDays } from "date-fns";
import { isoDateToLocal, localToIsoDate, type IsoDate } from "@/lib/format";
import type { InvoiceDraftInput } from "./schemas";
import type { InvoiceItem, VatMode } from "./totals";
import {
  CZ_VAT_RATES,
  type InvoiceLocale,
  type InvoiceParty,
  type InvoiceProfile,
  type InvoiceRecord,
} from "./types";

/**
 * The invoice form as text fields, and the way back to numbers. Kept apart
 * from the screen so the parsing and the defaults are tested on their own.
 */

export const PARTY_FIELDS = [
  "name",
  "company_reg_no",
  "vat_no",
  "street",
  "city",
  "postal_code",
  "country",
  "email",
] as const;
export type PartyField = (typeof PARTY_FIELDS)[number];
export type PartyDraft = Record<PartyField, string>;

export type ItemDraft = {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  unit_price: string;
  vat_rate: string;
};

export type EditorDraft = {
  id: string | null;
  contactId: string | null;
  dealId: string | null;
  saveToContact: boolean;
  customer: PartyDraft;
  items: ItemDraft[];
  currency: string;
  issuedOn: IsoDate;
  taxableOn: IsoDate | null;
  dueOn: IsoDate;
  /** The due day follows the issue day until the user picks one. */
  dueTouched: boolean;
  variableSymbol: string;
  note: string;
  locale: InvoiceLocale;
};

/** "1 250,50", "1250.5" or "-3" as a number with at most `decimals` decimals; NaN when it is not one. */
export function parseDecimal(text: string, decimals: number): number {
  const clean = text.replace(/[\s  ]/g, "").replace(",", ".");
  if (clean === "") return Number.NaN;
  const pattern = new RegExp(`^-?\\d+(\\.\\d{1,${decimals}})?$`);
  return pattern.test(clean) ? Number(clean) : Number.NaN;
}

/** A number back into a field: "1250.5" → "1250,5" in a comma locale. */
export function decimalToText(value: number, decimalComma: boolean): string {
  const text = String(value);
  return decimalComma ? text.replace(".", ",") : text;
}

export function shiftDays(day: IsoDate, days: number): IsoDate {
  return localToIsoDate(addDays(isoDateToLocal(day), days));
}

export function defaultVatRate(profile: Pick<InvoiceProfile, "vat_payer" | "country"> | null): number {
  return profile?.vat_payer && profile.country === "CZ" ? CZ_VAT_RATES[0] : 0;
}

export function newItem(unit: string, vatRate: number, decimalComma: boolean): ItemDraft {
  return {
    id: crypto.randomUUID(),
    name: "",
    quantity: "1",
    unit,
    unit_price: "",
    vat_rate: decimalToText(vatRate, decimalComma),
  };
}

function partyDraft(party: InvoiceParty | null | undefined): PartyDraft {
  return Object.fromEntries(PARTY_FIELDS.map((field) => [field, party?.[field] ?? ""])) as PartyDraft;
}

export function partyFromContact(contact: {
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  country_code: string | null;
  email: string | null;
  company_reg_no: string | null;
  vat_no: string | null;
}): PartyDraft {
  const person = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
  return {
    name: contact.company_name || person,
    company_reg_no: contact.company_reg_no ?? "",
    vat_no: contact.vat_no ?? "",
    street: contact.address ?? "",
    city: contact.city ?? "",
    postal_code: contact.postal_code ?? "",
    country: contact.country_code ?? "",
    email: contact.email ?? "",
  };
}

export function emptyDraft(args: {
  profile: InvoiceProfile | null;
  today: IsoDate;
  locale: InvoiceLocale;
  currency: string;
  unit: string;
  decimalComma: boolean;
}): EditorDraft {
  const dueDays = args.profile?.due_days ?? 14;
  return {
    id: null,
    contactId: null,
    dealId: null,
    saveToContact: false,
    customer: partyDraft(null),
    items: [newItem(args.unit, defaultVatRate(args.profile), args.decimalComma)],
    currency: args.profile?.currency ?? args.currency,
    issuedOn: args.today,
    taxableOn: null,
    dueOn: shiftDays(args.today, dueDays),
    dueTouched: false,
    variableSymbol: "",
    note: "",
    locale: args.locale,
  };
}

export function draftFromRecord(
  record: InvoiceRecord,
  args: { profile: InvoiceProfile | null; today: IsoDate; decimalComma: boolean },
): EditorDraft {
  const issuedOn = record.issued_on ?? args.today;
  const dueDays = args.profile?.due_days ?? 14;
  return {
    id: record.id,
    contactId: record.contact_id,
    dealId: record.deal_id,
    saveToContact: false,
    customer: partyDraft(record.customer),
    items: record.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: decimalToText(item.quantity, args.decimalComma),
      unit: item.unit,
      unit_price: item.unit_price === 0 ? "" : decimalToText(item.unit_price, args.decimalComma),
      vat_rate: decimalToText(item.vat_rate, args.decimalComma),
    })),
    currency: record.currency,
    issuedOn,
    taxableOn: record.taxable_on,
    dueOn: record.due_on ?? shiftDays(issuedOn, dueDays),
    dueTouched: record.due_on !== null,
    variableSymbol: record.variable_symbol ?? "",
    note: record.note ?? "",
    locale: record.locale,
  };
}

export type ItemErrors = Record<string, Partial<Record<"name" | "quantity" | "unit_price" | "vat_rate", string>>>;

/** The items as numbers; a field that is not a number is an error, an empty price counts as 0. */
export function parseItems(
  items: ItemDraft[],
  vatMode: VatMode,
): { items: InvoiceItem[]; errors: ItemErrors } {
  const errors: ItemErrors = {};
  const parsed = items.map((item) => {
    const quantity = parseDecimal(item.quantity, 3);
    const price = item.unit_price.trim() === "" ? 0 : parseDecimal(item.unit_price, 2);
    const rate = vatMode === "vat" ? parseDecimal(item.vat_rate || "0", 2) : 0;
    const own: ItemErrors[string] = {};
    if (!Number.isFinite(quantity) || Math.abs(quantity) > 1_000_000) own.quantity = "quantityInvalid";
    if (!Number.isFinite(price) || Math.abs(price) > 1_000_000_000) own.unit_price = "priceInvalid";
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) own.vat_rate = "rateInvalid";
    if (Object.keys(own).length) errors[item.id] = own;
    return {
      id: item.id,
      name: item.name.trim(),
      quantity: Number.isFinite(quantity) ? quantity : 0,
      unit: item.unit.trim(),
      unit_price: Number.isFinite(price) ? price : 0,
      vat_rate: Number.isFinite(rate) ? rate : 0,
    };
  });
  return { items: parsed, errors };
}

export function toDraftInput(draft: EditorDraft, items: InvoiceItem[], vatMode: VatMode): InvoiceDraftInput {
  return {
    id: draft.id,
    contactId: draft.contactId,
    dealId: draft.dealId,
    saveToContact: draft.saveToContact && Boolean(draft.contactId),
    customer: draft.customer,
    items,
    currency: draft.currency,
    issuedOn: draft.issuedOn,
    taxableOn: vatMode === "vat" ? draft.taxableOn : null,
    dueOn: draft.dueOn,
    variableSymbol: draft.variableSymbol,
    note: draft.note,
    locale: draft.locale,
  };
}

/** Moves one item to where another one is (drag and drop). */
export function moveItem(items: ItemDraft[], activeId: string, overId: string): ItemDraft[] {
  const from = items.findIndex((item) => item.id === activeId);
  const to = items.findIndex((item) => item.id === overId);
  if (from < 0 || to < 0 || from === to) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
