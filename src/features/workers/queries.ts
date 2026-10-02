"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { zonedWallClockToInstant, type IsoDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useFormatSettings } from "@/lib/use-format-settings";
import {
  PAGE_SIZE,
  permissionRows,
  type PaymentInput,
  type PermissionDraft,
  type WorkerInput,
  type WorkerTaskInput,
} from "./logic";
import {
  EARNING_COLUMNS,
  INVITE_COLUMNS,
  PAYMENT_COLUMNS,
  PERMISSION_COLUMNS,
  WORKER_COLUMNS,
  WORKER_TASK_COLUMNS,
  type Earning,
  type EarningStatus,
  type Payment,
  type TaskStatus,
  type Worker,
  type WorkerBalance,
  type WorkerInvite,
  type WorkerMonthStats,
  type WorkerPermission,
  type WorkerProfile,
  type WorkerTask,
  type WorkSession,
} from "./types";

/** A small team; the list is never paged, only capped. */
const WORKERS_LIMIT = 200;
/** Open tasks are few by nature; done ones are paged. */
const OPEN_TASKS_LIMIT = 200;
const SESSIONS_LIMIT = 20;

export const workerKeys = {
  all: (userId: string) => ["workers", userId] as const,
  list: (userId: string) => ["workers", userId, "list"] as const,
  profiles: (userId: string, ids: string[]) => ["workers", userId, "profiles", ids] as const,
  stats: (userId: string, month: IsoDate) => ["workers", userId, "stats", month] as const,
  detail: (userId: string, workerId: string) => ["workers", userId, "detail", workerId] as const,
  invite: (userId: string, workerId: string) => ["workers", userId, "invite", workerId] as const,
  permissions: (userId: string, workerId: string) =>
    ["workers", userId, "permissions", workerId] as const,
  tasks: (userId: string, workerId: string) => ["workers", userId, "tasks", workerId] as const,
  doneTasks: (userId: string, workerId: string, page: number) =>
    ["workers", userId, "tasks", workerId, "done", page] as const,
  earnings: (userId: string, workerId: string) =>
    ["workers", userId, "earnings", workerId] as const,
  earningsPage: (userId: string, workerId: string, status: EarningStatus | null, page: number) =>
    ["workers", userId, "earnings", workerId, status, page] as const,
  balance: (userId: string, workerId: string) =>
    ["workers", userId, "earnings", workerId, "balance"] as const,
  payments: (userId: string, workerId: string, page: number) =>
    ["workers", userId, "earnings", workerId, "payments", page] as const,
  sessions: (userId: string, workerId: string) =>
    ["workers", userId, "sessions", workerId] as const,
  timer: (userId: string) => ["workers", userId, "timer"] as const,
};

function invalidateAll(queryClient: QueryClient, userId: string) {
  return queryClient.invalidateQueries({ queryKey: workerKeys.all(userId) });
}

const toNumber = (value: number | string | null | undefined) => Number(value ?? 0);

// ---------------------------------------------------------------------------
// Owner: the team
// ---------------------------------------------------------------------------

export function useWorkers() {
  const { user } = useSession();
  return useQuery({
    queryKey: workerKeys.list(user.id),
    queryFn: async (): Promise<Worker[]> => {
      const { data, error } = await createClient()
        .from("workers")
        .select(WORKER_COLUMNS)
        .eq("owner_id", user.id)
        .order("created_at")
        .limit(WORKERS_LIMIT);
      if (error) throw error;
      return data;
    },
  });
}

/** Avatars and names of the accounts that accepted an invite. */
export function useWorkerProfiles(accountIds: string[]) {
  const { user } = useSession();
  const ids = [...accountIds].sort();
  return useQuery({
    queryKey: workerKeys.profiles(user.id, ids),
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Map<string, WorkerProfile>> => {
      const { data, error } = await createClient()
        .from("profiles")
        .select("id, avatar_url, display_name")
        .in("id", ids);
      if (error) throw error;
      return new Map(
        data.map((row) => [row.id, { avatarUrl: row.avatar_url, displayName: row.display_name }]),
      );
    },
  });
}

