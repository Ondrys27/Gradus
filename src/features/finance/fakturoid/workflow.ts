import type { Invoice } from "../types";
import type { FakturoidClient, FakturoidInvoice } from "./client";
import { InvoiceError } from "./errors";
import {
  contactCustomId,
  customerName,
  invoiceFromDeal,
  isoDateOrNull,
  mapFakturoidStatus,
  parseAmount,
  subjectFromContact,
  type ContactForInvoice,
  type DealForInvoice,
  type InvoiceStatus,
} from "./mapping";

/**
 * The steps of issuing, paying and syncing Fakturoid invoices, written against
 * two small ports: the Fakturoid client and the app's storage. The server wires
 * them to the real API and Supabase; tests use a mocked fetch and a map.
 */

export type ApplyInput = {
  fakturoidId: number;
  status: InvoiceStatus | null;
  number: string | null;
  amount: number | null;
  dueOn: string | null;
  paidOn: string | null;
};
export type ApplyResult = { invoiceId: string; paidNow: boolean; dealMoved: boolean };

export type InvoiceStore = {
  loadDeal(
    dealId: string,
  ): Promise<{ deal: DealForInvoice; contact: ContactForInvoice | null } | null>;
  /** An invoice for the deal that still waits for payment, if there is one. */
  findUnpaidForDeal(dealId: string): Promise<Invoice | null>;
  insertInvoice(row: {
    number: string;
    amount: number;
    currency: string;
    status: InvoiceStatus;
    issued_on: string;
    due_on: string | null;
    customer_name: string | null;
    contact_id: string;
    deal_id: string;
    fakturoid_id: number;
  }): Promise<Invoice>;
  /** Fakturoid's state into the mirrored invoice; null when it is not this user's. */
  applyInvoice(input: ApplyInput): Promise<ApplyResult | null>;
};

type Ports = { fakturoid: FakturoidClient; store: InvoiceStore };

/**
 * "Create invoice" on a deal: finds or makes the contact's subject in Fakturoid,
 * issues the invoice there and mirrors it here. A deal whose invoice still waits
 * for payment gets that one back instead of a second.
 */
export async function issueFakturoidInvoice(
  { fakturoid, store }: Ports,
  dealId: string,
  today: string,
): Promise<Invoice> {
  const loaded = await store.loadDeal(dealId);
  if (!loaded) throw new InvoiceError("dealNotFound");
  const { deal, contact } = loaded;
  if (deal.value === null || !(deal.value > 0)) throw new InvoiceError("dealValueRequired");

  const existing = await store.findUnpaidForDeal(deal.id);
  if (existing) return existing;

  const subjectInput = contact ? subjectFromContact(contact) : null;
  if (!contact || !subjectInput) throw new InvoiceError("contactRequired");

  const subject =
    (await fakturoid.findSubjectByCustomId(contactCustomId(contact.id))) ??
    (await fakturoid.createSubject(subjectInput));

  const created = await fakturoid.createInvoice(
    invoiceFromDeal({ ...deal, value: deal.value }, subject.id, today),
  );

  try {
    return await store.insertInvoice({
      number: created.number,
      amount: parseAmount(created.total) ?? deal.value,
      currency: created.currency ?? deal.currency,
      status: mapFakturoidStatus(created.status) ?? "open",
      issued_on: isoDateOrNull(created.issued_on) ?? today,
      due_on: isoDateOrNull(created.due_on),
      customer_name: customerName(contact),
      contact_id: contact.id,
      deal_id: deal.id,
      fakturoid_id: created.id,
    });
  } catch {
    // Not mirrored here, so it must not stay in Fakturoid either: a second tap
    // would otherwise issue a duplicate the user cannot see.
    await fakturoid.deleteInvoice(created.id).catch(() => undefined);
    throw new InvoiceError("saveFailed");
  }
}

function applyInputFrom(invoice: FakturoidInvoice): ApplyInput {
  return {
    fakturoidId: invoice.id,
    status: mapFakturoidStatus(invoice.status),
    number: invoice.number || null,
    amount: parseAmount(invoice.total),
    dueOn: isoDateOrNull(invoice.due_on),
    paidOn: isoDateOrNull(invoice.paid_on),
  };
}

/** "Mark as paid" on a Fakturoid invoice: the payment is recorded there first. */
export async function payFakturoidInvoice(
  { fakturoid, store }: Ports,
  fakturoidId: number,
  today: string,
): Promise<ApplyResult> {
  await fakturoid.payInvoice(fakturoidId, today);
  const result = await store.applyInvoice({
    fakturoidId,
    status: "paid",
    number: null,
    amount: null,
    dueOn: null,
    paidOn: today,
  });
  if (!result) throw new InvoiceError("invoiceNotFound");
  return result;
}

export type SyncOutcome = { checked: number; updated: number; paid: number; dealsMoved: number };

/**
 * Reads the invoices Fakturoid changed since `since` and applies those the app
 * mirrors and still waits for. One failing invoice does not stop the others.
 */
export async function syncFakturoidInvoices(
  { fakturoid, store }: Ports,
  waiting: ReadonlySet<number>,
  since: Date,
): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { checked: 0, updated: 0, paid: 0, dealsMoved: 0 };
  if (waiting.size === 0) return outcome;
  const changed = await fakturoid.listInvoicesUpdatedSince(since);
  for (const invoice of changed) {
    if (!waiting.has(invoice.id)) continue;
    outcome.checked++;
    try {
      const result = await store.applyInvoice(applyInputFrom(invoice));
      if (!result) continue;
      outcome.updated++;
      if (result.paidNow) outcome.paid++;
      if (result.dealMoved) outcome.dealsMoved++;
    } catch (error) {
      console.error("fakturoid sync: applying invoice failed", invoice.id, error);
    }
  }
  return outcome;
}
