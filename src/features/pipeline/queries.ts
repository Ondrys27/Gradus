"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { invalidateFinance } from "@/features/finance/queries";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import { applyMove, nextDealPosition, reorderStages, sortStages } from "./board-logic";
import {
  dealPatchSchema,
  type DealInput,
  type DealPatch,
  type DealPatchField,
  type StageInput,
} from "./schemas";
import {
  DEAL_ACTIVITY_COLUMNS,
  DEAL_COLUMNS,
  DEAL_CONTACT_COLUMNS,
  DEAL_EVENT_COLUMNS,
  DEAL_INVOICE_COLUMNS,
  DEAL_MEETING_COLUMNS,
  STAGE_COLUMNS,
  type Deal,
  type DealActivity,
  type DealContact,
  type DealContactLink,
  type DealEventRow,
  type DealInvoice,
  type DealMeeting,
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
/** A deal has a handful of contacts and a few dozen changes; these only bound the reads. */
const DEAL_CONTACT_LIMIT = 50;
const DEAL_EVENT_LIMIT = 200;
const DEAL_MEETING_LIMIT = 100;
const DEAL_INVOICE_LIMIT = 50;

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
  /** Everything the detail of one deal reads besides the deal itself. */
  deal: (userId: string, dealId: string) => ["pipeline", userId, "deal", dealId] as const,
  dealContacts: (userId: string, dealId: string) =>
    ["pipeline", userId, "deal", dealId, "contacts"] as const,
  dealEvents: (userId: string, dealId: string) =>
    ["pipeline", userId, "deal", dealId, "events"] as const,
  dealMeetings: (userId: string, dealId: string) =>
    ["pipeline", userId, "deal", dealId, "meetings"] as const,
  dealInvoices: (userId: string, dealId: string) =>
    ["pipeline", userId, "deal", dealId, "invoices"] as const,
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
      track("deal_created", {
        currency: row.currency,
        ...(row.value !== null ? { value: row.value } : {}),
        has_contact: row.contact_id !== null,
      });
      // Created straight into a won stage is a win too.
      const stage = queryClient
        .getQueryData<Stage[]>(pipelineKeys.stages(user.id))
        ?.find((item) => item.id === row.stage_id);
      if (stage?.is_won) {
        track("deal_won", {
          currency: row.currency,
          ...(row.value !== null ? { value: row.value } : {}),
          days_open: 0,
        });
      }
      queryClient.setQueryData<Deal[]>(pipelineKeys.deals(user.id), (deals) =>
        deals ? [row, ...deals] : deals,
      );
      void invalidateContacts(queryClient, user.id);
      // A deal created straight into a deposit or won stage books income.
      void invalidateFinance(queryClient, user.id);
    },
  });
}

/**
 * Saves one change from the deal detail (a field at a time). The stage only
 * changes through `useMoveDeal`, the contacts through the deal's contacts.
 * The database logs the change for the history and moves the last activity;
 * a delivery date also moves its calendar event.
 */
export function usePatchDeal(id: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: DealPatch) => {
      const clean = dealPatchSchema.parse(patch);
      // An emptied text is no text.
      const row = {
        ...clean,
        ...(clean.description !== undefined ? { description: clean.description || null } : {}),
        ...(clean.lost_reason !== undefined ? { lost_reason: clean.lost_reason || null } : {}),
      };
      const { data, error } = await createClient()
        .from("deals")
        .update(row)
        .eq("id", id)
        .select(DEAL_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row, patch) => {
      for (const field of Object.keys(patch) as DealPatchField[]) {
        track("deal_updated", { field });
      }
      queryClient.setQueryData<Deal[]>(pipelineKeys.deals(user.id), (deals) =>
        deals?.map((deal) => (deal.id === row.id ? row : deal)),
      );
      void queryClient.invalidateQueries({ queryKey: pipelineKeys.deal(user.id, id) });
      if ("deadline_date" in patch || "title" in patch) {
        void queryClient.invalidateQueries({ queryKey: ["calendar", user.id] });
      }
      if ("title" in patch) void invalidateContacts(queryClient, user.id);
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
      track("deal_deleted", {});
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
      trackMove(
        deal,
        stage,
        lostReason,
        queryClient.getQueryData<Stage[]>(pipelineKeys.stages(user.id)),
      );
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

/** A stage change as analytics sees it: positions and times, plus a win or a loss with its value. */
function trackMove(deal: Deal, stage: Stage, lostReason: string | undefined, stages?: Stage[]) {
  const now = Date.now();
  const from = stages?.find((item) => item.id === deal.stage_id);
  const value = deal.value !== null ? { value: deal.value } : {};
  track("deal_moved", {
    from_position: Math.max(0, from?.position ?? 0),
    to_position: Math.max(0, stage.position),
    hours_in_stage: Math.max(
      0,
      Math.floor((now - new Date(deal.entered_stage_at).getTime()) / 3_600_000),
    ),
    to_won: stage.is_won,
    to_lost: stage.is_lost,
  });
  if (stage.is_won && !from?.is_won) {
    track("deal_won", {
      currency: deal.currency,
      ...value,
      days_open: Math.max(0, Math.floor((now - new Date(deal.created_at).getTime()) / 86_400_000)),
    });
  } else if (stage.is_lost && !from?.is_lost) {
    track("deal_lost", { currency: deal.currency, ...value, has_reason: Boolean(lostReason) });
  }
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
      track("pipeline_stage_edited", { action: "create" });
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
      track("pipeline_stage_edited", { action: "rename" });
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
      track("pipeline_stage_edited", { action: "deposit" });
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
      track("pipeline_stage_edited", { action: "reorder" });
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
      track("pipeline_stage_edited", { action: "remove" });
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: pipelineKeys.stages(user.id) }),
        queryClient.invalidateQueries({ queryKey: pipelineKeys.deals(user.id) }),
        invalidateContacts(queryClient, user.id),
      ]),
  });
}

