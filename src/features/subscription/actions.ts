"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyPlanRequest } from "@/features/plan/server-interest";
import { loadGenerationUsage } from "@/features/contacts/server/generation-usage";
import { loadAiUsage, loadFileUsage } from "@/features/jarvis/server/usage";
import { measure } from "@/lib/analytics/instrument";
import { track } from "@/lib/analytics/track";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
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
import type { ChangeDirection, ChangeTiming, PlanUsage } from "./state";

/**
 * Settings → Subscription, called from the page. The user comes from the
 * session and must be the owner of their workspace (a worker pays for
 * nothing). subscriptions and payments are closed to every client: the
 * requests go through the database functions with the admin client and the
 * session's user id, which also lock the row and decide what is allowed.
 * They work in a read-only workspace too: that is when a plan is chosen.
 * Failures come back as codes, never thrown.
 */

export type SubscriptionErrorCode =
  | "ownerOnly"
  | "invalid"
  | "notAllowed"
  | "cancelPending"
  | "expired"
  | "unknown";

export type SubscriptionResult<T> = { ok: true; data: T } | { ok: false; error: SubscriptionErrorCode };

type Client = SupabaseClient<Database>;
type Context = { supabase: Client; admin: Client; userId: string; email: string | null };

class SubscriptionError extends Error {
  constructor(readonly code: SubscriptionErrorCode) {
    super(code);
  }
}

async function ownerContext(): Promise<Context> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string" || !userId) throw new SubscriptionError("ownerOnly");
  const { data: workspaceId, error } = await supabase.rpc("current_workspace_id");
  if (error) throw error;
  if (workspaceId !== userId) throw new SubscriptionError("ownerOnly");
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  return { supabase, admin: createAdminClient(), userId, email };
}

/** What the database functions raise, as codes. */
function fromDatabase(error: { code?: string; message?: string }): SubscriptionError | null {
  const message = error.message ?? "";
  if (error.code === "22023") return new SubscriptionError("invalid");
  if (error.code === "42501") return new SubscriptionError("notAllowed");
  if (error.code === "55000" && message.includes("cancel_pending")) {
    return new SubscriptionError("cancelPending");
  }
  if (error.code === "55000" && message.includes("expired")) return new SubscriptionError("expired");
  return null;
}

function run<T>(name: string, work: (ctx: Context) => Promise<T>): Promise<SubscriptionResult<T>> {
  return measure(`subscription.${name}`, async (): Promise<SubscriptionResult<T>> => {
    try {
      return { ok: true, data: await work(await ownerContext()) };
    } catch (error) {
      if (error instanceof SubscriptionError) return { ok: false, error: error.code };
      const known = fromDatabase(error as { code?: string; message?: string });
      if (known) return { ok: false, error: known.code };
      console.error(`subscription action ${name} failed`, error);
      return { ok: false, error: "unknown" };
    }
  })();
}

async function rpc<T>(call: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await call;
  if (error) throw error;
  return data as T;
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

    // TODO(payments): with a gateway, an upgrade opens its checkout (or charges
    // the difference) here and the webhook applies the change; a downgrade
    // becomes the gateway's change at renewal. Until then the request is only
    // written (status and period untouched) and the app owner is told.
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
    const result = await rpc<{ resumed: boolean }>(
      ctx.admin.rpc("subscription_resume", { _user_id: ctx.userId }),
    );
    return { resumed: result.resumed };
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
    return parsed.data;
  });
}
