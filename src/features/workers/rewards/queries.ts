"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSession } from "@/features/account/queries";
import { useWorkspace, useWorkspaceId } from "@/features/account/workspace-queries";
import { crmTaskKeys } from "@/features/crm-tasks/queries";
import { milestoneKeys } from "@/features/milestones/queries";
import { track } from "@/lib/analytics/client";
import { zonedWallClockToInstant, type IsoDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useFormatSettings } from "@/lib/use-format-settings";
import { grantAllows } from "../permissions-catalog";
import { workerKeys } from "../queries";
import { normalizeRule, parseRule, type RewardTemplate, type RuleInput } from "./rules";
import { monthBounds, totalsFromRows } from "./summary";
import {
  ENTRY_COLUMNS,
  PAYOUT_COLUMNS,
  PLAN_COLUMNS,
  RULE_COLUMNS,
  type Approval,
  type EntryStatus,
  type PricedSource,
  type RewardEntry,
  type RewardPayout,
  type RewardPlan,
  type RewardTotals,
} from "./types";

/**
 * Reward plans, entries and payouts, read with the user's own client: row
 * level security keeps it to the person's own rewards and to the people whose
 * rewards they manage. Every write of an entry goes through a database
 * function; plans and rules are written through row level security.
 */

const PLANS_LIMIT = 500;
const ENTRIES_LIMIT = 1000;
export const PAYOUTS_PAGE = 20;

export const rewardKeys = {
  all: (userId: string, space: string) => ["rewards", userId, space] as const,
  plans: (userId: string, space: string) => [...rewardKeys.all(userId, space), "plans"] as const,
  totals: (userId: string, space: string, workerId: string | null, from: string) =>
    [...rewardKeys.all(userId, space), "totals", workerId, from] as const,
  entries: (userId: string, space: string, workerId: string, from: string, until: string) =>
    [...rewardKeys.all(userId, space), "entries", workerId, from, until] as const,
  approved: (userId: string, space: string) => [...rewardKeys.all(userId, space), "open"] as const,
  payouts: (userId: string, space: string, workerId: string | null, page: number) =>
    [...rewardKeys.all(userId, space), "payouts", workerId, page] as const,
};

function useKeys() {
  const { user } = useSession();
  const space = useWorkspaceId();
  return { userId: user.id, space };
}

/** After any change: the rewards, the people's cards and the tasks that show a price. */
function useRefresh() {
  const { userId, space } = useKeys();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: rewardKeys.all(userId, space) }),
      queryClient.invalidateQueries({ queryKey: workerKeys.all(userId) }),
    ]);
}

function toEntry(row: Record<string, unknown>): RewardEntry {
  return { ...(row as unknown as RewardEntry), amount: Number(row.amount) };
}

function toPayout(row: Record<string, unknown>): RewardPayout {
  return { ...(row as unknown as RewardPayout), total: Number(row.total) };
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/** Every plan the viewer may read in the active space, by worker. */
export function useRewardPlans() {
  const { userId, space } = useKeys();
  return useQuery({
    queryKey: rewardKeys.plans(userId, space),
    queryFn: async (): Promise<Map<string, RewardPlan>> => {
      const { data, error } = await createClient()
        .from("reward_plans")
        .select(`${PLAN_COLUMNS}, rules:reward_plan_rules(${RULE_COLUMNS})`)
        .eq("space_id", space)
        .limit(PLANS_LIMIT);
      if (error) throw error;
      return new Map(
        data.map((row) => {
          const rules = (row.rules ?? [])
            .flatMap((rule) => {
              const parsed = parseRule(rule);
              return parsed ? [parsed] : [];
            })
            .sort((a, b) => a.position - b.position);
          const plan: RewardPlan = {
            id: row.id,
            space_id: row.space_id,
            worker_id: row.worker_id,
            name: row.name,
            approval: row.approval === "auto" ? "auto" : "manual",
            currency: row.currency,
            active_from: row.active_from,
            active_to: row.active_to,
            notes: row.notes,
            rules,
          };
          return [row.worker_id, plan] as const;
        }),
      );
    },
  });
}

export function useRewardPlan(workerId: string | null) {
  const plans = useRewardPlans();
  return { ...plans, data: workerId ? (plans.data?.get(workerId) ?? null) : null };
}

/** A plan for a person, empty or from a template's rules. */
export function useCreatePlan() {
  const space = useWorkspaceId();
  const settings = useFormatSettings();
  const t = useTranslations("workers.rewardPlan");
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (input: {
      workerId: string;
      approval?: Approval;
      currency?: string;
      template?: RewardTemplate;
      rules?: RuleInput[];
    }) => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("reward_plans")
        .insert({
          space_id: space,
          worker_id: input.workerId,
          name: t("defaultName"),
          approval: input.approval ?? "manual",
          currency: input.currency ?? settings.currency,
        })
        .select("id")
        .single();
      if (error) throw error;
      const rules = (input.rules ?? []).map(normalizeRule);
      if (rules.length > 0) {
        const { error: rulesError } = await supabase.from("reward_plan_rules").insert(
          rules.map((rule, position) => ({
            ...rule,
            plan_id: data.id,
            space_id: space,
            worker_id: input.workerId,
            position,
          })),
        );
        if (rulesError) {
          await supabase.from("reward_plans").delete().eq("id", data.id);
          throw rulesError;
        }
      }
      track("reward_plan_created", { template: input.template ?? "none", rules: rules.length });
      return data.id;
    },
    onSettled: refresh,
  });
}

