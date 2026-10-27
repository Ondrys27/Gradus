"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { financeKeys, invalidateFinance } from "@/features/finance/queries";
import { cleanTerm } from "@/features/contacts/contact-search";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import {
  cancelInvoiceAction,
  createInvoiceFromDealAction,
  issueInvoiceAction,
  lookupAresAction,
  markInvoicePaidAction,
  saveInvoiceDraftAction,
  saveInvoiceProfileAction,
} from "./actions";
import { InvoiceError, unwrap, type InvoiceErrorCode } from "./errors";
import type { InvoiceDraftInput, InvoiceEmailInput, InvoiceProfileInput } from "./schemas";
import {
  INVOICE_LIST_COLUMNS,
  INVOICE_RECORD_COLUMNS,
  PROFILE_COLUMNS,
  toInvoiceRecord,
  UNPAID_STATUSES,
  type InvoiceFilter,
  type InvoiceListRow,
  type InvoiceProfile,
  type InvoiceRecord,
  type InvoiceSort,
} from "./types";

/** Rows per page of the list. */
export const INVOICE_PAGE_SIZE = 20;

const keys = {
  all: (userId: string) => financeKeys.invoices(userId),
  profile: (userId: string, workspaceId: string) =>
    [...financeKeys.invoices(userId), "profile", workspaceId] as const,
  list: (userId: string, args: ListArgs) => [...financeKeys.invoices(userId), "list", args] as const,
  one: (userId: string, id: string) => [...financeKeys.invoices(userId), "one", id] as const,
};

/** The supplier's details of the workspace, or null before the first save. */
export function useInvoiceProfile() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: keys.profile(user.id, workspaceId),
    queryFn: async (): Promise<InvoiceProfile | null> => {
      const { data, error } = await createClient()
        .from("invoice_profiles")
        .select(PROFILE_COLUMNS)
        .eq("user_id", workspaceId)
        .maybeSingle();
      if (error) throw error;
      return data as InvoiceProfile | null;
    },
  });
}

export function useSaveInvoiceProfile() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: InvoiceProfileInput) => unwrap(await saveInvoiceProfileAction(input)),
    onSuccess: (profile) => queryClient.setQueryData(keys.profile(user.id, workspaceId), profile),
  });
}

export function useAresLookup() {
  return useMutation({
    mutationFn: async (ico: string) => unwrap(await lookupAresAction(ico)),
  });
}

export type ListArgs = {
  filter: InvoiceFilter;
  search: string;
  sort: InvoiceSort;
  page: number;
  today: string;
};

const SORTS: Record<InvoiceSort, { column: string; ascending: boolean }> = {
  issuedDesc: { column: "issued_on", ascending: false },
  dueAsc: { column: "due_on", ascending: true },
  totalDesc: { column: "total", ascending: false },
  numberDesc: { column: "number", ascending: false },
};

export function useInvoiceList(args: ListArgs) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: keys.list(user.id, args),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ rows: InvoiceListRow[]; total: number }> => {
      const sort = SORTS[args.sort];
      let query = createClient()
        .from("invoices")
        .select(INVOICE_LIST_COLUMNS, { count: "exact" })
        .eq("user_id", workspaceId);
      switch (args.filter) {
        case "draft":
          query = query.eq("status", "draft");
          break;
        case "issued":
          query = query
            .eq("kind", "invoice")
            .in("status", [...UNPAID_STATUSES])
            .or(`due_on.is.null,due_on.gte.${args.today}`);
          break;
        case "overdue":
          query = query.eq("kind", "invoice").in("status", [...UNPAID_STATUSES]).lt("due_on", args.today);
          break;
        case "paid":
          query = query.eq("status", "paid");
          break;
        case "cancelled":
          query = query.in("status", ["cancelled", "uncollectible"]);
          break;
      }
      const term = cleanTerm(args.search);
      if (term) query = query.or(`number.ilike.*${term}*,customer_name.ilike.*${term}*`);
      const { data, error, count } = await query
        .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(args.page * INVOICE_PAGE_SIZE, args.page * INVOICE_PAGE_SIZE + INVOICE_PAGE_SIZE - 1);
      if (error) throw error;
      return {
        rows: data.map((row) => ({ ...row, total: Number(row.total) }) as InvoiceListRow),
        total: count ?? data.length,
      };
    },
  });
}

