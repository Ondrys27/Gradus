"use server";

import { isAddOnKey, isPaidPlanKey, type AddOnKey } from "@/config/pricing";
import {
  gatewayFor,
  loadStoredSubscription,
  viaStripe,
  type StoredSubscription,
} from "@/features/billing/stripe/account";
import { stripeClient } from "@/features/billing/stripe/client";
import { syncCustomer } from "@/features/billing/stripe/customer";
import {
  cancelStripeSubscription,
  changeStripePlan,
  resumeStripeSubscription,
  setStripeAddOn,
} from "@/features/billing/stripe/gateway";
import { accountAllowedInMode } from "@/features/billing/stripe/modes";
import { getPublishedPlans } from "@/features/plan/catalog-server";
import { notifyPlanRequest } from "@/features/plan/server-interest";
import { catalogWorkerTerms, storedWorkerTerms, type WorkerTerms } from "@/features/plan/worker-seats";
import { loadGenerationUsage } from "@/features/contacts/server/generation-usage";
import { loadAiUsage, loadFileUsage } from "@/features/jarvis/server/usage";
import { captureServerError } from "@/features/errors/alerts/server/capture";
import { track } from "@/lib/analytics/track";
import { getLocale } from "next-intl/server";
import { toFormatSettings, USER_SETTINGS_COLUMNS } from "@/lib/user-settings";
import type { Database } from "@/types/database";
import {
  billingProfileSchema,
  cancelSchema,
  planChoiceSchema,
  type BillingProfile,
  type BillingProfileInput,
  type CancelInput,
  type PlanChoiceInput,
} from "./schemas";
import {
  rpc,
  runSubscription as run,
  SubscriptionError,
  type SubscriptionContext,
  type SubscriptionResult,
} from "./server-context";
import {
  addOnBlock,
  changeBlock,
  changeDirection,
  hasLiveGateway,
  paymentRoute,
  plannedChange,
  type ChangeDirection,
  type ChangeTiming,
  type PlanUsage,
} from "./state";

/**
 * Settings → Subscription, called from the page. The user comes from the
 * session and must be the owner of their workspace (a worker pays for
 * nothing). subscriptions and payments are closed to every client: the
 * requests go through the database functions with the admin client and the
 * session's user id, which also lock the row and decide what is allowed.
 * They work in a read-only workspace too: that is when a plan is chosen.
 * A subscription that runs in Stripe changes in Stripe first (gateway.ts);
 * the database then records the request as before and the webhook writes
 * Stripe's outcome (status, period, the plan in force). Without one, a
 * trial or an ended plan is paid through Checkout (startCheckout). Failures
 * come back as codes, never thrown.
 */

type Context = SubscriptionContext;

/**
 * Before the database records a change of a subscription that runs in
 * Stripe, Stripe makes it. Without one: a trial or an ended plan is a
 * Checkout, a plan set by the administration changes as before.
 */
async function gatewayStep(
  ctx: Context,
  work: (gateway: Awaited<ReturnType<typeof gatewayFor>>, ref: string, sub: StoredSubscription) => Promise<void>,
  options: { checkoutInstead: (sub: StoredSubscription) => boolean },
) {
  const sub = await loadStoredSubscription(ctx.admin, ctx.userId);
  if (!sub) return;
  if (sub.providerRef && hasLiveGateway(sub)) {
    const gateway = await gatewayFor(ctx);
    if (sub.stripeMode !== gateway.mode) throw new SubscriptionError("paymentsUnavailable");
    await viaStripe("change", () => work(gateway, sub.providerRef as string, sub));
    return;
  }
  if (options.checkoutInstead(sub) && paymentRoute(sub) === "checkout" && stripeClient()) {
    throw new SubscriptionError("checkoutRequired");
  }
}

// ---------------------------------------------------------------------------
// Changing the plan
// ---------------------------------------------------------------------------

export type ChangeOutcome = { timing: ChangeTiming; direction: ChangeDirection; at: string | null };

