"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { useWorkspace, useWorkspaceId } from "@/features/account/workspace-queries";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import { type FormatSettings, type IsoDate } from "@/lib/format";
import { dayRangeToInstants } from "@/features/calendar/calendar-logic";
import {
  delayMinutes,
  dueRange,
  durationBounds,
  effectiveStatus,
  type TaskFilters,
  type TaskInput,
} from "./logic";
import {
  CRM_TASK_COLUMNS,
  type Assignee,
  type CrmTask,
  type CrmTaskContact,
  type TaskOrigin,
} from "./types";

/** Open tasks are what is to be done; this only bounds the query. */
export const OPEN_LIMIT = 300;
export const DONE_PAGE_SIZE = 20;
/** Tasks of one deal or contact shown in its detail and history. */
const TARGET_LIMIT = 100;
const CALENDAR_LIMIT = 500;
const SEARCH_LIMIT = 6;

export const crmTaskKeys = {
  all: (userId: string) => ["crmTasks", userId] as const,
  open: (userId: string, filters: TaskFilters, zone: string, week: number) =>
    ["crmTasks", userId, "open", filters, zone, week] as const,
  done: (userId: string, filters: TaskFilters, zone: string, week: number, page: number) =>
    ["crmTasks", userId, "done", filters, zone, week, page] as const,
  target: (userId: string, kind: "deal" | "contact", id: string) =>
    ["crmTasks", userId, "target", kind, id] as const,
  one: (userId: string, id: string) => ["crmTasks", userId, "one", id] as const,
  calendar: (userId: string, from: string, to: string) =>
    ["crmTasks", userId, "calendar", from, to] as const,
  targets: (userId: string, term: string) => ["crmTasks", userId, "targets", term] as const,
  // Under "workers", so saving a worker refreshes the names too.
  assignees: (userId: string) => ["workers", userId, "assignees"] as const,
};

function invalidateTasks(queryClient: QueryClient, userId: string) {
  return queryClient.invalidateQueries({ queryKey: crmTaskKeys.all(userId) });
}

/** The part of the query builder the filters use; each call returns the builder. */
type FilterBuilder = {
  eq(column: string, value: string): FilterBuilder;
  lte(column: string, value: number): FilterBuilder;
  gt(column: string, value: number): FilterBuilder;
  gte(column: string, value: string): FilterBuilder;
  lt(column: string, value: string): FilterBuilder;
};

/** The filters every list applies in the database (who, length, deal, contact, due). */
function applyFilters<Q>(
  query: Q,
  filters: TaskFilters,
  userId: string,
  settings: FormatSettings,
  now: Date,
): Q {
  let q = query as unknown as FilterBuilder;
  if (filters.who === "me") q = q.eq("assignee_id", userId);
  else if (filters.who !== "anyone") q = q.eq("assignee_id", filters.who);
  const length = durationBounds(filters.duration);
  if (length.max !== null) q = q.lte("duration_minutes", length.max);
  if (length.over !== null) q = q.gt("duration_minutes", length.over);
  if (filters.deal) q = q.eq("deal_id", filters.deal);
  if (filters.contact) q = q.eq("contact_id", filters.contact);
  const range = dueRange(filters, now, settings);
  if (range.from) q = q.gte("due_at", range.from.toISOString());
  if (range.to) q = q.lt("due_at", range.to.toISOString());
  return q as unknown as Q;
}

/** The open tasks of the list, oldest due first, filtered in the database. */
export function useOpenTasks(filters: TaskFilters, settings: FormatSettings) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const enabled = effectiveStatus(filters) !== "done";
  return useQuery({
    queryKey: crmTaskKeys.open(user.id, filters, settings.timeZone, settings.weekStartsOn),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<CrmTask[]> => {
      const base = createClient()
        .from("crm_tasks")
        .select(CRM_TASK_COLUMNS)
        .eq("user_id", workspaceId)
        .eq("status", "open");
      const { data, error } = await applyFilters(base, filters, user.id, settings, new Date())
        .order("due_at")
        .order("created_at")
        .limit(OPEN_LIMIT);
      if (error) throw error;
      return data as CrmTask[];
    },
  });
}

