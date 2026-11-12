import type { OpsEnv } from "@/lib/ops";
import { dealPatchSchema, type DealInput, type DealPatch, type DealPatchField } from "./schemas";
import { DEAL_COLUMNS, type Deal, type Stage } from "./types";

/**
 * The writes of the pipeline, shared by the screens (queries.ts) and Grady's
 * tools. The database stamps entered_stage_at, won_at / lost_at, logs the
 * history (deal_events), moves the last activity and puts the contact of a
 * won deal into Clients. The celebration of a win and its XP stay with the
 * caller (the board, or the browser when Grady's card arrives).
 */

export type DealSource = "pipeline" | "contact" | "cold_calling" | "grady";

export function toDealRow(input: DealInput) {
  return {
    title: input.title,
    contact_id: input.contact_id,
    value: input.value,
    currency: input.currency,
    expected_close_date: input.expected_close_date,
    description: input.description || null,
    ...(input.assignee_id ? { assignee_id: input.assignee_id } : {}),
  };
}

/** The place after the last deal of a stage. */
export async function nextDealPositionIn(env: OpsEnv, workspaceId: string, stageId: string) {
  const { data, error } = await env.db
    .from("deals")
    .select("position")
    .eq("user_id", workspaceId)
    .eq("stage_id", stageId)
    .order("position", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data[0] ? data[0].position + 1 : 0;
}

/** A new deal, last in its stage; created straight into a won stage it is a win too. */
export async function createDeal(
  env: OpsEnv,
  args: {
    workspaceId: string;
    input: DealInput;
    position: number;
    source: DealSource;
    /** The stage it lands in, for the win. */
    stage: Pick<Stage, "is_won"> | null;
  },
): Promise<Deal> {
  const { data, error } = await env.db
    .from("deals")
    .insert({
      ...toDealRow(args.input),
      user_id: args.workspaceId,
      stage_id: args.input.stage_id,
      position: args.position,
    })
    .select(DEAL_COLUMNS)
    .single();
  if (error) throw error;
  const value = data.value !== null ? { value: data.value } : {};
  env.track("deal_created", {
    currency: data.currency,
    ...value,
    has_contact: data.contact_id !== null,
    from: args.source,
  });
  if (args.stage?.is_won)
    env.track("deal_won", { currency: data.currency, ...value, days_open: 0 });
  return data;
}

/**
 * One change from the deal detail, a field or more at a time. The stage
 * changes only through moveDeal, the contacts through deal_contacts.
 */
export async function patchDeal(env: OpsEnv, id: string, patch: DealPatch): Promise<Deal> {
  const clean = dealPatchSchema.parse(patch);
  // An emptied text is no text.
  const row = {
    ...clean,
    ...(clean.description !== undefined ? { description: clean.description || null } : {}),
    ...(clean.lost_reason !== undefined ? { lost_reason: clean.lost_reason || null } : {}),
  };
  const { data, error } = await env.db
    .from("deals")
    .update(row)
    .eq("id", id)
    .select(DEAL_COLUMNS)
    .single();
  if (error) throw error;
  for (const field of Object.keys(patch) as DealPatchField[]) env.track("deal_updated", { field });
  return data;
}

/** A stage change as analytics sees it: positions and times, plus a win or a loss with its value. */
function trackMove(
  env: OpsEnv,
  deal: Pick<Deal, "stage_id" | "value" | "currency" | "entered_stage_at" | "created_at">,
  stage: Stage,
  lostReason: string | undefined,
  from: Stage | undefined,
) {
  const now = Date.now();
  const value = deal.value !== null ? { value: deal.value } : {};
  env.track("deal_moved", {
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
    env.track("deal_won", {
      currency: deal.currency,
      ...value,
      days_open: Math.max(0, Math.floor((now - new Date(deal.created_at).getTime()) / 86_400_000)),
    });
  } else if (stage.is_lost && !from?.is_lost) {
    env.track("deal_lost", { currency: deal.currency, ...value, has_reason: Boolean(lostReason) });
  }
}

/** Moves a deal to the end of another stage; a lost stage keeps the reason. */
export async function moveDeal(
  env: OpsEnv,
  args: {
    deal: Pick<Deal, "id" | "stage_id" | "value" | "currency" | "entered_stage_at" | "created_at">;
    stage: Stage;
    position: number;
    lostReason?: string;
    /** The stages of the space, to know where the deal came from. */
    stages?: Stage[];
  },
): Promise<void> {
  const { deal, stage, lostReason } = args;
  const { error } = await env.db
    .from("deals")
    .update({
      stage_id: stage.id,
      position: args.position,
      lost_reason: stage.is_lost && lostReason ? lostReason : null,
    })
    .eq("id", deal.id);
  if (error) throw error;
  trackMove(
    env,
    deal,
    stage,
    lostReason,
    args.stages?.find((item) => item.id === deal.stage_id),
  );
}

/** Tasks only on this deal go with it; the contact stays. */
export async function deleteDeal(env: OpsEnv, id: string): Promise<void> {
  const { error } = await env.db.from("deals").delete().eq("id", id);
  if (error) throw error;
  env.track("deal_deleted", {});
}

/** Another contact on a deal; the first one becomes primary (the database decides). */
export async function addDealContact(
  env: OpsEnv,
  args: { workspaceId: string; dealId: string; contactId: string; note: string; created: boolean },
): Promise<{ id: string; is_primary: boolean }> {
  const { data, error } = await env.db
    .from("deal_contacts")
    .insert({
      user_id: args.workspaceId,
      deal_id: args.dealId,
      contact_id: args.contactId,
      note: args.note || null,
    })
    .select("id, is_primary")
    .single();
  if (error) throw error;
  env.track("deal_contact_added", {
    primary: data.is_primary,
    created_new: args.created,
    has_note: args.note.length > 0,
  });
  return data;
}