export async function requestSubscriptionChange(
  input: PlanChoiceInput,
): Promise<SubscriptionResult<ChangeOutcome>> {
  return run("requestChange", async (ctx) => {
    const parsed = planChoiceSchema.safeParse(input);
    if (!parsed.success) throw new SubscriptionError("invalid");
    const { planKey, billing } = parsed.data;
    const { data: before } = await ctx.admin.rpc("current_plan", { _user_id: ctx.userId });

    // In Stripe first, by the same rule the database applies next: up now
    // (prorated), down at the end of the period (a schedule), the current
    // plan drops a scheduled change. A refusal there changes nothing here.
    await gatewayStep(
      ctx,
      async (gateway, ref, sub) => {
        if (!isPaidPlanKey(sub.planKey)) throw new SubscriptionError("notAllowed");
        if (changeBlock(sub)) throw new SubscriptionError("cancelPending");
        const planned = plannedChange({ ...sub, planKey: sub.planKey }, { planKey, billing });
        await changeStripePlan(gateway, ref, { planKey, billing }, planned.timing);
      },
      {
        // Dropping a scheduled change (the current plan again) needs no payment.
        checkoutInstead: (sub) =>
          !isPaidPlanKey(sub.planKey) ||
          changeDirection({ planKey: sub.planKey, billing: sub.billing }, { planKey, billing }) !== "same",
      },
    );
    const result = await rpc<{
      when: ChangeTiming;
      direction: ChangeDirection;
      from_plan: string;
      at: string | null;
      trialing: boolean;
    }>(
      ctx.admin.rpc("subscription_request_change", {
        _user_id: ctx.userId,
        _plan_key: planKey,
        _billing: billing,
      }),
    );
    if (result.when !== "none") {
      await notifyPlanRequest({
        admin: ctx.admin,
        userId: ctx.userId,
        email: ctx.email,
        planKey,
        billing,
        current: before?.[0] ?? null,
      });
    }
    await track(
      "subscription_change_requested",
      {
        from_plan: result.from_plan as "solo" | "pro" | "team",
        to_plan: planKey,
        billing,
        direction: result.direction,
        when: result.when,
        trialing: result.trialing,
      },
      { userId: ctx.userId, ownerId: ctx.userId, admin: ctx.admin },
    );
    return { timing: result.when, direction: result.direction, at: result.at };
  });
}

// ---------------------------------------------------------------------------
// Cancelling and taking it back
// ---------------------------------------------------------------------------

export async function cancelSubscription(
  input: CancelInput,
): Promise<SubscriptionResult<{ endsAt: string }>> {
  return run("cancel", async (ctx) => {
    const parsed = cancelSchema.safeParse(input);
    if (!parsed.success) throw new SubscriptionError("invalid");
    // Stripe stops at the end of the period; the reason and the note stay in Gradus.
    await gatewayStep(ctx, (gateway, ref) => cancelStripeSubscription(gateway, ref), {
      checkoutInstead: () => false,
    });
    const result = await rpc<{
      already: boolean;
      ends_at: string;
      plan: "solo" | "pro" | "team";
      billing: "monthly" | "yearly";
      trialing: boolean;
    }>(
      ctx.admin.rpc("subscription_cancel", {
        _user_id: ctx.userId,
        _reason: parsed.data.reason,
        ...(parsed.data.note ? { _note: parsed.data.note } : {}),
      }),
    );
    if (!result.already) {
      // The reason as a key; the note is the user's text and never leaves the row.
      await track(
        "subscription_cancelled",
        {
          plan: result.plan,
          billing: result.billing,
          reason: parsed.data.reason,
          with_note: parsed.data.note !== null,
          trialing: result.trialing,
        },
        { userId: ctx.userId, ownerId: ctx.userId, admin: ctx.admin },
      );
    }
    return { endsAt: result.ends_at };
  });
}

