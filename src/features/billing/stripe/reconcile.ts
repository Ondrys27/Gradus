import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { ensureCatalogPrices, loadPublishedVersion } from "./catalog-sync";
import { stripeClient } from "./client";
import { syncWorkerSeats } from "./gateway";
import { subscriptionState } from "./mapping";
import { applySubscriptionState } from "./store";

/**
 * The daily reconciliation (cron "automatic payments", step 23.1): for the
 * running rows that follow a Stripe subscription in this deployment's mode,
 * the subscription as Stripe has it now is written again (a missed webhook
 * is caught up; the database never lets it overwrite a newer state), and the
 * extra workers' item is kept at the number of extra workers for the next
 * period. At most 200 rows a run, the longest unchecked first.
 */

type Admin = SupabaseClient<Database>;

export const RECONCILE_LIMIT = 200;

export type ReconcileReport = {
  enabled: boolean;
  checked: number;
  fixed: number;
  seats: number;
  failed: number;
};

export async function reconcileStripeSubscriptions(
  admin: Admin,
  limit = RECONCILE_LIMIT,
): Promise<ReconcileReport> {
  const client = stripeClient();
  const report: ReconcileReport = { enabled: !!client, checked: 0, fixed: 0, seats: 0, failed: 0 };
  if (!client) return report;
  const { data, error } = await admin
    .from("subscriptions")
    .select("user_id, provider_ref")
    .eq("provider", "stripe")
    .eq("stripe_mode", client.mode)
    .neq("status", "cancelled")
    .not("provider_ref", "is", null)
    // The end-to-end tests' synthetic subscriptions exist only in the database.
    .not("provider_ref", "like", "sub_e2e_%")
    .order("provider_synced_at", { ascending: true, nullsFirst: true })
    .limit(Math.min(Math.max(1, limit), RECONCILE_LIMIT));
  if (error) throw new Error(`reconcile: ${error.code ?? error.message}`);
  if (!data?.length) return report;

  const version = await loadPublishedVersion(admin);
  const prices = await ensureCatalogPrices(client.stripe, client.mode, version);
  for (const row of data) {
    report.checked += 1;
    try {
      const at = new Date();
      const sub = await client.stripe.subscriptions.retrieve(row.provider_ref as string);
      const scheduleId = typeof sub.schedule === "string" ? sub.schedule : (sub.schedule?.id ?? null);
      const schedule = scheduleId
        ? await client.stripe.subscriptionSchedules.retrieve(scheduleId, { expand: ["phases.items.price"] })
        : null;
      const mapped = subscriptionState(sub, schedule, at);
      if (!mapped.ok || mapped.state.workspace !== row.user_id) {
        report.failed += 1;
        continue;
      }
      const answer = await applySubscriptionState(admin, mapped.state, client.mode, at);
      if (answer.outcome === "applied") report.fixed += 1;
      const seatsChanged = await syncWorkerSeats(
        { stripe: client.stripe, mode: client.mode, admin, workspace: row.user_id },
        sub,
        mapped.state,
        version,
        prices,
      );
      if (seatsChanged) report.seats += 1;
    } catch (failure) {
      report.failed += 1;
      console.error("[cron] stripe reconcile row failed", (failure as { code?: string })?.code ?? "");
    }
  }
  console.info(
    `[cron] stripe reconcile: checked ${report.checked}, fixed ${report.fixed}, seats ${report.seats}, failed ${report.failed}`,
  );
  return report;
}
