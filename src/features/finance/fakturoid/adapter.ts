import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { INVOICE_COLUMNS, type Invoice } from "../types";

/**
 * Invoices kept only in the app's own tables, through the database functions.
 * Used when Fakturoid is not connected; the client passed in acts as the user,
 * so RLS and auth.uid() decide what is theirs.
 */
export function createLocalInvoiceProvider(supabase: SupabaseClient<Database>) {
  return {
    async createFromDeal(dealId: string): Promise<Invoice> {
      const { data, error } = await supabase.rpc("create_invoice_from_deal", { _deal_id: dealId });
      if (error) throw error;
      return pickInvoice(data);
    },
    async markPaid(invoiceId: string): Promise<Invoice> {
      const { data, error } = await supabase.rpc("mark_invoice_paid", { _invoice_id: invoiceId });
      if (error) throw error;
      return pickInvoice(data);
    },
  };
}

const KEYS = INVOICE_COLUMNS.split(",").map((key) => key.trim()) as (keyof Invoice)[];

/** Only the columns the screens use, whatever a function returned. */
export function pickInvoice(row: Record<string, unknown>): Invoice {
  return Object.fromEntries(KEYS.map((key) => [key, row[key] ?? null])) as Invoice;
}