export async function resumeSubscription(): Promise<SubscriptionResult<{ resumed: boolean }>> {
  return run("resume", async (ctx) => {
    await gatewayStep(ctx, (gateway, ref) => resumeStripeSubscription(gateway, ref), {
      checkoutInstead: () => false,
    });
    const result = await rpc<{ resumed: boolean }>(
      ctx.admin.rpc("subscription_resume", { _user_id: ctx.userId }),
    );
    return { resumed: result.resumed };
  });
}

// ---------------------------------------------------------------------------
// Add-ons (step 24.1)
// ---------------------------------------------------------------------------

/**
 * Switches an add-on on or off. A subscription that runs in Stripe gets or
 * loses the add-on's item first (the rest of the period invoiced now, or
 * credited); during the free trial or a plan set by hand it is only written
 * (Checkout then charges it with the plan, beta never pays). Not after the
 * subscription expired, and not while Stripe holds a downgrade.
 */
export async function setSubscriptionAddOn(input: {
  addOn: AddOnKey;
  on: boolean;
}): Promise<SubscriptionResult<{ changed: boolean }>> {
  return run("addOn", async (ctx) => {
    if (!isAddOnKey(input?.addOn) || typeof input.on !== "boolean") throw new SubscriptionError("invalid");
    const sub = await loadStoredSubscription(ctx.admin, ctx.userId);
    if (!sub) throw new SubscriptionError("notAllowed");
    const block = addOnBlock(sub);
    if (block === "expired") throw new SubscriptionError("expired");
    if (block === "scheduled") throw new SubscriptionError("addOnScheduled");
    let charged = false;
    await gatewayStep(
      ctx,
      async (gateway, ref) => {
        charged = true;
        await setStripeAddOn(gateway, ref, input.addOn, input.on);
      },
      { checkoutInstead: () => false },
    );
    const result = await rpc<{ changed: boolean }>(
      ctx.admin.rpc("subscription_set_add_on", { _user_id: ctx.userId, _key: input.addOn, _on: input.on }),
    );
    if (result.changed) {
      await track(
        "add_on_changed",
        { add_on: input.addOn, on: input.on, charged },
        { userId: ctx.userId, ownerId: ctx.userId, admin: ctx.admin },
      );
    }
    return { changed: result.changed };
  });
}

// ---------------------------------------------------------------------------
// What a lower plan is compared with
// ---------------------------------------------------------------------------

/**
 * The account's workers, stored files and this month's generated contacts,
 * Jarvis answers and files. analytics_events and ai_usage are server-only,
 * read with the admin client filtered by the session's user id.
 */
export async function loadPlanUsage(): Promise<SubscriptionResult<PlanUsage>> {
  return run("usage", async (ctx) => {
    const { data: settingsRow, error: settingsError } = await ctx.supabase
      .from("user_settings")
      .select(USER_SETTINGS_COLUMNS)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (settingsError) throw settingsError;
    const settings = toFormatSettings(settingsRow);
    const [held, contacts, ai, files] = await Promise.all([
      rpc<{ workers: number; storage_bytes: number }[]>(
        ctx.admin.rpc("subscription_usage", { _owner: ctx.userId }),
      ),
      loadGenerationUsage(ctx.admin, ctx.userId, settings),
      loadAiUsage(ctx.supabase, ctx.admin, ctx.userId, settings),
      loadFileUsage(ctx.supabase, ctx.admin, ctx.userId, settings),
    ]);
    return {
      workers: held[0]?.workers ?? 0,
      storageBytes: Number(held[0]?.storage_bytes ?? 0),
      monthlyContacts: contacts.monthly.used,
      aiCalls: ai.used,
      aiFiles: files.used,
    };
  });
}

// ---------------------------------------------------------------------------
// Who pays for the workers
// ---------------------------------------------------------------------------

