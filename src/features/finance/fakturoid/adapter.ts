import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { INVOICE_COLUMNS, type Invoice } from "../types";

/**
 * Where invoices come from. The screens talk only to this interface, so the real
 * Fakturoid calls (phase 5) replace the local provider without touching them.
 */
export interface InvoiceProvider {
  readonly key: "local" | "fakturoid";
  /** True when invoices are issued outside the app and only mirrored here. */
  readonly external: boolean;
  createFromDeal(dealId: string): Promise<Invoice>;
  markPaid(invoiceId: string): Promise<Invoice>;
  /** Pulls invoices and their payment state from the provider. */
  sync(): Promise<{ synced: number }>;
}

/** Thrown by a provider whose connection is not set up yet. */
export class ProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`invoice_provider_not_configured:${provider}`);
    this.name = "ProviderNotConfiguredError";
  }
}

/** Invoices kept in the app's own tables, through the database functions. */
export function createLocalInvoiceProvider(supabase: SupabaseClient<Database>): InvoiceProvider {
  return {
    key: "local",
    external: false,
    async createFromDeal(dealId) {
      const { data, error } = await supabase.rpc("create_invoice_from_deal", { _deal_id: dealId });
      if (error) throw error;
      return pick(data);
    },
    async markPaid(invoiceId) {
      const { data, error } = await supabase.rpc("mark_invoice_paid", { _invoice_id: invoiceId });
      if (error) throw error;
      return pick(data);
    },
    async sync() {
      return { synced: 0 };
    },
  };
}

/**
 * Fakturoid, prepared: the credentials live encrypted in `fakturoid_connections`
 * and are read by the server only. Nothing is called until phase 5.
 */
export function createFakturoidProvider(): InvoiceProvider {
  const fail = () => Promise.reject(new ProviderNotConfiguredError("fakturoid"));
  return {
    key: "fakturoid",
    external: true,
    createFromDeal: fail,
    markPaid: fail,
    sync: fail,
  };
}

const KEYS = INVOICE_COLUMNS.split(",").map((key) => key.trim()) as (keyof Invoice)[];

function pick(row: Record<string, unknown>): Invoice {
  return Object.fromEntries(KEYS.map((key) => [key, row[key]])) as Invoice;
}