// --- The deal detail ----------------------------------------------------------

/** The deal's contacts, the primary one first, then in the order they were added. */
export function useDealContacts(dealId: string) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: pipelineKeys.dealContacts(user.id, dealId),
    queryFn: async (): Promise<DealContactLink[]> => {
      const { data, error } = await createClient()
        .from("deal_contacts")
        .select(DEAL_CONTACT_COLUMNS)
        .eq("user_id", workspaceId)
        .eq("deal_id", dealId)
        .order("is_primary", { ascending: false })
        .order("position")
        .limit(DEAL_CONTACT_LIMIT);
      if (error) throw error;
      return data;
    },
  });
}

/** What the database logged about the deal (stage, value, Close Date), newest first. */
export function useDealEvents(dealId: string) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: pipelineKeys.dealEvents(user.id, dealId),
    queryFn: async (): Promise<DealEventRow[]> => {
      const { data, error } = await createClient()
        .from("deal_events")
        .select(DEAL_EVENT_COLUMNS)
        .eq("user_id", workspaceId)
        .eq("deal_id", dealId)
        .order("occurred_at", { ascending: false })
        .limit(DEAL_EVENT_LIMIT);
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Meetings and other appointments linked to the deal, without its own
 * deadline event. Empty for an account that may not see the calendar.
 */
export function useDealMeetings(dealId: string, enabled: boolean) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: pipelineKeys.dealMeetings(user.id, dealId),
    enabled,
    queryFn: async (): Promise<DealMeeting[]> => {
      const { data, error } = await createClient()
        .from("calendar_events")
        .select(DEAL_MEETING_COLUMNS)
        .eq("user_id", workspaceId)
        .eq("deal_id", dealId)
        .neq("source", "deal_deadline")
        .order("starts_at", { ascending: false })
        .limit(DEAL_MEETING_LIMIT);
      if (error) throw error;
      return data;
    },
  });
}

/** The deal's invoices for its history; only with the right to see finance. */
export function useDealInvoices(dealId: string, enabled: boolean) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: pipelineKeys.dealInvoices(user.id, dealId),
    enabled,
    queryFn: async (): Promise<DealInvoice[]> => {
      const { data, error } = await createClient()
        .from("invoices")
        .select(DEAL_INVOICE_COLUMNS)
        .eq("user_id", workspaceId)
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(DEAL_INVOICE_LIMIT);
      if (error) throw error;
      return data;
    },
  });
}

/**
 * After a change of the deal's contacts: the list, the history, and the board
 * (the primary contact is the deal's contact, and a won deal's contact is a client).
 */
function invalidateDealContacts(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string,
  dealId: string,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: pipelineKeys.deal(userId, dealId) }),
    queryClient.invalidateQueries({ queryKey: pipelineKeys.deals(userId) }),
    invalidateContacts(queryClient, userId),
  ]);
}

/** Adds a contact to the deal; the first one becomes its primary contact (the database decides). */
export function useAddDealContact(dealId: string) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contactId,
      note,
    }: {
      contactId: string;
      note: string;
      created: boolean;
    }) => {
      const { data, error } = await createClient()
        .from("deal_contacts")
        .insert({
          user_id: workspaceId,
          deal_id: dealId,
          contact_id: contactId,
          note: note || null,
        })
        .select("is_primary")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row, { note, created }) => {
      track("deal_contact_added", {
        primary: row.is_primary,
        created_new: created,
        has_note: note.length > 0,
      });
    },
    onSettled: () => invalidateDealContacts(queryClient, user.id, dealId),
  });
}

/** The note of a contact on the deal, or making it the primary contact. */
export function useUpdateDealContact(dealId: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: { note: string | null } | { is_primary: true };
    }) => {
      const { error } = await createClient().from("deal_contacts").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_result, { patch }) => {
      track("deal_contact_updated", { what: "note" in patch ? "note" : "primary" });
    },
    onSettled: () => invalidateDealContacts(queryClient, user.id, dealId),
  });
}

/** Takes a contact off the deal (the contact stays); the next one becomes primary if needed. */
export function useRemoveDealContact(dealId: string) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; primary: boolean }) => {
      const { error } = await createClient().from("deal_contacts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_result, { primary }) => track("deal_contact_removed", { primary }),
    onSettled: () => invalidateDealContacts(queryClient, user.id, dealId),
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
      track("contact_created", {
        source: "manual",
        where: "pipeline",
        has_email: false,
        has_phone: false,
        has_website: false,
      });
      return data;
    },
  });
}