export function useUpdatePlan() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (input: {
      planId: string;
      patch: Partial<Pick<RewardPlan, "approval" | "active_from" | "active_to" | "notes" | "name" | "currency">>;
    }) => {
      const { error } = await createClient()
        .from("reward_plans")
        .update(input.patch)
        .eq("id", input.planId);
      if (error) throw error;
      const field =
        "approval" in input.patch
          ? "approval"
          : "notes" in input.patch
            ? "notes"
            : "name" in input.patch
              ? "name"
              : "currency" in input.patch
                ? "currency"
                : "dates";
      track("reward_plan_updated", {
        field,
        ...(input.patch.approval ? { approval: input.patch.approval } : {}),
      });
    },
    onSettled: refresh,
  });
}

/** A new rule at the end of the plan, or a changed one. */
export function useSaveRule() {
  const space = useWorkspaceId();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (input: {
      plan: Pick<RewardPlan, "id" | "worker_id" | "rules">;
      ruleId: string | null;
      rule: RuleInput;
      active?: boolean;
    }) => {
      const rule = normalizeRule(input.rule);
      const supabase = createClient();
      const active = input.active ?? true;
      if (input.ruleId) {
        const { error } = await supabase
          .from("reward_plan_rules")
          .update({ ...rule, active })
          .eq("id", input.ruleId);
        if (error) throw error;
      } else {
        const position = input.plan.rules.reduce((max, item) => Math.max(max, item.position + 1), 0);
        const { error } = await supabase.from("reward_plan_rules").insert({
          ...rule,
          active,
          plan_id: input.plan.id,
          space_id: space,
          worker_id: input.plan.worker_id,
          position,
        });
        if (error) throw error;
      }
      track("reward_rule_saved", {
        kind: rule.kind,
        created: !input.ruleId,
        capped: rule.cap_per_period !== null,
        filtered: Object.keys(rule.filter).length > 0,
        active,
      });
    },
    onSettled: refresh,
  });
}

export function useDeleteRule() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (rule: { id: string; kind: RuleInput["kind"] }) => {
      const { error } = await createClient().from("reward_plan_rules").delete().eq("id", rule.id);
      if (error) throw error;
      track("reward_rule_deleted", { kind: rule.kind });
    },
    onSettled: refresh,
  });
}

/** A template's rules added to an existing plan (the owner saw and changed them first). */
export function useAddTemplateRules() {
  const space = useWorkspaceId();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (input: {
      plan: Pick<RewardPlan, "id" | "worker_id" | "rules">;
      template: RewardTemplate;
      rules: RuleInput[];
    }) => {
      const start = input.plan.rules.reduce((max, item) => Math.max(max, item.position + 1), 0);
      const { error } = await createClient()
        .from("reward_plan_rules")
        .insert(
          input.rules.map(normalizeRule).map((rule, index) => ({
            ...rule,
            plan_id: input.plan.id,
            space_id: space,
            worker_id: input.plan.worker_id,
            position: start + index,
          })),
        );
      if (error) throw error;
      track("reward_template_applied", { template: input.template, rules: input.rules.length });
    },
    onSettled: refresh,
  });
}

