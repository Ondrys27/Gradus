"use server";

import { z } from "zod";
import { measure } from "@/lib/analytics/instrument";
import { track } from "@/lib/analytics/track";
import type { AresCompany } from "./ares";
import { InvoiceError, toFailure, type ActionResult } from "./errors";
import {
  invoiceDraftSchema,
  invoiceProfileSchema,
  type InvoiceDraftInput,
  type InvoiceProfileInput,
} from "./schemas";
import { lookupAres } from "./server/ares";
import {
  invoiceContext,
  requireEditFinance,
  requireOwner,
  type InvoiceContext,
} from "./server/context";
import {
  INVOICE_RECORD_COLUMNS,
  PROFILE_COLUMNS,
  toInvoiceRecord,
  type InvoiceParty,
  type InvoiceProfile,
  type InvoiceRecord,
} from "./types";

/**
 * Invoices, called from the screens. The user comes from the session and
 * the workspace from the database; a worker needs the right to edit finance,
 * the supplier's details are the owner's alone. The client never sets a
 * number, a status or a total: drafts are written with the user's own client
 * (RLS and the invoices guard), issuing, cancelling and paying go through the
 * database functions. Failures come back as codes, never thrown.
 */

const id = z.uuid();

/** Every action is timed with its outcome (an error code, never data) for the health overview. */
function run<T>(name: string, work: (ctx: InvoiceContext) => Promise<T>): Promise<ActionResult<T>> {
  return measure(`invoices.${name}`, async (): Promise<ActionResult<T>> => {
    try {
      const ctx = await invoiceContext();
      if (!ctx) return { ok: false, error: "unknown" };
      return { ok: true, data: await work(ctx) };
    } catch (error) {
      const failure = toFailure(error);
      if (failure.error === "unknown") console.error(`invoice action ${name} failed`, error);
      return failure;
    }
  })();
}

async function readProfile(ctx: InvoiceContext): Promise<InvoiceProfile | null> {
  const { data, error } = await ctx.supabase
    .from("invoice_profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", ctx.workspaceId)
    .maybeSingle();
  if (error) throw error;
  return data as InvoiceProfile | null;
}

/** The party without empty fields, as the snapshot is stored. */
function compactParty(party: Record<string, string | null>): InvoiceParty {
  return Object.fromEntries(
    Object.entries(party).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ) as InvoiceParty;
}

// ---------------------------------------------------------------------------
// Supplier
// ---------------------------------------------------------------------------

export async function saveInvoiceProfileAction(
  input: InvoiceProfileInput,
): Promise<ActionResult<InvoiceProfile>> {
  const parsed = invoiceProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return run("saveProfile", async (ctx) => {
    requireOwner(ctx);
    const before = await readProfile(ctx);
    const { data, error } = await ctx.supabase
      .from("invoice_profiles")
      .upsert({ ...parsed.data, user_id: ctx.userId }, { onConflict: "user_id" })
      .select(PROFILE_COLUMNS)
      .single();
    if (error) throw error;
    await track("invoice_profile_saved", { created: !before, vat_payer: parsed.data.vat_payer });
    return data as InvoiceProfile;
  });
}

