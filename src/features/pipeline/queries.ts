"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { invalidateFinance } from "@/features/finance/queries";
import { createClient } from "@/lib/supabase/client";
import { applyMove, nextDealPosition, reorderStages, sortStages } from "./board-logic";
import type { DealInput, StageInput } from "./schemas";
import {
  DEAL_ACTIVITY_COLUMNS,
  DEAL_COLUMNS,
  STAGE_COLUMNS,
  type Deal,
  type DealActivity,
  type DealContact,
  type Stage,
} from "./types";

/**
 * Open deals are all loaded (this only bounds the query); closed ones pile up over the
 * years, so only the latest of them fill the won and lost columns.
 */
const OPEN_DEAL_LIMIT = 1000;
const CLOSED_DEAL_LIMIT = 500;
const STAGE_LIMIT = 50;
const CONTACT_SUGGESTIONS = 8;
const DEAL_ACTIVITY_LIMIT = 200;

/**
 * A deal won or un-won moves its contact in or out of Clients, and deals show in
 * the contact detail; the contact screens read again when next shown.
 */
function invalidateContacts(queryClient: ReturnType<typeof useQueryClient>, userId: string) {
  return queryClient.invalidateQueries({ queryKey: ["contacts", userId] });
}

export const pipelineKeys = {
  stages: (userId: string) => ["pipeline", userId, "stages"] as const,
  deals: (userId: string) => ["pipeline", userId, "deals"] as const,
  contacts: (userId: string, term: string) => ["pipeline", userId, "contacts", term] as const,
  dealActivities: (userId: string, dealId: string) =>
    ["pipeline", userId, "deal-activities", dealId] as const,
};

export function useStages() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: pipelineKeys.stages(user.id),
    queryFn: async (): Promise<Stage[]> => {
      const { data, error } = await createClient()
        .from("pipeline_stages")
        .select(STAGE_COLUMNS)
        .eq("user_id", workspaceId)
        .order("position")
        .limit(STAGE_LIMIT);
      if (error) throw error;
      return data;
    },
  });
}

export function useDeals() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: pipelineKeys.deals(user.id),
    queryFn: async (): Promise<Deal[]> => {
      const supabase = createClient();
      // Separate reads, so old won and lost deals never push an open one off the board.
      const [open, closed] = await Promise.all([
        supabase
          .from("deals")
          .select(DEAL_COLUMNS)
          .eq("user_id", workspaceId)
          .is("won_at", null)
          .is("lost_at", null)
          .order("created_at", { ascending: false })
          .limit(OPEN_DEAL_LIMIT),
        supabase
          .from("deals")
          .select(DEAL_COLUMNS)
          .eq("user_id", workspaceId)
          .or("won_at.not.is.null,lost_at.not.is.null")
          .order("created_at", { ascending: false })
          .limit(CLOSED_DEAL_LIMIT),
      ]);
      if (open.error) throw open.error;
      if (closed.error) throw closed.error;
      return [...open.data, ...closed.data].sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      );
    },
  });
}

/** A deal's own communication history (e.g. e-mails sent from its detail), newest first. */
export function useDealActivities(dealId: string) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: pipelineKeys.dealActivities(user.id, dealId),
    queryFn: async (): Promise<DealActivity[]> => {
      const { data, error } = await createClient()
        .from("contact_activities")
        .select(DEAL_ACTIVITY_COLUMNS)
        .eq("user_id", workspaceId)
        .eq("deal_id", dealId)
        .order("occurred_at", { ascending: false })
        .limit(DEAL_ACTIVITY_LIMIT);
      if (error) throw error;
      return data;
    },
  });
}

function toDealRow(input: DealInput) {
  return {
    title: input.title,
    contact_id: input.contact_id,
    value: input.value,
    currency: input.currency,
    expected_close_date: input.expected_close_date,
    description: input.description || null,
  };
}

/** New deals start last in their stage. The database stamps entered_stage_at and won_at. */
export function useCreateDeal() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DealInput) => {
      const deals = queryClient.getQueryData<Deal[]>(pipelineKeys.deals(user.id)) ?? [];
      const { data, error } = await createClient()
        .from("deals")
        .insert({
          ...toDealRow(input),
          user_id: workspaceId,
          stage_id: input.stage_id,
          position: nextDealPosition(deals, input.stage_id),
        })
        .select(DEAL_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      queryClient.setQueryData<Deal[]>(pipelineKeys.deals(user.id), (deals) =>
        deals ? [row, ...deals] : deals,
      );
      void invalidateContacts(queryClient, user.id);
      // A deal created straight into a deposit or won stage books income.
      void invalidateFinance(queryClient, user.id);
    },
  });
}

/** Edits everything but the stage; the stage only changes through `useMoveDeal`. */
export function useUpdateDeal(id: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DealInput) => {
      const { data, error } = await createClient()
        .from("deals")
        .update({ ...toDealRow(input), lost_reason: input.lost_reason || null })
        .eq("id", id)
        .select(DEAL_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      queryClient.setQueryData<Deal[]>(pipelineKeys.deals(user.id), (deals) =>
        deals?.map((deal) => (deal.id === row.id ? row : deal)),
      );
      void invalidateContacts(queryClient, user.id);
    },
  });
}

export function useDeleteDeal() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await createClient().from("deals").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData<Deal[]>(pipelineKeys.deals(user.id), (deals) =>
        deals?.filter((deal) => deal.id !== id),
      );
      void invalidateContacts(queryClient, user.id);
    },
  });
}

export type MoveVariables = { deal: Deal; stage: Stage; lostReason?: string };