// ---------------------------------------------------------------------------
// Totals, entries, payouts
// ---------------------------------------------------------------------------

/** This month's earnings and what waits, per person and currency (one person or everyone). */
export function useRewardTotals(workerId: string | null, enabled = true) {
  const { userId, space } = useKeys();
  const settings = useFormatSettings();
  const { from, until } = monthBounds(settings);
  return useQuery({
    queryKey: rewardKeys.totals(userId, space, workerId, from),
    enabled,
    queryFn: async (): Promise<RewardTotals[]> => {
      const { data, error } = await createClient().rpc("reward_totals", {
        _from: from,
        _until: until,
        ...(workerId ? { _worker_id: workerId } : {}),
      });
      if (error) throw error;
      return totalsFromRows(data);
    },
  });
}

/**
 * A person's entries that occurred in the range, and every one still open
 * (planned, waiting, approved) whenever it occurred.
 */
export function useRewardEntries(workerId: string, range: { from: string; until: string }) {
  const { userId, space } = useKeys();
  return useQuery({
    queryKey: rewardKeys.entries(userId, space, workerId, range.from, range.until),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<RewardEntry[]> => {
      const { data, error } = await createClient()
        .from("reward_entries")
        .select(ENTRY_COLUMNS)
        .eq("worker_id", workerId)
        .or(
          `and(occurred_at.gte.${range.from},occurred_at.lt.${range.until}),status.in.(planned,pending,approved)`,
        )
        .order("occurred_at", { ascending: false })
        .limit(ENTRIES_LIMIT);
      if (error) throw error;
      return data.map((row) => toEntry(row));
    },
  });
}

/**
 * Everything waiting for approval or for the payout in the space, of the
 * people the viewer manages (their own aside): the company's bulk actions.
 */
export function useOpenEntries(enabled = true) {
  const { userId, space } = useKeys();
  return useQuery({
    queryKey: rewardKeys.approved(userId, space),
    enabled,
    queryFn: async (): Promise<RewardEntry[]> => {
      const { data, error } = await createClient()
        .from("reward_entries")
        .select(ENTRY_COLUMNS)
        .eq("space_id", space)
        .in("status", ["pending", "approved"])
        .order("occurred_at")
        .limit(ENTRIES_LIMIT * 2);
      if (error) throw error;
      return data.map((row) => toEntry(row));
    },
  });
}

/** Payouts, newest first: one person's or everyone's the viewer may read. */
export function useRewardPayouts(workerId: string | null, page: number) {
  const { userId, space } = useKeys();
  return useQuery({
    queryKey: rewardKeys.payouts(userId, space, workerId, page),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ rows: RewardPayout[]; total: number }> => {
      let query = createClient()
        .from("reward_payouts")
        .select(PAYOUT_COLUMNS, { count: "exact" })
        .eq("space_id", space)
        .order("paid_at", { ascending: false })
        .range(page * PAYOUTS_PAGE, page * PAYOUTS_PAGE + PAYOUTS_PAGE - 1);
      if (workerId) query = query.eq("worker_id", workerId);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data.map((row) => toPayout(row)), total: count ?? data.length };
    },
  });
}

/** Every payout for the CSV file (a thousand at most), newest first. */
export async function loadAllPayouts(space: string, workerId: string | null): Promise<RewardPayout[]> {
  let query = createClient()
    .from("reward_payouts")
    .select(PAYOUT_COLUMNS)
    .eq("space_id", space)
    .order("paid_at", { ascending: false })
    .limit(1000);
  if (workerId) query = query.eq("worker_id", workerId);
  const { data, error } = await query;
  if (error) throw error;
  return data.map((row) => toPayout(row));
}

export type ReviewAction = "approve" | "reject" | "pending";