export async function lookupAresAction(ico: string): Promise<ActionResult<AresCompany>> {
  if (typeof ico !== "string" || ico.length > 20) return { ok: false, error: "aresInvalid" };
  return run("ares", async (ctx) => {
    requireOwner(ctx);
    return lookupAres(ico);
  });
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export type SavedDraft = {
  invoice: InvoiceRecord;
  /** Whether the customer's details went back to the contact; null when not asked. */
  contactSaved: boolean | null;
};

async function writeDraft(
  ctx: InvoiceContext,
  input: z.output<typeof invoiceDraftSchema>,
): Promise<SavedDraft> {
  const profile = await readProfile(ctx);
  const vatMode = profile?.vat_payer ? "vat" : "none";
  const row = {
    customer: compactParty(input.customer),
    contact_id: input.contactId,
    deal_id: input.dealId,
    items: input.items.map((item) => ({ ...item, name: item.name.trim(), unit: item.unit.trim() })),
    currency: input.currency,
    issued_on: input.issuedOn,
    taxable_on: vatMode === "vat" ? input.taxableOn : null,
    due_on: input.dueOn,
    variable_symbol: input.variableSymbol,
    note: input.note,
    locale: input.locale,
    vat_mode: vatMode,
  };

  let saved;
  if (input.id) {
    const { data, error } = await ctx.supabase
      .from("invoices")
      .update(row)
      .eq("id", input.id)
      .eq("user_id", ctx.workspaceId)
      .eq("status", "draft")
      .select(INVOICE_RECORD_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      // Gone, or issued meanwhile (another tab): say which.
      const { data: existing } = await ctx.supabase
        .from("invoices")
        .select("status")
        .eq("id", input.id)
        .maybeSingle();
      throw new InvoiceError(existing ? "alreadyIssued" : "invoiceNotFound");
    }
    saved = data;
  } else {
    const { data, error } = await ctx.supabase
      .from("invoices")
      // The guard sets the status, the number and the totals; these only satisfy the types.
      .insert({ ...row, user_id: ctx.workspaceId, status: "draft", number: null, amount: 0 })
      .select(INVOICE_RECORD_COLUMNS)
      .single();
    if (error) throw error;
    saved = data;
  }

  let contactSaved: boolean | null = null;
  if (input.saveToContact && input.contactId) {
    contactSaved = await saveToContact(ctx, input.contactId, input.customer);
  }
  return { invoice: toInvoiceRecord(saved), contactSaved };
}

/** The customer's details back on the contact, with the user's own rights to contacts. */
async function saveToContact(
  ctx: InvoiceContext,
  contactId: string,
  customer: z.output<typeof invoiceDraftSchema>["customer"],
): Promise<boolean> {
  const { data: contact, error } = await ctx.supabase
    .from("contacts")
    .select("company_name, first_name, last_name")
    .eq("id", contactId)
    .eq("user_id", ctx.workspaceId)
    .maybeSingle();
  if (error || !contact) return false;
  // A person keeps their name; a company (or a contact without a name) takes the invoice's.
  const isCompany = Boolean(contact.company_name) || !(contact.first_name || contact.last_name);
  const { data, error: updateError } = await ctx.supabase
    .from("contacts")
    .update({
      ...(isCompany && customer.name ? { company_name: customer.name } : {}),
      company_reg_no: customer.company_reg_no,
      vat_no: customer.vat_no,
      address: customer.street,
      city: customer.city,
      postal_code: customer.postal_code,
      country_code: customer.country,
      email: customer.email,
    })
    .eq("id", contactId)
    .eq("user_id", ctx.workspaceId)
    .select("id");
  if (updateError) {
    console.error("invoice customer not saved to contact", updateError.code);
    return false;
  }
  return data.length > 0;
}

export async function saveInvoiceDraftAction(
  input: InvoiceDraftInput,
): Promise<ActionResult<SavedDraft>> {
  const parsed = invoiceDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return run("saveDraft", async (ctx) => {
    await requireEditFinance(ctx);
    return writeDraft(ctx, parsed.data);
  });
}

/** Saves the form as it is, then numbers and freezes it. */
export async function issueInvoiceAction(
  input: InvoiceDraftInput,
): Promise<ActionResult<SavedDraft>> {
  const parsed = invoiceDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return run("issue", async (ctx) => {
    await requireEditFinance(ctx);
    const draft = await writeDraft(ctx, parsed.data);
    const { data, error } = await ctx.supabase.rpc("issue_invoice", {
      _invoice_id: draft.invoice.id,
    });
    if (error) throw error;
    const invoice = toInvoiceRecord(data);
    await track("invoice_issued", {
      style: invoice.style ?? "clean",
      vat_payer: invoice.vat_mode === "vat",
      qr: invoice.qr_enabled,
      from_deal: Boolean(invoice.deal_id),
      items: Math.min(invoice.items.length, 100),
    });
    return { invoice, contactSaved: draft.contactSaved };
  });
}

export async function createInvoiceFromDealAction(dealId: string): Promise<ActionResult<string>> {
  const parsed = id.safeParse(dealId);
  if (!parsed.success) return { ok: false, error: "dealNotFound" };
  return run("fromDeal", async (ctx) => {
    await requireEditFinance(ctx);
    const { data, error } = await ctx.supabase.rpc("create_invoice_from_deal", {
      _deal_id: parsed.data,
    });
    if (error) throw error;
    return data.id;
  });
}

// ---------------------------------------------------------------------------
// Issued invoices
// ---------------------------------------------------------------------------

export async function markInvoicePaidAction(invoiceId: string): Promise<ActionResult<null>> {
  const parsed = id.safeParse(invoiceId);
  if (!parsed.success) return { ok: false, error: "invoiceNotFound" };
  return run("markPaid", async (ctx) => {
    await requireEditFinance(ctx);
    const { error } = await ctx.supabase.rpc("mark_invoice_paid", { _invoice_id: parsed.data });
    if (error) throw error;
    await track("invoice_paid", {});
    return null;
  });
}

/** Returns the id of the credit note. */
export async function cancelInvoiceAction(invoiceId: string): Promise<ActionResult<string>> {
  const parsed = id.safeParse(invoiceId);
  if (!parsed.success) return { ok: false, error: "invoiceNotFound" };
  return run("cancel", async (ctx) => {
    await requireEditFinance(ctx);
    const { data, error } = await ctx.supabase.rpc("cancel_invoice", { _invoice_id: parsed.data });
    if (error) throw error;
    await track("invoice_cancelled", {});
    return data.id;
  });
}
