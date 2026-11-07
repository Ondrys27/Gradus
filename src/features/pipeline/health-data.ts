import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { FormatSettings } from "@/lib/format";
import {
  digestHealth,
  pipelineHealth,
  type HealthDeal,
  type HealthDigest,
  type OpenDealTask,
} from "./health";

/**
 * What the pipeline tiles read besides the deals: every open task of a deal
 * (with the deal, so one beyond the board still shows) and when each open
 * deal last had a task finished. Shared by the browser (the user's client)
 * and the server (Jarvis, the user's or the admin client filtered by the
 * space); RLS of the user's client keeps it to what they may see.
 */

/** Open tasks are what is to be done; this only bounds the read. */
export const OPEN_DEAL_TASK_LIMIT = 2000;

const HEALTH_DEAL =
  "id, title, stage_id, expected_close_date, created_at, assignee_id, won_at, lost_at, contact:contacts(id, company_name, first_name, last_name)";
export const HEALTH_DEAL_COLUMNS = HEALTH_DEAL;
const OPEN_DEAL_TASK_COLUMNS = `id, deal_id, due_at, assignee_id, deal:deals(${HEALTH_DEAL})`;

export type DealTaskSignals = {
  tasks: OpenDealTask[];
  lastDone: Map<string, string>;
};

/** Jarvis's own summaries leave the tutorial's sample data out (the tiles on screen show it). */
export type HealthReadOptions = { excludeDemo?: boolean };

export async function fetchDealTaskSignals(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  options: HealthReadOptions = {},
): Promise<DealTaskSignals> {
  let open = supabase
    .from("crm_tasks")
    .select(OPEN_DEAL_TASK_COLUMNS)
    .eq("user_id", workspaceId)
    .eq("status", "open")
    .not("deal_id", "is", null);
  if (options.excludeDemo) open = open.eq("is_demo", false);
  const [tasks, lastDone] = await Promise.all([
    open.order("due_at").limit(OPEN_DEAL_TASK_LIMIT),
    supabase.rpc("deal_tasks_last_done", { _workspace: workspaceId }),
  ]);
  if (tasks.error) throw tasks.error;
  if (lastDone.error) throw lastDone.error;
  return {
    tasks: (tasks.data ?? []).flatMap((row): OpenDealTask[] =>
      row.deal_id
        ? [
            {
              id: row.id,
              deal_id: row.deal_id,
              due_at: row.due_at,
              assignee_id: row.assignee_id,
              deal: row.deal as HealthDeal | null,
            },
          ]
        : [],
    ),
    lastDone: new Map(
      (lastDone.data ?? []).flatMap((row) =>
        row.deal_id && row.last_done_at ? [[row.deal_id, row.last_done_at] as const] : [],
      ),
    ),
  };
}

/** Open deals of a space for the tiles, where the board is not loaded (Jarvis). */
export async function fetchOpenHealthDeals(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  limit = 2000,
  options: HealthReadOptions = {},
): Promise<HealthDeal[]> {
  let query = supabase
    .from("deals")
    .select(HEALTH_DEAL)
    .eq("user_id", workspaceId)
    .is("won_at", null)
    .is("lost_at", null);
  if (options.excludeDemo) query = query.eq("is_demo", false);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as HealthDeal[];
}

/**
 * The tiles as Jarvis sees them, read on the server: the user's client in a
 * chat (RLS), the admin client for the morning brief (filtered by the space).
 * `assigneeId` null counts the whole space; a worker's id only theirs.
 */
export async function loadHealthDigest(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  assigneeId: string | null,
  settings: FormatSettings,
  now: Date,
  options: HealthReadOptions = {},
): Promise<HealthDigest> {
  const [deals, signals] = await Promise.all([
    fetchOpenHealthDeals(supabase, workspaceId, undefined, options),
    fetchDealTaskSignals(supabase, workspaceId, options),
  ]);
  return digestHealth(
    pipelineHealth({
      deals,
      tasks: signals.tasks,
      lastDone: signals.lastDone,
      assigneeId,
      now,
      settings,
    }),
  );
}
