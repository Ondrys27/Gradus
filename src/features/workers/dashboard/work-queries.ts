"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { dayStart, shiftIsoDate } from "@/features/crm-tasks/logic";
import { createClient } from "@/lib/supabase/client";
import { useFormatSettings } from "@/lib/use-format-settings";
import type { ChartDeal, DateRange } from "./chart-logic";
import type { WorkTask } from "./outcome";
import { dashboardKeys } from "./queries";

/**
 * What a person looks after: deals given to their account, sales tasks given
 * to it, tasks from the owner given to the worker. RLS decides what the
 * viewer sees (the owner everything, a worker what their rights open); an
 * invited person without an account has no deals or sales tasks yet.
 */

const DEALS_LIMIT = 500;
const OPEN_TASKS_LIMIT = 200;
const DONE_TASKS_LIMIT = 500;

export const WORK_DEAL_COLUMNS =
  "id, title, value, currency, stage_id, expected_close_date, created_at, won_at, lost_at" as const;

export type WorkDeal = {
  id: string;
  title: string;
  value: number | null;
  currency: string;
  stage_id: string;
  expected_close_date: string | null;
  created_at: string;
  won_at: string | null;
  lost_at: string | null;
};

/** A task of the dashboard, with what a sales task hangs on. */
export type DashboardTask = WorkTask & { dealId: string | null; contactId: string | null };

const workKeys = {
  deals: (userId: string, workerId: string) =>
    [...dashboardKeys.all(userId, workerId), "deals"] as const,
  tasks: (userId: string, workerId: string, range: DateRange, timeZone: string) =>
    [...dashboardKeys.all(userId, workerId), "tasks", range.from, range.to, timeZone] as const,
};

/** The deals in the person's care, newest first. */
export function useWorkerDeals(workerId: string, accountId: string | null) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: workKeys.deals(user.id, workerId),
    queryFn: async (): Promise<WorkDeal[]> => {
      if (!accountId) return [];
      const { data, error } = await createClient()
        .from("deals")
        .select(WORK_DEAL_COLUMNS)
        .eq("user_id", workspaceId)
        .eq("assignee_id", accountId)
        .order("created_at", { ascending: false })
        .limit(DEALS_LIMIT);
      if (error) throw error;
      return data.map((row) => ({ ...row, value: row.value === null ? null : Number(row.value) }));
    },
  });
}

/**
 * Every open task of the person, and the done ones finished inside the range
 * (the range bounds the history, the open ones are always there).
 */
export function useWorkerTasks(workerId: string, accountId: string | null, range: DateRange) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const { timeZone } = useFormatSettings();
  return useQuery({
    queryKey: workKeys.tasks(user.id, workerId, range, timeZone),
    queryFn: async (): Promise<DashboardTask[]> => {
      const supabase = createClient();
      const from = dayStart(range.from, timeZone).toISOString();
      const until = dayStart(shiftIsoDate(range.to, 1), timeZone).toISOString();
      const crmColumns = "id, title, due_at, status, completed_at, created_at, deal_id, contact_id";
      const ownerColumns = "id, title, due_date, status, completed_at, created_at";

      const crmOpen = accountId
        ? supabase
            .from("crm_tasks")
            .select(crmColumns)
            .eq("user_id", workspaceId)
            .eq("assignee_id", accountId)
            .eq("status", "open")
            .order("due_at")
            .limit(OPEN_TASKS_LIMIT)
        : null;
      const crmDone = accountId
        ? supabase
            .from("crm_tasks")
            .select(crmColumns)
            .eq("user_id", workspaceId)
            .eq("assignee_id", accountId)
            .eq("status", "done")
            .gte("completed_at", from)
            .lt("completed_at", until)
            .order("completed_at", { ascending: false })
            .limit(DONE_TASKS_LIMIT)
        : null;
      const ownerOpen = supabase
        .from("worker_tasks")
        .select(ownerColumns)
        .eq("worker_id", workerId)
        .neq("status", "done")
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(OPEN_TASKS_LIMIT);
      const ownerDone = supabase
        .from("worker_tasks")
        .select(ownerColumns)
        .eq("worker_id", workerId)
        .eq("status", "done")
        .gte("completed_at", from)
        .lt("completed_at", until)
        .order("completed_at", { ascending: false })
        .limit(DONE_TASKS_LIMIT);

      const [a, b, c, d] = await Promise.all([crmOpen, crmDone, ownerOpen, ownerDone]);
      for (const result of [a, b, c, d]) if (result?.error) throw result.error;

      const crm = [...(a?.data ?? []), ...(b?.data ?? [])].map((row): DashboardTask => ({
        id: row.id,
        origin: "crm",
        title: row.title,
        done: row.status === "done",
        dueAt: row.due_at,
        dueDay: null,
        completedAt: row.completed_at,
        createdAt: row.created_at,
        dealId: row.deal_id,
        contactId: row.contact_id,
      }));
      const owner = [...(c.data ?? []), ...(d.data ?? [])].map((row): DashboardTask => ({
        id: row.id,
        origin: "owner",
        title: row.title,
        done: row.status === "done",
        dueAt: null,
        dueDay: row.due_date,
        completedAt: row.completed_at,
        createdAt: row.created_at,
        dealId: null,
        contactId: null,
      }));
      return [...crm, ...owner];
    },
  });
}

/** Whether each deal is open, won or lost, by its stage (an unknown stage reads as open). */
export function dealKind(
  deal: Pick<WorkDeal, "stage_id">,
  stages: readonly { id: string; is_won: boolean; is_lost: boolean }[],
): "open" | "won" | "lost" {
  const stage = stages.find((item) => item.id === deal.stage_id);
  if (stage?.is_won) return "won";
  if (stage?.is_lost) return "lost";
  return "open";
}

export function toChartDeals(
  deals: readonly WorkDeal[],
  stages: readonly { id: string; is_won: boolean; is_lost: boolean }[],
): ChartDeal[] {
  return deals.map((deal) => ({
    id: deal.id,
    value: deal.value,
    currency: deal.currency,
    kind: dealKind(deal, stages),
    createdAt: deal.created_at,
    wonAt: deal.won_at,
    lostAt: deal.lost_at,
  }));
}