export type InvoiceWithLinks = InvoiceRecord & {
  /** The number of the invoice a credit note corrects. */
  creditedNumber: string | null;
  /** The credit note of a cancelled invoice. */
  creditNote: { id: string; number: string | null } | null;
};

export function useInvoice(id: string | null) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: keys.one(user.id, id ?? "new"),
    enabled: Boolean(id),
    queryFn: async (): Promise<InvoiceWithLinks | null> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("invoices")
        .select(INVOICE_RECORD_COLUMNS)
        .eq("user_id", workspaceId)
        .eq("id", id ?? "")
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const invoice = toInvoiceRecord(data);
      const [credited, credit] = await Promise.all([
        invoice.credited_invoice_id
          ? supabase.from("invoices").select("number").eq("id", invoice.credited_invoice_id).maybeSingle()
          : Promise.resolve({ data: null }),
        invoice.status === "cancelled" && invoice.kind === "invoice"
          ? supabase
              .from("invoices")
              .select("id, number")
              .eq("user_id", workspaceId)
              .eq("credited_invoice_id", invoice.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      return {
        ...invoice,
        creditedNumber: credited.data?.number ?? null,
        creditNote: credit.data ? { id: credit.data.id, number: credit.data.number } : null,
      };
    },
  });
}

function useInvoiceMutation<Variables, Result>(mutationFn: (variables: Variables) => Promise<Result>) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    // Paying books income, so all of Finance is read again.
    onSettled: () => invalidateFinance(queryClient, user.id),
  });
}

export function useSaveInvoiceDraft() {
  return useInvoiceMutation(async (input: InvoiceDraftInput) =>
    unwrap(await saveInvoiceDraftAction(input)),
  );
}

export function useIssueInvoice() {
  return useInvoiceMutation(async (input: InvoiceDraftInput) => unwrap(await issueInvoiceAction(input)));
}

export function useCreateInvoiceFromDeal() {
  return useInvoiceMutation(async (dealId: string) =>
    unwrap(await createInvoiceFromDealAction(dealId)),
  );
}

export function useMarkInvoicePaid() {
  return useInvoiceMutation(async (id: string) => unwrap(await markInvoicePaidAction(id)));
}

export function useCancelInvoice() {
  return useInvoiceMutation(async (id: string) => unwrap(await cancelInvoiceAction(id)));
}

/** Only a draft goes away; an issued invoice is cancelled instead (the database refuses). */
export function useDeleteDraft() {
  return useInvoiceMutation(async (id: string) => {
    const { error } = await createClient().from("invoices").delete().eq("id", id).eq("status", "draft");
    if (error) throw error;
    track("invoice_deleted", {});
  });
}

async function routeError(response: Response): Promise<InvoiceError> {
  const body = (await response.json().catch(() => null)) as { error?: InvoiceErrorCode } | null;
  return new InvoiceError(body?.error ?? "unknown");
}

/** The signed link to the stored PDF, made on first need. */
export async function invoicePdfUrl(id: string): Promise<string> {
  const response = await fetch(`/api/invoices/${id}/pdf`, { cache: "no-store" });
  if (!response.ok) throw await routeError(response);
  const body = (await response.json()) as { url: string };
  return body.url;
}

export function useDownloadInvoicePdf() {
  return useMutation({
    mutationFn: async (id: string) => {
      window.location.assign(await invoicePdfUrl(id));
    },
  });
}

export function useSendInvoice() {
  return useInvoiceMutation(async (input: InvoiceEmailInput) => {
    const { invoiceId, ...body } = input;
    const response = await fetch(`/api/invoices/${invoiceId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await routeError(response);
  });
}
