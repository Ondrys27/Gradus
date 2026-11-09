"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import { financeKeys } from "../queries";
import { type NewPlanRow } from "./carry-over";
import {
  loadCarrySources,
  loadPlanDeals,
  loadPlanMonth,
  loadPlanMonths,
  loadPlanTransactions,
  type LoadedPlan,
} from "./load";
import { rowsOfKind, type PlanKind, type PlanRow } from "./sheet";
import type { PlanMonthKey } from "./weeks";

export const planKeys = {
  all: (userId: string) => [...financeKeys.all(userId), "plan"] as const,
  month: (userId: string, space: string, month: PlanMonthKey) =>
    [...financeKeys.all(userId), "plan", space, "month", month] as const,
  months: (userId: string, space: string, months: PlanMonthKey[]) =>
    [...financeKeys.all(userId), "plan", space, "months", months.join(",")] as const,
  actuals: (userId: string, space: string, month: PlanMonthKey) =>
    [...financeKeys.all(userId), "plan", space, "actuals", month] as const,
  deals: (userId: string, space: string, month: PlanMonthKey) =>
    [...financeKeys.all(userId), "plan", space, "deals", month] as const,
};

/** What went wrong, as a key of `finance.plan.errors`. */
export type PlanErrorKey = "labelTaken" | "readOnly" | "closed" | "monthExists" | "saveFailed";

export function planErrorKey(error: unknown): PlanErrorKey {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? "");
  const code = (error as { code?: string })?.code;
  if (/read_only/.test(message)) return "readOnly";
  if (/finance_plan_month_closed/.test(message)) return "closed";
  if (/month_exists/.test(message)) return "monthExists";
  if (/finance_plan_rows_label_idx/.test(message) || code === "23505") return "labelTaken";
  return "saveFailed";
}

export function usePlanMonth(month: PlanMonthKey) {
  const { user } = useSession();
  const space = useWorkspaceId();
  return useQuery({
    queryKey: planKeys.month(user.id, space, month),
    queryFn: () => loadPlanMonth(createClient(), space, month),
  });
}

export function usePlanMonths(months: PlanMonthKey[]) {
  const { user } = useSession();
  const space = useWorkspaceId();
  return useQuery({
    queryKey: planKeys.months(user.id, space, months),
    queryFn: async () => {
      const client = createClient();
      const records = await loadPlanMonths(client, space, months);
      const plans = await Promise.all(records.map((record) => loadPlanMonth(client, space, record.month)));
      return plans;
    },
  });
}

/** The transactions of the month's weeks (the actuals); only fetched when they are shown. */
export function usePlanActuals(month: PlanMonthKey, enabled = true) {
  const { user } = useSession();
  const space = useWorkspaceId();
  return useQuery({
    queryKey: planKeys.actuals(user.id, space, month),
    queryFn: () => loadPlanTransactions(createClient(), space, month),
    enabled,
  });
}

export function usePlanDeals(month: PlanMonthKey, enabled = true) {
  const { user } = useSession();
  const space = useWorkspaceId();
  return useQuery({
    queryKey: planKeys.deals(user.id, space, month),
    queryFn: () => loadPlanDeals(createClient(), space, month),
    enabled,
  });
}

export async function fetchCarrySources(space: string, month: PlanMonthKey) {
  return loadCarrySources(createClient(), space, month);
}

export async function fetchPlanMonth(space: string, month: PlanMonthKey) {
  return loadPlanMonth(createClient(), space, month);
}

/** Changes the cached month in place (optimistic), returning what to put back on failure. */
function usePlanCache(month: PlanMonthKey) {
  const { user } = useSession();
  const space = useWorkspaceId();
  const queryClient = useQueryClient();
  const key = planKeys.month(user.id, space, month);
  return {
    space,
    key,
    queryClient,
    async change(update: (plan: LoadedPlan) => LoadedPlan) {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<LoadedPlan>(key);
      if (previous) queryClient.setQueryData<LoadedPlan>(key, update(previous));
      return previous;
    },
    restore(previous: LoadedPlan | undefined) {
      if (previous) queryClient.setQueryData(key, previous);
      void queryClient.invalidateQueries({ queryKey: key });
    },
    refresh() {
      return queryClient.invalidateQueries({ queryKey: planKeys.all(user.id) });
    },
  };
}

export type CellChange = { rowId: string; kind: PlanKind; week: number; value: number | null; expression: boolean };

/** One planned number: saved at once, shown before the answer, put back if it fails. */
export function useSavePlanCell(month: PlanMonthKey) {
  const cache = usePlanCache(month);
  return useMutation({
    mutationFn: async ({ rowId, week, value }: CellChange) => {
      const supabase = createClient();
      const { error } =
        value === null || value === 0
          ? await supabase
              .from("finance_plan_cells")
              .delete()
              .eq("user_id", cache.space)
              .eq("row_id", rowId)
              .eq("week", week)
          : await supabase
              .from("finance_plan_cells")
              .upsert(
                { user_id: cache.space, row_id: rowId, week, planned: value },
                { onConflict: "row_id,week" },
              );
      if (error) throw error;
    },
    onMutate: ({ rowId, week, value }) =>
      cache.change((plan) => ({
        ...plan,
        cells: [
          ...plan.cells.filter((cell) => !(cell.row_id === rowId && cell.week === week)),
          ...(value ? [{ row_id: rowId, week, planned: value, note: null }] : []),
        ],
      })),
    onError: (_error, _variables, previous) => cache.restore(previous),
    onSuccess: (_data, { kind, value, expression }) =>
      track("finance_plan_cell_saved", { kind, expression, cleared: !value }),
  });
}

export type MonthChange = { opening_capital?: number; reserve?: number | null; closed?: boolean };

