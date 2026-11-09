import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import type { Database } from "@/types/database";
import { ensureCatalogPrices, loadPublishedVersion } from "./catalog-sync";
import { stripeClient, type StripeClient } from "./client";
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

type Row = { user_id: string; provider_ref: string };
type RowOutcome = { fixed: boolean; seats: boolean; failed: boolean };

/** One row: Stripe's subscription as it is now, and the extra workers for the next period. */
async function reconcileRow(
  admin: Admin,
  client: StripeClient,
  row: Row,
  version: Awaited<ReturnType<typeof loadPublishedVersion>>,
  prices: Awaited<ReturnType<typeof ensureCatalogPrices>>,
): Promise<RowOutcome> {
  const at = new Date();
  const sub = await client.stripe.subscriptions.retrieve(row.provider_ref);
  const scheduleId = typeof sub.schedule === "string" ? sub.schedule : (sub.schedule?.id ?? null);
  const schedule = scheduleId
    ? await client.stripe.subscriptionSchedules.retrieve(scheduleId, { expand: ["phases.items.price"] })
    : null;
  const mapped = subscriptionState(sub, schedule, at);
  if (!mapped.ok || mapped.state.workspace !== row.user_id) return { fixed: false, seats: false, failed: true };
  const answer = await applySubscriptionState(admin, mapped.state, client.mode, at);
  // An ended subscription has no workers' item to keep.
  const seats =
    mapped.state.status === "cancelled"
      ? false
      : await syncWorkerSeats(
          { stripe: client.stripe, mode: client.mode, admin, workspace: row.user_id },
          sub,
          mapped.state,
          version,
          prices,
        );
  return { fixed: answer.outcome === "applied", seats, failed: false };
}

export type WorkspaceSyncResult =
  | { ok: true; fixed: boolean; seats: boolean }
  | { ok: false; reason: "paymentsOff" | "notLinked" | "otherMode" | "mismatch" | "gatewayFailed" };

/**
 * "Sync with Stripe" of the administration for one workspace: the same as
 * the daily reconciliation, for its row only (also once it is cancelled, so
 * a missed end is caught up). Only a row of this deployment's mode.
 */
export async function syncWorkspaceWithStripe(admin: Admin, workspace: string): Promise<WorkspaceSyncResult> {
  const client = stripeClient();
  if (!client) return { ok: false, reason: "paymentsOff" };
  const { data, error } = await admin
    .from("subscriptions")
    .select("user_id, provider, provider_ref, stripe_mode")
    .eq("user_id", workspace)
    .maybeSingle();
  if (error) throw new Error(`sync: ${error.code ?? error.message}`);
  if (!data || data.provider !== "stripe" || !data.provider_ref || data.provider_ref.startsWith("sub_e2e_")) {
    return { ok: false, reason: "notLinked" };
  }
  if (data.stripe_mode !== client.mode) return { ok: false, reason: "otherMode" };
  try {
    const version = await loadPublishedVersion(admin);
    const prices = await ensureCatalogPrices(client.stripe, client.mode, version);
    const outcome = await reconcileRow(admin, client, { user_id: workspace, provider_ref: data.provider_ref }, version, prices);
    if (outcome.failed) return { ok: false, reason: "mismatch" };
    return { ok: true, fixed: outcome.fixed, seats: outcome.seats };
  } catch (failure) {
    if (failure instanceof Stripe.errors.StripeError) {
      console.error(`[stripe] admin sync failed: ${failure.type}${failure.code ? ` ${failure.code}` : ""}`);
      return { ok: false, reason: "gatewayFailed" };
    }
    throw failure;
  }
}

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
      const outcome = await reconcileRow(admin, client, row as { user_id: string; provider_ref: string }, version, prices);
      if (outcome.failed) report.failed += 1;
      if (outcome.fixed) report.fixed += 1;
      if (outcome.seats) report.seats += 1;
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