/**
 * The month on every card. Sessions left open past their idle end are closed
 * first, so their hours turn into earnings even if nobody pressed pause.
 */
export function useWorkerMonthStats(monthStart: IsoDate) {
  const { user } = useSession();
  const { timeZone } = useFormatSettings();
  return useQuery({
    queryKey: workerKeys.stats(user.id, monthStart),
    queryFn: async (): Promise<Map<string, WorkerMonthStats>> => {
      const supabase = createClient();
      const settled = await supabase.rpc("settle_idle_work_sessions");
      if (settled.error) throw settled.error;
      const { data, error } = await supabase.rpc("worker_month_stats", {
        _month_start: monthStart,
        _timezone: timeZone,
      });
      if (error) throw error;
      return new Map(
        data.map((row) => [
          row.worker_id,
          {
            workSeconds: row.work_seconds,
            earned: toNumber(row.earned),
            pendingAmount: toNumber(row.pending_amount),
            pendingCount: row.pending_count,
            tasksTotal: row.tasks_total,
            tasksDone: row.tasks_done,
          },
        ]),
      );
    },
  });
}

export function useWorker(workerId: string) {
  const { user } = useSession();
  return useQuery({
    queryKey: workerKeys.detail(user.id, workerId),
    queryFn: async (): Promise<Worker | null> => {
      const { data, error } = await createClient()
        .from("workers")
        .select(WORKER_COLUMNS)
        .eq("id", workerId)
        .eq("owner_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/** The latest invite of a worker. */
export function useWorkerInvite(workerId: string, enabled = true) {
  const { user } = useSession();
  return useQuery({
    queryKey: workerKeys.invite(user.id, workerId),
    enabled,
    queryFn: async (): Promise<WorkerInvite | null> => {
      const { data, error } = await createClient()
        .from("worker_invites")
        .select(INVITE_COLUMNS)
        .eq("worker_id", workerId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useWorkerPermissions(workerId: string) {
  const { user } = useSession();
  return useQuery({
    queryKey: workerKeys.permissions(user.id, workerId),
    queryFn: async (): Promise<WorkerPermission[]> => {
      const { data, error } = await createClient()
        .from("worker_permissions")
        .select(PERMISSION_COLUMNS)
        .eq("worker_id", workerId);
      if (error) throw error;
      return data;
    },
  });
}

async function savePermissions(ownerId: string, workerId: string, draft: PermissionDraft) {
  const { error } = await createClient()
    .from("worker_permissions")
    .upsert(
      permissionRows(draft).map((row) => ({ ...row, owner_id: ownerId, worker_id: workerId })),
      { onConflict: "worker_id,section" },
    );
  if (error) throw error;
}

/**
 * Saves the matrix as it is switched. The screen shows the change at once and
 * goes back if the save fails; the worker's app hears it live (Realtime) and
 * the database applies it to their very next query.
 */
export function useSaveWorkerPermissions(workerId: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const key = workerKeys.permissions(user.id, workerId);
  return useMutation({
    mutationKey: ["workers", "permissions", workerId],
    mutationFn: (draft: PermissionDraft) => savePermissions(user.id, workerId, draft),
    onMutate: async (draft) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<WorkerPermission[]>(key);
      queryClient.setQueryData<WorkerPermission[]>(key, permissionRows(draft));
      return { previous };
    },
    onError: (_error, _draft, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: ["workers", "permissions", workerId] }) > 1) return;
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/** Worker, permissions and invite in one go; the database picks the invite code. */
export function useCreateWorker() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { worker: WorkerInput; permissions: PermissionDraft }) => {
      const supabase = createClient();
      const { data: worker, error } = await supabase
        .from("workers")
        .insert({ ...input.worker, owner_id: user.id })
        .select(WORKER_COLUMNS)
        .single();
      if (error) throw error;
      await savePermissions(user.id, worker.id, input.permissions);
      const { data: invite, error: inviteError } = await supabase
        .from("worker_invites")
        .insert({ owner_id: user.id, worker_id: worker.id, email: worker.email })
        .select(INVITE_COLUMNS)
        .single();
      if (inviteError) throw inviteError;
      return { worker, invite };
    },
    onSettled: () => invalidateAll(queryClient, user.id),
  });
}

export function useUpdateWorker(workerId: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { worker: WorkerInput; permissions?: PermissionDraft }) => {
      const { error } = await createClient()
        .from("workers")
        .update(input.worker)
        .eq("id", workerId)
        .eq("owner_id", user.id);
      if (error) throw error;
      if (input.permissions) await savePermissions(user.id, workerId, input.permissions);
    },
    onSettled: () => invalidateAll(queryClient, user.id),
  });
}

/** A fresh link; earlier unused ones stop working. */
export function useRenewInvite(workerId: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (email: string | null) => {
      const supabase = createClient();
      const { error: deleteError } = await supabase
        .from("worker_invites")
        .delete()
        .eq("worker_id", workerId)
        .is("accepted_at", null);
      if (deleteError) throw deleteError;
      const { data, error } = await supabase
        .from("worker_invites")
        .insert({ owner_id: user.id, worker_id: workerId, email })
        .select(INVITE_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (invite) => queryClient.setQueryData(workerKeys.invite(user.id, workerId), invite),
  });
}

// ---------------------------------------------------------------------------
// Tasks (owner and worker)
// ---------------------------------------------------------------------------

export function useOpenWorkerTasks(workerId: string | null) {
  const { user } = useSession();
  return useQuery({
    queryKey: workerKeys.tasks(user.id, workerId ?? ""),
    enabled: Boolean(workerId),
    queryFn: async (): Promise<WorkerTask[]> => {
      const { data, error } = await createClient()
        .from("worker_tasks")
        .select(WORKER_TASK_COLUMNS)
        .eq("worker_id", workerId!)
        .neq("status", "done")
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at")
        .limit(OPEN_TASKS_LIMIT);
      if (error) throw error;
      return data;
    },
  });
}

export function useDoneWorkerTasks(workerId: string | null, page: number) {
  const { user } = useSession();
  return useQuery({
    queryKey: workerKeys.doneTasks(user.id, workerId ?? "", page),
    enabled: Boolean(workerId),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ rows: WorkerTask[]; total: number }> => {
      const { data, error, count } = await createClient()
        .from("worker_tasks")
        .select(WORKER_TASK_COLUMNS, { count: "exact" })
        .eq("worker_id", workerId!)
        .eq("status", "done")
        .order("completed_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: data, total: count ?? data.length };
    },
  });
}

export function useSaveWorkerTask(workerId: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: WorkerTaskInput }) => {
      const supabase = createClient();
      const { error } = id
        ? await supabase.from("worker_tasks").update(input).eq("id", id)
        : await supabase
            .from("worker_tasks")
            .insert({ ...input, owner_id: user.id, worker_id: workerId, assigned_by: user.id });
      if (error) throw error;
    },
    onSettled: () => invalidateAll(queryClient, user.id),
  });
}

