"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { useAwardXp } from "@/features/game/queries";
import type { DailyRow, DateRange, MonthlyRow } from "./finance-logic";
import { PAGE_SIZE } from "./finance-logic";
import type { RecurringInput, TransactionInput } from "./schemas";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import {
  RECURRING_COLUMNS,
  TRANSACTION_COLUMNS,
  type RecurringPayment,
  type Transaction,
} from "./types";

const RECURRING_LIMIT = 200;

export const financeKeys = {
  all: (userId: string) => ["finance", userId] as const,
  transactions: (userId: string, range: DateRange, category: string | null, page: number) =>
    ["finance", userId, "transactions", range, category, page] as const,
  totals: (userId: string, range: DateRange, category: string | null) =>
    ["finance", userId, "totals", range, category] as const,
  monthly: (userId: string, range: DateRange) => ["finance", userId, "monthly", range] as const,
  daily: (userId: string, range: DateRange) => ["finance", userId, "daily", range] as const,
  recurring: (userId: string) => ["finance", userId, "recurring"] as const,
  /** Everything about invoices; invalidated with the rest of Finance. */
  invoices: (userId: string) => ["finance", userId, "invoices"] as const,
};

/**
 * Deals moved into a deposit or won stage book income in the database, so the
 * pipeline calls this after a move.
 */
export function invalidateFinance(queryClient: QueryClient, userId: string) {
  return queryClient.invalidateQueries({ queryKey: financeKeys.all(userId) });
}

export function useTransactions(range: DateRange, category: string | null, page: number) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: financeKeys.transactions(user.id, range, category, page),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ rows: Transaction[]; total: number }> => {
      let query = createClient()
        .from("transactions")
        .select(TRANSACTION_COLUMNS, { count: "exact" })
        .eq("user_id", workspaceId)
        .gte("occurred_on", range.from)
        .lte("occurred_on", range.to)
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (category) query = query.eq("category", category);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data, total: count ?? data.length };
    },
  });
}

export function useTotals(range: DateRange, category: string | null) {
  const { user } = useSession();
  return useQuery({
    queryKey: financeKeys.totals(user.id, range, category),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_totals", {
        _from: range.from,
        _to: range.to,
        _category: category ?? undefined,
      });
      if (error) throw error;
      const row = data[0];
      return { income: Number(row?.income ?? 0), expense: Number(row?.expense ?? 0) };
    },
  });
}

export function useMonthlyTotals(range: DateRange) {
  const { user } = useSession();
  return useQuery({
    queryKey: financeKeys.monthly(user.id, range),
    queryFn: async (): Promise<MonthlyRow[]> => {
      const { data, error } = await createClient().rpc("finance_monthly_totals", {
        _from: range.from,
        _to: range.to,
      });
      if (error) throw error;
      return data.map((row) => ({
        month: row.month,
        income: Number(row.income),
        expense: Number(row.expense),
      }));
    },
  });
}

/** One row per day in the range, for the Month view of the income chart. */
export function useDailyTotals(range: DateRange) {
  const { user } = useSession();
  return useQuery({
    queryKey: financeKeys.daily(user.id, range),
    queryFn: async (): Promise<DailyRow[]> => {
      const { data, error } = await createClient().rpc("finance_daily_totals", {
        _from: range.from,
        _to: range.to,
      });
      if (error) throw error;
      return data.map((row) => ({
        day: row.day,
        income: Number(row.income),
        expense: Number(row.expense),
      }));
    },
  });
}

/** `workspaceId` is whose books: the owner's, also for a worker with the finance right. */
export function useFinanceMutation<Variables, Result = void>(
  mutationFn: (variables: Variables, workspaceId: string) => Promise<Result>,
) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: Variables) => mutationFn(variables, workspaceId),
    onSettled: () => invalidateFinance(queryClient, user.id),
  });
}

/** One transaction by id, e.g. opened from the search outside the shown period. */
export async function fetchTransaction(id: string): Promise<Transaction | null> {
  const { data, error } = await createClient()
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export function useSaveTransaction() {
  const awardXp = useAwardXp();
  return useFinanceMutation(
    async ({ id, input }: { id?: string; input: TransactionInput }, workspaceId) => {
      const row = { ...input, description: input.description || null };
      const supabase = createClient();
      const { error } = id
        ? await supabase.from("transactions").update(row).eq("user_id", workspaceId).eq("id", id)
        : await supabase.from("transactions").insert({ ...row, user_id: workspaceId });
      if (error) throw error;
      if (id) {
        track("transaction_updated", { type: input.type });
      } else {
        track("transaction_created", {
          type: input.type,
          currency: input.currency,
          has_category: input.category !== null,
        });
      }
      // A small reward for a new one; the server finds the transaction it has not paid for yet.
      if (!id) awardXp.mutate({ reason: "transaction_added" });
    },
  );
}

export function useDeleteTransaction() {
  return useFinanceMutation(async (id: string) => {
    const { error } = await createClient().from("transactions").delete().eq("id", id);
    if (error) throw error;
    track("transaction_deleted", {});
  });
}

/** Income the pipeline booked, and then flagged, is confirmed as it stands. */
export function useConfirmTransaction() {
  return useFinanceMutation(async (id: string) => {
    const { error } = await createClient()
      .from("transactions")
      .update({ needs_review: false })
      .eq("id", id);
    if (error) throw error;
    track("transaction_confirmed", {});
  });
}

export function useRecurringPayments() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: financeKeys.recurring(user.id),
    queryFn: async (): Promise<RecurringPayment[]> => {
      const { data, error } = await createClient()
        .from("recurring_payments")
        .select(RECURRING_COLUMNS)
        .eq("user_id", workspaceId)
        .order("next_due_on")
        .limit(RECURRING_LIMIT);
      if (error) throw error;
      return data;
    },
  });
}

/** Weekly payments have no day of the month; the others keep the day of the first one. */
function dueDay(input: RecurringInput): number | null {
  return input.frequency === "weekly" ? null : Number(input.next_due_on.slice(8, 10));
}

export function useSaveRecurring() {
  return useFinanceMutation(
    async ({ id, input }: { id?: string; input: RecurringInput }, workspaceId) => {
      const row = { ...input, due_day: dueDay(input) };
      const supabase = createClient();
      const { error } = id
        ? await supabase
            .from("recurring_payments")
            .update(row)
            .eq("user_id", workspaceId)
            .eq("id", id)
        : await supabase.from("recurring_payments").insert({ ...row, user_id: workspaceId });
      if (error) throw error;
      track("recurring_payment_saved", {
        created: !id,
        type: input.type,
        frequency: input.frequency,
      });
    },
  );
}

export function useToggleRecurring() {
  return useFinanceMutation(async ({ id, active }: { id: string; active: boolean }) => {
    const { error } = await createClient()
      .from("recurring_payments")
      .update({ is_active: active })
      .eq("id", id);
    if (error) throw error;
    track("recurring_payment_toggled", { active });
  });
}

export function useDeleteRecurring() {
  return useFinanceMutation(async (id: string) => {
    const { error } = await createClient().from("recurring_payments").delete().eq("id", id);
    if (error) throw error;
    track("recurring_payment_deleted", {});
  });
}