/**
 * A stage change. The database restamps entered_stage_at, sets won_at / lost_at and, for a
 * won deal, puts the contact into Clients, so the list is read again once it is saved.
 */
export function useMoveDeal() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const key = pipelineKeys.deals(user.id);
  return useMutation({
    mutationFn: async ({ deal, stage, lostReason }: MoveVariables) => {
      const deals = queryClient.getQueryData<Deal[]>(key) ?? [];
      const { error } = await createClient()
        .from("deals")
        .update({
          stage_id: stage.id,
          position: nextDealPosition(deals, stage.id),
          lost_reason: stage.is_lost && lostReason ? lostReason : null,
        })
        .eq("id", deal.id);
      if (error) throw error;
    },
    onMutate: async ({ deal, stage, lostReason }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Deal[]>(key);
      if (previous) {
        const moved = applyMove(previous, deal.id, stage, new Date());
        queryClient.setQueryData<Deal[]>(
          key,
          moved.map((item) =>
            item.id === deal.id && stage.is_lost
              ? { ...item, lost_reason: lostReason || null }
              : item,
          ),
        );
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: ["pipeline", "move"] }) > 1) return;
      void queryClient.invalidateQueries({ queryKey: key });
      void invalidateContacts(queryClient, user.id);
      // The database books a deposit or the rest of the deal, or flags what it booked.
      void invalidateFinance(queryClient, user.id);
      // A won deal is one of Jarvis's instant triggers.
      void queryClient.invalidateQueries({ queryKey: ["jarvis", user.id, "suggestions"] });
    },
    mutationKey: ["pipeline", "move"],
  });
}

export function useCreateStage() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: StageInput) => {
      const stages = queryClient.getQueryData<Stage[]>(pipelineKeys.stages(user.id)) ?? [];
      const position = stages.length ? Math.max(...stages.map((stage) => stage.position)) + 1 : 0;
      const { data, error } = await createClient()
        .from("pipeline_stages")
        .insert({
          user_id: workspaceId,
          name: input.name,
          color: input.color,
          is_won: input.kind === "won",
          is_lost: input.kind === "lost",
          position,
        })
        .select(STAGE_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      queryClient.setQueryData<Stage[]>(pipelineKeys.stages(user.id), (stages) =>
        stages ? sortStages([...stages, row]) : stages,
      );
    },
  });
}

export function useRenameStage() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await createClient().from("pipeline_stages").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_result, { id, name }) => {
      queryClient.setQueryData<Stage[]>(pipelineKeys.stages(user.id), (stages) =>
        stages?.map((stage) => (stage.id === id ? { ...stage, name } : stage)),
      );
    },
  });
}

/**
 * Marks the stage whose deals book a deposit (or, with null, none), and what share
 * of the deal value it is. Only one stage carries the mark; the database moves it.
 */
export function useSetDepositStage() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ stageId, percent }: { stageId: string | null; percent: number }) => {
      const { error } = await createClient().rpc("set_deposit_stage", {
        // The function takes null to clear the mark; the generated type knows only the uuid.
        _stage_id: stageId as string,
        _percent: percent,
      });
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: pipelineKeys.stages(user.id) }),
  });
}

/** Saves only the positions that changed; the board already shows the new order. */
export function useReorderStages() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const key = pipelineKeys.stages(user.id);
  return useMutation({
    mutationFn: async ({
      changes,
    }: {
      activeId: string;
      overId: string;
      changes: { id: string; position: number }[];
    }) => {
      const results = await Promise.all(
        changes.map(({ id, position }) =>
          createClient().from("pipeline_stages").update({ position }).eq("id", id),
        ),
      );
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
    },
    onMutate: async ({ activeId, overId }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Stage[]>(key);
      if (previous) queryClient.setQueryData(key, reorderStages(previous, activeId, overId).stages);
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** Deals of the stage move to `moveTo` inside the database function, then the stage goes. */
export function useRemoveStage() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, moveTo }: { id: string; moveTo: string | null }) => {
      const { error } = await createClient().rpc("remove_stage", {
        _stage_id: id,
        _move_to: moveTo ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: pipelineKeys.stages(user.id) }),
        queryClient.invalidateQueries({ queryKey: pipelineKeys.deals(user.id) }),
        invalidateContacts(queryClient, user.id),
      ]),
  });
}

/** Characters that mean something inside a PostgREST filter or an ILIKE pattern. */
function cleanTerm(term: string) {
  return term.replace(/[%_,()*\\"]/g, " ").trim();
}

export function useContactSearch(term: string) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const clean = cleanTerm(term);
  return useQuery({
    queryKey: pipelineKeys.contacts(user.id, clean),
    enabled: clean.length > 0,
    queryFn: async (): Promise<DealContact[]> => {
      const pattern = `%${clean}%`;
      const { data, error } = await createClient()
        .from("contacts")
        .select("id, company_name, first_name, last_name")
        .eq("user_id", workspaceId)
        .or(`company_name.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern}`)
        .order("company_name")
        .limit(CONTACT_SUGGESTIONS);
      if (error) throw error;
      return data;
    },
  });
}

/** Quick creation from the deal form: a company name, nothing else. */
export function useCreateContact() {
  const workspaceId = useWorkspaceId();
  return useMutation({
    mutationFn: async (name: string): Promise<DealContact> => {
      const { data, error } = await createClient()
        .from("contacts")
        .insert({ user_id: workspaceId, company_name: name.trim() })
        .select("id, company_name, first_name, last_name")
        .single();
      if (error) throw error;
      return data;
    },
  });
}
