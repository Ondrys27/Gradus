import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { PaymentState, PaymentStatus, SubscriptionState } from "./mapping";
import type { StripeMode } from "./modes";
import type { ApplyAnswer, ClaimResult, EventOutcome, RecordAnswer } from "./webhook";

/**
 * The database side of Stripe: the SECURITY DEFINER functions of
 * 20261110090000_stripe_billing.sql, called with the admin client only
 * (service role). Every workspace id comes from Stripe's object as Gradus
 * made it (metadata) and is checked by the functions against the mode.
 */

type Admin = SupabaseClient<Database>;

export async function applySubscriptionState(
  admin: Admin,
  state: SubscriptionState,
  mode: StripeMode,
  eventAt: Date,
): Promise<ApplyAnswer> {
  const { data, error } = await admin.rpc("billing_apply_subscription", {
    _user_id: state.workspace,
    _mode: mode,
    _event_at: eventAt.toISOString(),
    _subscription_ref: state.subscriptionRef,
    _plan_key: state.planKey,
    _billing: state.billing,
    _status: state.status,
    // Null where Stripe has none; the generated types do not know SQL null.
    _period_start: state.periodStart as string,
    _period_end: state.periodEnd as string,
    _trial_end: state.trialEnd as string,
    _cancel_at_period_end: state.cancelAtPeriodEnd,
    ...(state.scheduled
      ? {
          _scheduled_plan_key: state.scheduled.planKey,
          _scheduled_billing: state.scheduled.billing,
          _scheduled_at: state.scheduled.at,
        }
      : {}),
    ...(state.amount !== null ? { _amount: state.amount } : {}),
    ...(state.currency ? { _currency: state.currency } : {}),
  });
  if (error) throw new Error(`billing_apply_subscription: ${error.code ?? error.message}`);
  return data as unknown as ApplyAnswer;
}

export async function recordStripePayment(
  admin: Admin,
  payment: PaymentState,
  status: PaymentStatus,
  workspace: string,
  mode: StripeMode,
  eventAt: Date,
): Promise<RecordAnswer> {
  const { data, error } = await admin.rpc("billing_record_payment", {
    _user_id: workspace,
    _mode: mode,
    _event_at: eventAt.toISOString(),
    _invoice_ref: payment.invoiceRef,
    _status: status,
    _amount: payment.amount,
    _vat_amount: payment.vatAmount,
    _currency: payment.currency,
    _paid_at: payment.paidAt,
    ...(payment.invoiceUrl ? { _invoice_url: payment.invoiceUrl } : {}),
  });
  if (error) throw new Error(`billing_record_payment: ${error.code ?? error.message}`);
  return data as unknown as RecordAnswer;
}

export async function claimEvent(
  admin: Admin,
  event: { id: string; type: string; created: number },
  mode: StripeMode,
): Promise<ClaimResult> {
  const { data, error } = await admin.rpc("billing_event_claim", {
    _event_id: event.id,
    _mode: mode,
    _type: event.type.slice(0, 100),
    _created: new Date(event.created * 1000).toISOString(),
  });
  if (error) throw new Error(`billing_event_claim: ${error.code ?? error.message}`);
  return data as ClaimResult;
}

/** Identifiers and states only: every value is cut short and nothing else is kept. */
function cleanDetail(detail: Record<string, string>): Json {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(detail).slice(0, 10)) {
    if (/^[a-z_]{1,30}$/.test(key) && /^[A-Za-z0-9_.:-]{0,80}$/.test(value)) out[key] = value;
  }
  return out;
}

export async function finishEvent(
  admin: Admin,
  eventId: string,
  outcome: EventOutcome | "error",
  workspace: string | null,
  detail: Record<string, string>,
): Promise<void> {
  const { error } = await admin.rpc("billing_event_finish", {
    _event_id: eventId,
    _outcome: outcome,
    ...(workspace ? { _user_id: workspace } : {}),
    _detail: cleanDetail(detail),
  });
  if (error) throw new Error(`billing_event_finish: ${error.code ?? error.message}`);
}

/** The account behind a workspace, for the mode it may use. */
export async function accountOf(
  admin: Admin,
  workspace: string,
): Promise<{ email: string | null; internal: boolean } | null> {
  const [{ data: user }, { data: profile }] = await Promise.all([
    admin.auth.admin.getUserById(workspace),
    admin.from("profiles").select("is_internal").eq("id", workspace).maybeSingle(),
  ]);
  if (!user?.user) return null;
  return { email: user.user.email ?? null, internal: profile?.is_internal ?? false };
}