export function useDeleteWorkerTask() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await createClient().from("worker_tasks").delete().eq("id", id);
      if (error) throw error;
    },
    onSettled: () => invalidateAll(queryClient, user.id),
  });
}

/** Ticking a task off (or back on). Doing it may create a pending earning in the database. */
export function useSetWorkerTaskStatus() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: TaskStatus }) => {
      const { error } = await createClient().from("worker_tasks").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSettled: () => invalidateAll(queryClient, user.id),
  });
}

// ---------------------------------------------------------------------------
// Earnings and payments (owner and worker)
// ---------------------------------------------------------------------------

export function useEarnings(workerId: string | null, status: EarningStatus | null, page: number) {
  const { user } = useSession();
  return useQuery({
    queryKey: workerKeys.earningsPage(user.id, workerId ?? "", status, page),
    enabled: Boolean(workerId),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ rows: Earning[]; total: number }> => {
      let query = createClient()
        .from("worker_earnings")
        .select(EARNING_COLUMNS, { count: "exact" })
        .eq("worker_id", workerId!)
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (status) query = query.eq("status", status);
      const { data, error, count } = await query;
      if (error) throw error;
      return {
        rows: data.map((row) => ({
          ...row,
          amount: toNumber(row.amount),
          basis: row.basis === null ? null : toNumber(row.basis),
        })),
        total: count ?? data.length,
      };
    },
  });
}

