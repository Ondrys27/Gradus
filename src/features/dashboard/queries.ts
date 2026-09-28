"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { dayRangeToInstants } from "@/features/calendar/calendar-logic";
import { useContactTables } from "@/features/contacts/queries";
import { contactName } from "@/features/contacts/types";
import { useFields } from "@/features/contacts/table-queries";
import { periodRange } from "@/features/finance/finance-logic";
import { milestoneKeys } from "@/features/milestones/queries";
import { createClient } from "@/lib/supabase/client";
import { todayIsoDate, type IsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import type { Database } from "@/types/database";
import { dueFollowUps, stalledCutoff, WIN_RATE_DAYS, type ClosedDeal } from "./dashboard-logic";
import { cleanAnswers, type SurveyAnswers } from "./survey-questions";

type TaskStatus = Database["public"]["Enums"]["task_status"];

/** Bounds; a day holds a handful of each, these only cap the query. */
const OPEN_TASK_LIMIT = 50;
const DONE_TASK_LIMIT = 100;
const FOLLOW_UP_LIMIT = 200;
const STALLED_LIMIT = 5;
const CLOSED_DEAL_LIMIT = 1000;
const OPEN_DEAL_LIMIT = 2000;
const NEW_CONTACT_LIMIT = 8;
const SURVEY_LIMIT = 50;
const INCOME_LIMIT = 5;

export const dashboardKeys = {
  all: (userId: string) => ["dashboard", userId] as const,
  tasks: (userId: string, today: IsoDate, timeZone: string) =>
    ["dashboard", userId, "tasks", today, timeZone] as const,
  followUps: (userId: string, tableId: string | null, fieldId: string | null) =>
    ["dashboard", userId, "follow-ups", tableId, fieldId] as const,
  stalled: (userId: string, day: IsoDate) => ["dashboard", userId, "stalled", day] as const,
  closedDeals: (userId: string, day: IsoDate) => ["dashboard", userId, "closed", day] as const,
  activeCount: (userId: string) => ["dashboard", userId, "active-count"] as const,
  activeByStage: (userId: string) => ["dashboard", userId, "active-by-stage"] as const,
  newContactCount: (userId: string, month: IsoDate, timeZone: string) =>
    ["dashboard", userId, "new-contacts", "count", month, timeZone] as const,
  newContacts: (userId: string, month: IsoDate, timeZone: string) =>
    ["dashboard", userId, "new-contacts", "list", month, timeZone] as const,
  income: (userId: string, month: IsoDate) => ["dashboard", userId, "income", month] as const,
  surveys: (userId: string) => ["dashboard", userId, "surveys"] as const,
};

/**
 * Dashboard numbers are read again every time the page opens; what was fetched
 * before still shows meanwhile, so coming back never flashes a loading state.
 */
const FRESH = { staleTime: 0 } as const;

/** Today in the user's zone and the instants that bound it. */
export function useToday() {
  const settings = useFormatSettings();
  const today = todayIsoDate(settings);
  const { timeZone } = settings;
  return useMemo(() => {
    const bounds = dayRangeToInstants(today, today, timeZone);
    return { today, timeZone, from: bounds.from, to: bounds.to };
  }, [today, timeZone]);
}

/** Bounds of the current calendar month as instants in the user's zone; `to` is exclusive. */
export function useMonthBounds() {
  const { today, timeZone } = useToday();
  return useMemo(() => {
    const { from, to } = periodRange("thisMonth", today);
    return {
      month: from,
      ...dayRangeToInstants(from, to, timeZone),
      range: { from, to },
    };
  }, [today, timeZone]);
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const TASK_COLUMNS = "id, title, due_date, status, completed_at, milestone_id";

export type DashTask = {
  id: string;
  title: string;
  due_date: string | null;
  status: TaskStatus;
  completed_at: string | null;
  milestone_id: string;
  milestoneTitle: string | null;
  /** Open direct subtasks; while there are any the task cannot be ticked. */
  openSubtasks: number;
};

export type TodayTasks = {
  /** Open tasks due today or earlier, most overdue first. */
  open: DashTask[];
  /** All open ones, which may be more than `open` shows. */
  openTotal: number;
  /** Tasks finished today. */
  done: DashTask[];
};

/** Tasks due today or overdue, and the ones finished today, in the user's zone. */
export function useTodayTasks() {
  const { user } = useSession();
  const { today, timeZone, from, to } = useToday();
  return useQuery({
    ...FRESH,
    queryKey: dashboardKeys.tasks(user.id, today, timeZone),
    queryFn: async (): Promise<TodayTasks> => {
      const supabase = createClient();
      const [open, done] = await Promise.all([
        supabase
          .from("tasks")
          .select(`${TASK_COLUMNS}, milestones!inner(title, status)`, { count: "exact" })
          .neq("status", "done")
          .lte("due_date", today)
          .eq("milestones.status", "active")
          .order("due_date")
          .order("position")
          .limit(OPEN_TASK_LIMIT),
        supabase
          .from("tasks")
          .select(`${TASK_COLUMNS}, milestones(title)`)
          .eq("status", "done")
          .gte("completed_at", from)
          .lt("completed_at", to)
          .order("completed_at", { ascending: false })
          .limit(DONE_TASK_LIMIT),
      ]);
      if (open.error) throw open.error;
      if (done.error) throw done.error;

      const remaining = new Map<string, number>();
      if (open.data.length) {
        const { data, error } = await supabase
          .from("tasks")
          .select("parent_task_id")
          .in(
            "parent_task_id",
            open.data.map((task) => task.id),
          )
          .neq("status", "done")
          .limit(1000);
        if (error) throw error;
        for (const row of data) {
          if (row.parent_task_id) {
            remaining.set(row.parent_task_id, (remaining.get(row.parent_task_id) ?? 0) + 1);
          }
        }
      }

      const toTask = (row: (typeof open.data)[number] | (typeof done.data)[number]): DashTask => {
        const { milestones, ...task } = row;
        return {
          ...task,
          milestoneTitle: milestones?.title ?? null,
          openSubtasks: remaining.get(row.id) ?? 0,
        };
      };
      return {
        open: open.data.map(toTask),
        openTotal: open.count ?? open.data.length,
        done: done.data.map(toTask),
      };
    },
  });
}

/** Ticks or unticks a task from the dashboard. The list changes at once and is read again after. */
export function useToggleDashTask() {
  const { user } = useSession();
  const { today, timeZone } = useToday();
  const queryClient = useQueryClient();
  const key = dashboardKeys.tasks(user.id, today, timeZone);
  return useMutation({
    mutationFn: async ({ task, done }: { task: DashTask; done: boolean }) => {
      const { error } = await createClient()
        .from("tasks")
        .update({ status: done ? "done" : "todo" })
        .eq("id", task.id);
      if (error) throw error;
    },
    onMutate: async ({ task, done }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TodayTasks>(key);
      if (previous) {
        queryClient.setQueryData<TodayTasks>(
          key,
          done
            ? {
                open: previous.open.filter((item) => item.id !== task.id),
                openTotal: Math.max(0, previous.openTotal - 1),
                done: [
                  { ...task, status: "done", completed_at: new Date().toISOString() },
                  ...previous.done,
                ],
              }
            : {
                // Back among the open ones only if it is still due; otherwise the read below decides.
                open: [{ ...task, status: "todo", completed_at: null }, ...previous.open],
                openTotal: previous.openTotal + 1,
                done: previous.done.filter((item) => item.id !== task.id),
              },
        );
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      // Milestone progress and the calendar's task items follow the tick.
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: milestoneKeys.all(user.id) });
      void queryClient.invalidateQueries({ queryKey: ["calendar", user.id] });
    },
  });
}

// ---------------------------------------------------------------------------
// Contacts to call back
// ---------------------------------------------------------------------------

const FOLLOW_UP_TABLE = "follow_up";
const FOLLOW_UP_FIELD = "follow_up_at";

export type FollowUp = {
  entryId: string;
  contactId: string;
  name: string;
  dueAt: Date;
};

/** Contacts in the "Follow up" table whose date has come, overdue ones too. */
export function useFollowUpsDue() {
  const { user } = useSession();
  const { to } = useToday();
  const tables = useContactTables();
  const fields = useFields();
  const tableId = tables.data?.find((table) => table.system_key === FOLLOW_UP_TABLE)?.id ?? null;
  const fieldId =
    fields.data?.find((field) => field.table_id === tableId && field.system_key === FOLLOW_UP_FIELD)
      ?.id ?? null;
  const ready = !tables.isPending && !fields.isPending;

  return useQuery({
    ...FRESH,
    queryKey: dashboardKeys.followUps(user.id, tableId, fieldId),
    enabled: ready,
    queryFn: async (): Promise<FollowUp[]> => {
      if (!tableId || !fieldId) return [];
      // The date is filtered in the database, so a long table never hides an overdue call.
      // Answers are UTC ISO strings, which compare in time order as text.
      const dueAt = `answers->>${fieldId}`;
      const { data, error } = await createClient()
        .from("contact_table_entries")
        .select("id, contact_id, answers, contact:contacts(company_name, first_name, last_name)")
        .eq("table_id", tableId)
        .lt(dueAt, to)
        .order(dueAt)
        .limit(FOLLOW_UP_LIMIT);
      if (error) throw error;
      return dueFollowUps(data, fieldId, new Date(to)).map((entry) => ({
        entryId: entry.id,
        contactId: entry.contact_id,
        name: entry.contact ? contactName(entry.contact) : "",
        dueAt: entry.dueAt,
      }));
    },
  });
}

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

export type StalledDeal = {
  id: string;
  title: string;
  stage_id: string;
  entered_stage_at: string;
};

/** Open deals standing in one stage longer than the limit, the longest first. */
export function useStalledDeals() {
  const { user } = useSession();
  const { today } = useToday();
  return useQuery({
    ...FRESH,
    queryKey: dashboardKeys.stalled(user.id, today),
    queryFn: async (): Promise<{ deals: StalledDeal[]; total: number }> => {
      const { data, error, count } = await createClient()
        .from("deals")
        .select("id, title, stage_id, entered_stage_at", { count: "exact" })
        .is("won_at", null)
        .is("lost_at", null)
        .lt("entered_stage_at", stalledCutoff(new Date()))
        .order("entered_stage_at")
        .limit(STALLED_LIMIT);
      if (error) throw error;
      return { deals: data, total: count ?? data.length };
    },
  });
}

/** Deals closed (won or lost) in the last 90 days: only the two dates that decide the rate. */
export function useClosedDeals() {
  const { user } = useSession();
  const { today } = useToday();
  return useQuery({
    ...FRESH,
    queryKey: dashboardKeys.closedDeals(user.id, today),
    queryFn: async (): Promise<ClosedDeal[]> => {
      const since = new Date(Date.now() - WIN_RATE_DAYS * 86_400_000).toISOString();
      const { data, error } = await createClient()
        .from("deals")
        .select("won_at, lost_at")
        .or(`won_at.gte.${since},lost_at.gte.${since}`)
        .limit(CLOSED_DEAL_LIMIT);
      if (error) throw error;
      return data;
    },
  });
}

export function useActiveDealCount() {
  const { user } = useSession();
  return useQuery({
    ...FRESH,
    queryKey: dashboardKeys.activeCount(user.id),
    queryFn: async (): Promise<number> => {
      const { count, error } = await createClient()
        .from("deals")
        .select("id", { count: "exact", head: true })
        .is("won_at", null)
        .is("lost_at", null);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/** Open deals per stage, for the detail of the tile. */
export function useActiveDealsByStage(enabled: boolean) {
  const { user } = useSession();
  return useQuery({
    ...FRESH,
    enabled,
    queryKey: dashboardKeys.activeByStage(user.id),
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await createClient()
        .from("deals")
        .select("stage_id")
        .is("won_at", null)
        .is("lost_at", null)
        .limit(OPEN_DEAL_LIMIT);
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const deal of data) counts.set(deal.stage_id, (counts.get(deal.stage_id) ?? 0) + 1);
      return counts;
    },
  });
}

// ---------------------------------------------------------------------------
// Contacts and income
// ---------------------------------------------------------------------------

export function useNewContactCount() {
  const { user } = useSession();
  const { month, from, to } = useMonthBounds();
  const { timeZone } = useToday();
  return useQuery({
    ...FRESH,
    queryKey: dashboardKeys.newContactCount(user.id, month, timeZone),
    queryFn: async (): Promise<number> => {
      const { count, error } = await createClient()
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .gte("created_at", from)
        .lt("created_at", to);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export type NewContact = {
  id: string;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
};

export function useNewContacts(enabled: boolean) {
  const { user } = useSession();
  const { month, from, to } = useMonthBounds();
  const { timeZone } = useToday();
  return useQuery({
    ...FRESH,
    enabled,
    queryKey: dashboardKeys.newContacts(user.id, month, timeZone),
    queryFn: async (): Promise<NewContact[]> => {
      const { data, error } = await createClient()
        .from("contacts")
        .select("id, company_name, first_name, last_name, created_at")
        .gte("created_at", from)
        .lt("created_at", to)
        .order("created_at", { ascending: false })
        .limit(NEW_CONTACT_LIMIT);
      if (error) throw error;
      return data;
    },
  });
}

export type IncomeRow = {
  id: string;
  amount: number;
  currency: string;
  description: string | null;
  category: string | null;
  occurred_on: string;
};

/** The latest income of the month, for the detail of the tile. */
export function useRecentIncome(enabled: boolean) {
  const { user } = useSession();
  const { month, range } = useMonthBounds();
  return useQuery({
    enabled,
    queryKey: dashboardKeys.income(user.id, month),
    queryFn: async (): Promise<IncomeRow[]> => {
      const { data, error } = await createClient()
        .from("transactions")
        .select("id, amount, currency, description, category, occurred_on")
        .eq("type", "income")
        .gte("occurred_on", range.from)
        .lte("occurred_on", range.to)
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(INCOME_LIMIT);
      if (error) throw error;
      return data.map((row) => ({ ...row, amount: Number(row.amount) }));
    },
  });
}

// ---------------------------------------------------------------------------
// Meeting surveys
// ---------------------------------------------------------------------------

export type MeetingSurvey = {
  id: string;
  deal_id: string;
  created_at: string;
  answers: SurveyAnswers;
  dealTitle: string | null;
  stageName: string | null;
};

export function useMeetingSurveys(enabled: boolean) {
  const { user } = useSession();
  return useQuery({
    ...FRESH,
    enabled,
    queryKey: dashboardKeys.surveys(user.id),
    queryFn: async (): Promise<MeetingSurvey[]> => {
      const { data, error } = await createClient()
        .from("meeting_surveys")
        .select("id, deal_id, created_at, answers, deal:deals(title), stage:pipeline_stages(name)")
        .order("created_at", { ascending: false })
        .limit(SURVEY_LIMIT);
      if (error) throw error;
      return data.map((row) => ({
        id: row.id,
        deal_id: row.deal_id,
        created_at: row.created_at,
        answers: cleanAnswers(row.answers),
        dealTitle: row.deal?.title ?? null,
        stageName: row.stage?.name ?? null,
      }));
    },
  });
}

export function useSaveMeetingSurvey() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      dealId: string;
      stageId: string | null;
      answers: SurveyAnswers;
    }) => {
      const { error } = await createClient().from("meeting_surveys").insert({
        user_id: user.id,
        deal_id: input.dealId,
        stage_id: input.stageId,
        answers: input.answers,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dashboardKeys.surveys(user.id) }),
  });
}
