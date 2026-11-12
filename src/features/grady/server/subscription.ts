import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogPlan } from "@/config/pricing";
import { SUBSCRIPTION_COLUMNS, toSubscription } from "@/features/subscription/state";
import type { FormatSettings } from "@/lib/format";
import type { Database } from "@/types/database";
import { describeSubscription, WORKER_SUBSCRIPTION_LINE } from "../plans-context";

/**
 * The user's plan for the chat's <plans> block, read with the user's own
 * client (RLS: their own row only). A worker manages no plan of their own.
 */
export async function loadSubscriptionLine(
  supabase: SupabaseClient<Database>,
  userId: string,
  plans: readonly CatalogPlan[],
  settings: FormatSettings,
): Promise<string | null> {
  const { data: workspaceId, error: workspaceError } = await supabase.rpc("current_workspace_id");
  if (workspaceError) throw workspaceError;
  if (workspaceId && workspaceId !== userId) return WORKER_SUBSCRIPTION_LINE;
  const { data, error } = await supabase
    .from("subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return describeSubscription(data ? toSubscription(data) : null, plans, settings);
}