export function useUpdatePlanMonth(month: PlanMonthKey) {
  const cache = usePlanCache(month);
  return useMutation({
    mutationFn: async (change: MonthChange) => {
      const { error } = await createClient()
        .from("finance_plan_months")
        .update(change)
        .eq("user_id", cache.space)
        .eq("month", month);
      if (error) throw error;
    },
    onMutate: (change) =>
      cache.change((plan) => (plan.month ? { ...plan, month: { ...plan.month, ...change } } : plan)),
    onError: (_error, _variables, previous) => cache.restore(previous),
    onSuccess: (_data, change) =>
      track("finance_plan_month_updated", {
        field: change.closed !== undefined ? "closed" : change.reserve !== undefined ? "reserve" : "opening",
      }),
  });
}

export function useAddPlanRow(month: PlanMonthKey) {
  const cache = usePlanCache(month);
  return useMutation({
    mutationFn: async (input: {
      kind: PlanKind;
      label: string;
      from: "typed" | "pipeline";
      source?: PlanRow["source"];
      sourceId?: string | null;
      cells?: { week: number; planned: number }[];
    }) => {
      const plan = cache.queryClient.getQueryData<LoadedPlan>(cache.key);
      const last = rowsOfKind(plan?.rows ?? [], input.kind).at(-1);
      const supabase = createClient();
      const { data, error } = await supabase
        .from("finance_plan_rows")
        .insert({
          user_id: cache.space,
          month,
          kind: input.kind,
          label: input.label,
          position: (last?.position ?? -1) + 1,
          source: input.source ?? "manual",
          source_id: input.sourceId ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      const cells = (input.cells ?? []).filter((cell) => cell.planned !== 0);
      if (cells.length) {
        const { error: cellError } = await supabase
          .from("finance_plan_cells")
          .insert(cells.map((cell) => ({ ...cell, user_id: cache.space, row_id: data.id })));
        if (cellError) throw cellError;
      }
      track("finance_plan_row_added", { kind: input.kind, from: input.from });
      return data.id;
    },
    onSettled: () => cache.refresh(),
  });
}

export function useRenamePlanRow(month: PlanMonthKey) {
  const cache = usePlanCache(month);
  return useMutation({
    mutationFn: async ({ id, label }: { id: string; label: string }) => {
      const { error } = await createClient()
        .from("finance_plan_rows")
        .update({ label })
        .eq("user_id", cache.space)
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: ({ id, label }) =>
      cache.change((plan) => ({ ...plan, rows: plan.rows.map((row) => (row.id === id ? { ...row, label } : row)) })),
    onError: (_error, _variables, previous) => cache.restore(previous),
    onSuccess: () => track("finance_plan_row_updated", { change: "rename" }),
  });
}

/** A new order of one block: only the rows whose position changed are written. */
export function useMovePlanRow(month: PlanMonthKey) {
  const cache = usePlanCache(month);
  return useMutation({
    mutationFn: async (order: { id: string; position: number }[]) => {
      const supabase = createClient();
      for (const { id, position } of order) {
        const { error } = await supabase
          .from("finance_plan_rows")
          .update({ position })
          .eq("user_id", cache.space)
          .eq("id", id);
        if (error) throw error;
      }
    },
    onMutate: (order) =>
      cache.change((plan) => {
        const positions = new Map(order.map((item) => [item.id, item.position]));
        return {
          ...plan,
          rows: plan.rows.map((row) => (positions.has(row.id) ? { ...row, position: positions.get(row.id)! } : row)),
        };
      }),
    onError: (_error, _variables, previous) => cache.restore(previous),
    onSuccess: () => track("finance_plan_row_updated", { change: "move" }),
  });
}

export function useDeletePlanRow(month: PlanMonthKey) {
  const cache = usePlanCache(month);
  return useMutation({
    mutationFn: async ({ id }: { id: string; kind: PlanKind; hadNumbers: boolean }) => {
      const { error } = await createClient().from("finance_plan_rows").delete().eq("user_id", cache.space).eq("id", id);
      if (error) throw error;
    },
    onMutate: ({ id }) =>
      cache.change((plan) => ({
        ...plan,
        rows: plan.rows.filter((row) => row.id !== id),
        cells: plan.cells.filter((cell) => cell.row_id !== id),
      })),
    onError: (_error, _variables, previous) => cache.restore(previous),
    onSuccess: (_data, { kind, hadNumbers }) => track("finance_plan_row_deleted", { kind, had_numbers: hadNumbers }),
  });
}

/** A whole month in one transaction (a new month, an imported sheet). */
export function useWritePlanMonth() {
  const { user } = useSession();
  const space = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      month: PlanMonthKey;
      opening: number;
      reserve: number | null;
      currency: string;
      rows: NewPlanRow[];
      replace?: boolean;
    }) => {
      const { error } = await createClient().rpc("finance_plan_write_month", {
        _space: space,
        _month: input.month,
        _opening: input.opening,
        // Generated RPC types never mark arguments nullable; null = no reserve.
        _reserve: input.reserve as unknown as number,
        _currency: input.currency,
        _rows: input.rows,
        _replace: input.replace ?? false,
      });
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: planKeys.all(user.id) }),
  });
}

/** Transactions over several months (the capital chart), at most 400 days. */
export function usePlanRangeTransactions(from: string, to: string, enabled = true) {
  const { user } = useSession();
  const space = useWorkspaceId();
  return useQuery({
    queryKey: [...financeKeys.all(user.id), "plan", space, "range", from, to] as const,
    enabled,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_plan_transactions", {
        _space: space,
        _from: from,
        _to: to,
      });
      if (error) throw error;
      return (data ?? []).map((row) => ({ ...row, amount: Number(row.amount) }));
    },
  });
}