/** Done tasks, the latest finished first, a page at a time. */
export function useDoneTasks(filters: TaskFilters, settings: FormatSettings, page: number) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const enabled = effectiveStatus(filters) !== "open";
  return useQuery({
    queryKey: crmTaskKeys.done(user.id, filters, settings.timeZone, settings.weekStartsOn, page),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ rows: CrmTask[]; total: number }> => {
      const base = createClient()
        .from("crm_tasks")
        .select(CRM_TASK_COLUMNS, { count: "exact" })
        .eq("user_id", workspaceId)
        .eq("status", "done");
      const { data, error, count } = await applyFilters(
        base,
        filters,
        user.id,
        settings,
        new Date(),
      )
        .order("completed_at", { ascending: false })
        .range(page * DONE_PAGE_SIZE, page * DONE_PAGE_SIZE + DONE_PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: data as CrmTask[], total: count ?? data.length };
    },
  });
}

/** Every task of one deal or contact (open and done), for its detail and its history. */
export function useTargetTasks(kind: "deal" | "contact", id: string) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: crmTaskKeys.target(user.id, kind, id),
    queryFn: async (): Promise<CrmTask[]> => {
      const { data, error } = await createClient()
        .from("crm_tasks")
        .select(CRM_TASK_COLUMNS)
        .eq("user_id", workspaceId)
        .eq(kind === "deal" ? "deal_id" : "contact_id", id)
        .order("due_at")
        .limit(TARGET_LIMIT);
      if (error) throw error;
      return data as CrmTask[];
    },
  });
}

/** One task, for its detail opened from an address. */
export function useCrmTask(id: string | null) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: crmTaskKeys.one(user.id, id ?? ""),
    enabled: Boolean(id),
    queryFn: async (): Promise<CrmTask | null> => {
      const { data, error } = await createClient()
        .from("crm_tasks")
        .select(CRM_TASK_COLUMNS)
        .eq("user_id", workspaceId)
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as CrmTask | null;
    },
  });
}

/** Open tasks due in the shown days, for the calendar. */
export function useCalendarTasks(
  firstDay: IsoDate,
  lastDay: IsoDate,
  timeZone: string,
  enabled: boolean,
) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const { from, to } = dayRangeToInstants(firstDay, lastDay, timeZone);
  return useQuery({
    queryKey: crmTaskKeys.calendar(user.id, from, to),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<CrmTask[]> => {
      const { data, error } = await createClient()
        .from("crm_tasks")
        .select(CRM_TASK_COLUMNS)
        .eq("user_id", workspaceId)
        .eq("status", "open")
        .gte("due_at", from)
        .lt("due_at", to)
        .order("due_at")
        .limit(CALENDAR_LIMIT);
      if (error) throw error;
      return data as CrmTask[];
    },
  });
}

/** The owner and the active workers of the space, for "Kdo" and the names in the list. */
export function useAssignees() {
  const { user } = useSession();
  return useQuery({
    queryKey: crmTaskKeys.assignees(user.id),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Assignee[]> => {
      const { data, error } = await createClient().rpc("crm_task_assignees");
      if (error) throw error;
      return (data ?? []).map((row) => ({
        userId: row.user_id,
        name: row.name,
        isOwner: row.is_owner,
      }));
    },
  });
}

export type TargetOption =
  | { kind: "deal"; id: string; title: string; contact: CrmTaskContact | null }
  | { kind: "contact"; id: string; contact: CrmTaskContact };

function cleanTerm(term: string) {
  return term.replace(/[%_,()*\\"]/g, " ").trim();
}

/**
 * Deals and contacts matching what is typed, for "U čeho" and the filter.
 * RLS leaves out the ones the account may not see.
 */
export function useTargetSearch(term: string) {
  const { user } = useSession();
  const workspace = useWorkspace();
  const clean = cleanTerm(term);
  return useQuery({
    queryKey: crmTaskKeys.targets(user.id, clean),
    enabled: clean.length > 0,
    queryFn: async (): Promise<TargetOption[]> => {
      const supabase = createClient();
      const pattern = `%${clean}%`;
      const [deals, contacts] = await Promise.all([
        supabase
          .from("deals")
          .select("id, title, contact:contacts(id, company_name, first_name, last_name)")
          .eq("user_id", workspace.id)
          .ilike("title", pattern)
          .order("created_at", { ascending: false })
          .limit(SEARCH_LIMIT),
        supabase
          .from("contacts")
          .select("id, company_name, first_name, last_name")
          .eq("user_id", workspace.id)
          .or(
            `company_name.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern}`,
          )
          .order("company_name")
          .limit(SEARCH_LIMIT),
      ]);
      if (deals.error) throw deals.error;
      if (contacts.error) throw contacts.error;
      return [
        ...deals.data.map((deal): TargetOption => ({
          kind: "deal",
          id: deal.id,
          title: deal.title,
          contact: deal.contact,
        })),
        ...contacts.data.map((contact): TargetOption => ({
          kind: "contact",
          id: contact.id,
          contact,
        })),
      ];
    },
  });
}

/** The name of a deal or a contact a filter points to, for its chip. */
export function useTargetName(kind: "deal" | "contact", id: string | null) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: [...crmTaskKeys.all(user.id), "name", kind, id ?? ""],
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<
      { kind: "deal"; title: string } | { kind: "contact"; contact: CrmTaskContact } | null
    > => {
      const supabase = createClient();
      if (kind === "deal") {
        const { data, error } = await supabase
          .from("deals")
          .select("title")
          .eq("user_id", workspaceId)
          .eq("id", id!)
          .maybeSingle();
        if (error) throw error;
        return data ? { kind, title: data.title } : null;
      }
      const { data, error } = await supabase
        .from("contacts")
        .select("id, company_name, first_name, last_name")
        .eq("user_id", workspaceId)
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data ? { kind, contact: data } : null;
    },
  });
}