export function useReviewEntries(from: "worker" | "company") {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (input: { ids: string[]; action: ReviewAction }) => {
      if (input.ids.length === 0) return 0;
      const { data, error } = await createClient().rpc("reward_review", {
        _ids: input.ids,
        _action: input.action,
      });
      if (error) throw error;
      track("reward_entries_reviewed", { action: input.action, count: input.ids.length, from });
      return data;
    },
    onSettled: refresh,
  });
}

export function useEditEntry() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (input: { id: string; amount: number; note: string }) => {
      const { error } = await createClient().rpc("reward_entry_update", {
        _id: input.id,
        _amount: input.amount,
        _note: input.note,
      });
      if (error) throw error;
      track("reward_entry_edited", {});
    },
    onSettled: refresh,
  });
}

export type ManualRewardInput = {
  workerId: string;
  amount: number;
  currency: string;
  occurredOn: IsoDate;
  note: string;
  link: { kind: Exclude<PricedSource, never>; id: string } | null;
};

export function useAddManualReward() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (input: ManualRewardInput) => {
      const { error } = await createClient().rpc("reward_add_manual", {
        _worker_id: input.workerId,
        _amount: input.amount,
        _currency: input.currency,
        _occurred_on: input.occurredOn,
        _note: input.note,
        ...(input.link ? { _source_kind: input.link.kind, _source_id: input.link.id } : {}),
      });
      if (error) throw error;
      track("reward_manual_added", {
        deduction: input.amount < 0,
        ...(input.link ? { linked: input.link.kind } : {}),
      });
    },
    onSettled: refresh,
  });
}

/** Approved entries of one person and currency become a payout and an expense in Finance. */
export function useCreatePayout(from: "worker" | "company") {
  const refresh = useRefresh();
  const tCategory = useTranslations("finance.categories");
  const { userId } = useKeys();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { workerId: string; entryIds: string[]; paidOn: IsoDate; note: string }) => {
      const { data, error } = await createClient().rpc("reward_payout_create", {
        _worker_id: input.workerId,
        _entry_ids: input.entryIds,
        _paid_on: input.paidOn,
        _note: input.note.trim(),
        _row_label: tCategory("rewards"),
      });
      if (error) throw error;
      track("reward_payout_recorded", { entries: input.entryIds.length, from });
      return data;
    },
    onSettled: async () => {
      await refresh();
      // The expense is in Finance now.
      await queryClient.invalidateQueries({ queryKey: ["finance", userId] });
    },
  });
}

/** The price of a task, deal or milestone (null = none); a milestone also says whose it is. */
export function useSetRewardPrice() {
  const { userId } = useKeys();
  const refresh = useRefresh();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      source: PricedSource;
      id: string;
      amount: number | null;
      currency: string;
      workerId?: string | null;
      fromDefault?: boolean;
    }) => {
      const { error } = await createClient().rpc("reward_set_price", {
        _source_kind: input.source,
        _source_id: input.id,
        _amount: input.amount,
        _currency: input.amount === null ? null : input.currency,
        ...(input.source === "milestone" ? { _worker_id: input.workerId ?? null } : {}),
      });
      if (error) throw error;
      track("reward_price_set", {
        source: input.source,
        cleared: input.amount === null,
        from_default: Boolean(input.fromDefault),
      });
    },
    onSettled: async () => {
      await refresh();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: crmTaskKeys.all(userId) }),
        queryClient.invalidateQueries({ queryKey: milestoneKeys.all(userId) }),
        queryClient.invalidateQueries({ queryKey: ["pipeline", userId] }),
      ]);
    },
  });
}

/** Noon of a day in the user's zone, for a date picked in a form. */
export function useNoonOf() {
  const { timeZone } = useFormatSettings();
  return (day: IsoDate) => zonedWallClockToInstant(day, "12:00", timeZone).toISOString();
}

/**
 * Whether the viewer manages rewards in the active space at all (the owner, or
 * "company: rewards"); also in read-only mode, where they still see them.
 */
export function useManagesRewards(): boolean {
  const workspace = useWorkspace();
  return workspace.role === "owner" || grantAllows(workspace.grants, "company", "rewards");
}

export type { EntryStatus };