export function useWorkerBalance(workerId: string | null) {
  const { user } = useSession();
  return useQuery({
    queryKey: workerKeys.balance(user.id, workerId ?? ""),
    enabled: Boolean(workerId),
    queryFn: async (): Promise<WorkerBalance> => {
      const { data, error } = await createClient().rpc("worker_balance", {
        _worker_id: workerId!,
      });
      if (error) throw error;
      const row = data[0];
      return {
        earned: toNumber(row?.earned),
        pending: toNumber(row?.pending),
        paidOut: toNumber(row?.paid_out),
        owed: toNumber(row?.owed),
      };
    },
  });
}

/** Approves the given pending earnings, or every pending one of the worker. */
export function useApproveEarnings(workerId: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[] | "all") => {
      let query = createClient()
        .from("worker_earnings")
        .update({ status: "approved" })
        .eq("worker_id", workerId)
        .eq("status", "pending");
      if (ids !== "all") query = query.in("id", ids);
      const { error } = await query;
      if (error) throw error;
    },
    onSettled: () => invalidateAll(queryClient, user.id),
  });
}

export function usePayments(workerId: string, page: number) {
  const { user } = useSession();
  return useQuery({
    queryKey: workerKeys.payments(user.id, workerId, page),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ rows: Payment[]; total: number }> => {
      const { data, error, count } = await createClient()
        .from("worker_payments")
        .select(PAYMENT_COLUMNS, { count: "exact" })
        .eq("worker_id", workerId)
        .order("paid_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) throw error;
      return {
        rows: data.map((row) => ({ ...row, amount: toNumber(row.amount) })),
        total: count ?? data.length,
      };
    },
  });
}

/** Records a payment; the database marks approved earnings paid, oldest first. */
export function useRecordPayment(workerId: string) {
  const { user } = useSession();
  const { timeZone } = useFormatSettings();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PaymentInput) => {
      // Noon of the chosen day in the user's zone; the database never takes a future time.
      const paidAt = zonedWallClockToInstant(input.paid_on, "12:00", timeZone);
      const { error } = await createClient().rpc("record_worker_payment", {
        _worker_id: workerId,
        _amount: input.amount,
        _paid_at: paidAt.toISOString(),
        _note: input.note,
      });
      if (error) throw error;
    },
    onSettled: () => invalidateAll(queryClient, user.id),
  });
}

// ---------------------------------------------------------------------------
// Work time
// ---------------------------------------------------------------------------

export function useWorkerSessions(workerId: string | null) {
  const { user } = useSession();
  return useQuery({
    queryKey: workerKeys.sessions(user.id, workerId ?? ""),
    enabled: Boolean(workerId),
    queryFn: async (): Promise<WorkSession[]> => {
      const { data, error } = await createClient().rpc("worker_sessions", {
        _worker_id: workerId!,
        _limit: SESSIONS_LIMIT,
        // No cursor: the newest sessions. The generated type misses that the argument is nullable.
        _before: null as unknown as string,
      });
      if (error) throw error;
      return data;
    },
  });
}