// ---------------------------------------------------------------------------
// Changes. The database stamps who made and who finished a task; RLS and the
// guard decide what the account may change.
// ---------------------------------------------------------------------------

function toRow(input: TaskInput) {
  return {
    title: input.title,
    description: input.description || null,
    due_at: input.due_at,
    duration_minutes: input.duration_minutes,
    assignee_id: input.assignee_id,
    deal_id: input.deal_id,
    contact_id: input.contact_id,
  };
}

export function useCreateTask(origin: TaskOrigin) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TaskInput) => {
      const assignee = input.assignee_id ?? user.id;
      const { error } = await createClient()
        .from("crm_tasks")
        .insert({ ...toRow(input), assignee_id: assignee, user_id: workspaceId });
      if (error) throw error;
      track("crm_task_created", {
        from: origin,
        duration: input.duration_minutes,
        assigned_to_other: assignee !== user.id,
        has_deal: input.deal_id !== null,
        has_contact: input.contact_id !== null,
      });
    },
    onSettled: () => invalidateTasks(queryClient, user.id),
  });
}

export function useUpdateTask() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: TaskInput }) => {
      const { error } = await createClient().from("crm_tasks").update(toRow(input)).eq("id", id);
      if (error) throw error;
      track("crm_task_updated", { via: "form" });
    },
    onSettled: () => invalidateTasks(queryClient, user.id),
  });
}

type Snapshot = [readonly unknown[], unknown][];

/**
 * A task moved in the calendar: only its due moment changes. The calendar
 * shows it at once and puts it back if the save fails.
 */
export function useMoveTask() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const filter = { queryKey: [...crmTaskKeys.all(user.id), "calendar"] };
  return useMutation({
    mutationFn: async ({ id, dueAt }: { id: string; dueAt: string }) => {
      const { error } = await createClient()
        .from("crm_tasks")
        .update({ due_at: dueAt })
        .eq("id", id);
      if (error) throw error;
      track("crm_task_updated", { via: "calendar" });
    },
    onMutate: async ({ id, dueAt }): Promise<{ snapshot: Snapshot }> => {
      await queryClient.cancelQueries(filter);
      const snapshot = queryClient.getQueriesData<CrmTask[]>(filter);
      queryClient.setQueriesData<CrmTask[]>(filter, (tasks) =>
        tasks?.map((task) => (task.id === id ? { ...task, due_at: dueAt } : task)),
      );
      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data);
    },
    onSettled: () => invalidateTasks(queryClient, user.id),
  });
}

/** Done, with the note written in the same step (or none). */
export function useCompleteTask() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ task, note }: { task: CrmTask; note: string }) => {
      const clean = note.trim();
      const { error } = await createClient()
        .from("crm_tasks")
        .update({ status: "done", completion_note: clean || null })
        .eq("id", task.id);
      if (error) throw error;
      track("crm_task_completed", {
        duration: task.duration_minutes,
        delay_minutes: delayMinutes(task.due_at, new Date()),
        has_note: clean.length > 0,
      });
    },
    onSettled: () => invalidateTasks(queryClient, user.id),
  });
}

/** Back to open; the database clears the finish and its note. */
export function useReopenTask() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await createClient()
        .from("crm_tasks")
        .update({ status: "open" })
        .eq("id", id);
      if (error) throw error;
      track("crm_task_reopened", {});
    },
    onSettled: () => invalidateTasks(queryClient, user.id),
  });
}

export function useDeleteTask() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await createClient().from("crm_tasks").delete().eq("id", id);
      if (error) throw error;
      track("crm_task_deleted", {});
    },
    onSettled: () => invalidateTasks(queryClient, user.id),
  });
}