export type WorkerBillingRow = {
  workerId: string;
  status: "invited" | "active" | "inactive";
  /** A valid plan of their own (an invite not yet accepted has none). */
  ownPlan: boolean;
  /** Declined the invite; the record is ended. */
  declined: boolean;
  /** An invite waiting for an existing account in the app. */
  pendingAccount: boolean;
};

export type WorkerBilling = { planKey: string; terms: WorkerTerms; workers: WorkerBillingRow[] };

/**
 * The owner's workers against their plan (the seats in the price and the
 * price per extra worker): from the published catalog for solo / pro / team,
 * from the plans table for beta and other keys. worker_seats() says per
 * worker, with the owner's own client, whether they hold a plan of their own.
 */
export async function loadWorkerBilling(): Promise<SubscriptionResult<WorkerBilling>> {
  return run("workerBilling", async (ctx) => {
    const [seats, current] = await Promise.all([
      rpc<Database["public"]["Functions"]["worker_seats"]["Returns"]>(
        ctx.supabase.rpc("worker_seats", { _owner: ctx.userId }),
      ),
      rpc<{ plan_key: string }[]>(ctx.supabase.rpc("current_plan", { _user_id: ctx.userId })),
    ]);
    const planKey = current[0]?.plan_key ?? "beta";
    let terms: WorkerTerms;
    if (isPaidPlanKey(planKey)) {
      const plan = (await getPublishedPlans()).find((candidate) => candidate.key === planKey);
      terms = plan ? catalogWorkerTerms(plan) : { included: 0, perWorker: null };
    } else {
      const { data, error } = await ctx.admin
        .from("plans")
        .select("included_workers, per_worker")
        .eq("key", planKey)
        .maybeSingle();
      if (error) throw error;
      terms = storedWorkerTerms(data);
    }
    // Stripe charges the extra workers as the second item of the subscription
    // (startCheckout and gateway.ts), its quantity kept by the daily
    // reconciliation from the next period (syncWorkerSeats).
    return {
      planKey,
      terms,
      workers: seats.map((seat) => ({
        workerId: seat.worker_id,
        status: seat.status,
        ownPlan: seat.own_plan,
        declined: seat.declined,
        pendingAccount: seat.pending_account,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Billing details
// ---------------------------------------------------------------------------

/** Written with the user's own client: RLS allows the owner's own row only. */
export async function saveBillingProfile(
  input: BillingProfileInput,
): Promise<SubscriptionResult<BillingProfile>> {
  return run("saveBillingProfile", async (ctx) => {
    const parsed = billingProfileSchema.safeParse(input);
    if (!parsed.success) throw new SubscriptionError("invalid");
    const { error } = await ctx.supabase
      .from("billing_profiles")
      .upsert({ user_id: ctx.userId, ...parsed.data }, { onConflict: "user_id" });
    if (error) throw error;
    await syncBillingProfileToStripe(ctx, parsed.data);
    return parsed.data;
  });
}

/**
 * The same details on the workspace's Stripe customer, once it has one. A
 * failure there never undoes the save: it is logged and recorded, and the
 * next save sends everything again.
 */
async function syncBillingProfileToStripe(ctx: Context, profile: BillingProfile) {
  const client = stripeClient();
  if (!client) return;
  try {
    const { data } = await ctx.admin.from("profiles").select("is_internal").eq("id", ctx.userId).maybeSingle();
    if (!accountAllowedInMode(client.mode, { email: ctx.email, internal: data?.is_internal ?? false })) return;
    const locale = (await getLocale()) === "en" ? "en" : "cs";
    await syncCustomer(client.stripe, ctx.admin, {
      workspace: ctx.userId,
      mode: client.mode,
      profile,
      email: ctx.email,
      locale,
    });
  } catch (error) {
    console.error("[stripe] billing details not synced", (error as { code?: string })?.code ?? "");
    captureServerError(error, {
      source: "action",
      page: "/app/nastaveni/predplatne",
      action: "subscription.saveBillingProfile",
      userId: ctx.userId,
    });
  }
}
