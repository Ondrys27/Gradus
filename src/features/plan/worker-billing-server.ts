import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import { readWorkerBillingSetting, WORKER_BILLING_SETTING_KEY } from "./worker-billing";

const TTL_MS = 30_000;
let cache: { at: number; visible: boolean } | null = null;

export function clearWorkerBillingCache() {
  cache = null;
}

/**
 * WORKER_BILLING_VISIBLE from app_settings (server only, admin client), kept
 * 30 seconds per instance like the other settings. A failed read hides it.
 */
export async function loadWorkerBillingVisible(
  admin: SupabaseClient<Database> = createAdminClient(),
  now = Date.now(),
): Promise<boolean> {
  if (cache && now - cache.at <= TTL_MS) return cache.visible;
  const { data, error } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", WORKER_BILLING_SETTING_KEY)
    .maybeSingle();
  if (error) {
    console.error("[plan] reading worker_billing failed", error.code);
    return false;
  }
  const visible = readWorkerBillingSetting(data?.value);
  cache = { at: now, visible };
  return visible;
}
