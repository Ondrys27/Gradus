import type Stripe from "stripe";
import type { Billing, PaidPlanKey } from "@/config/pricing";
import {
  isFullRefund,
  paymentFromInvoice,
  subscriptionState,
  workspaceOf,
  isWorkspaceId,
  type PaymentState,
  type PaymentStatus,
  type SubscriptionProblem,
  type SubscriptionState,
} from "./mapping";
import {
  accountAllowedInMode,
  eventMode,
  isLocalEmail,
  isSyntheticE2eEvent,
  modeAllowedInEnv,
  type StripeMode,
} from "./modes";

/**
 * What one Stripe webhook event does (step 23.1), with every I/O handed in,
 * so the route, the tests and the end-to-end run share it:
 * 1. the event's mode must be the deployment's (live in production, test
 *    elsewhere) and, unless it is a synthetic end-to-end event, the mode of
 *    the secret key the objects are loaded with;
 * 2. each event is processed once (stripe_events), a second delivery while
 *    the first works on it is told to come back (409);
 * 3. the object is loaded from Stripe as it is now (an event may arrive late
 *    or out of order; the database also refuses state older than what it
 *    has, by the event's time), mapped and written;
 * 4. an unknown workspace, an account the mode may not change or a price
 *    that is not Gradus's answer 200 and go to error_events with a GR code:
 *    Stripe retrying them would change nothing. Only an unexpected failure
 *    throws (the route answers 500, Stripe tries again later).
 */

export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
] as const;
export type HandledEvent = (typeof HANDLED_EVENTS)[number];

export type ClaimResult = "new" | "duplicate" | "busy" | "retry";
export type EventOutcome = "applied" | "unchanged" | "ignored" | "stale" | "rejected";

export type ApplyAnswer = {
  outcome: "applied" | "unchanged" | "stale" | "rejected";
  reason?: string;
  previous_status?: string;
  linked?: boolean;
};
export type RecordAnswer = {
  outcome: "applied" | "unchanged" | "stale" | "rejected";
  reason?: string;
  previous_status?: string | null;
  first?: boolean;
};

export type WebhookProblem =
  | SubscriptionProblem
  | "wrong_env_mode"
  | "key_mode"
  | "unknown_account"
  | "account_mode"
  | "not_e2e_account"
  | "workspace_mismatch"
  | "no_invoice"
  | "db_rejected";

export type AnalyticsCall =
  | { name: "checkout_completed"; props: { plan: PaidPlanKey; billing: Billing; currency: string } }
  | {
      name: "payment_succeeded";
      props: { plan: PaidPlanKey; billing: Billing; currency: string; first: boolean };
    }
  | { name: "payment_failed"; props: { attempt: number; plan?: PaidPlanKey; billing?: Billing } }
  | { name: "payment_refunded"; props: { currency: string; plan?: PaidPlanKey } };

/**
 * What the app's owner hears about (one e-mail a day at most, billing_alerts):
 * the first payment of an account and a subscription Stripe ended after its
 * last failed attempt. Never for @gradus.local accounts.
 */
export type OwnerAlert =
  | {
      kind: "first_payment";
      workspace: string;
      mode: StripeMode;
      ref: string;
      planKey: PaidPlanKey | null;
      billing: Billing | null;
      amount: number;
      currency: string;
    }
  | {
      kind: "final_failure";
      workspace: string;
      mode: StripeMode;
      ref: string;
      planKey: PaidPlanKey;
      billing: Billing;
    };

export type WebhookDeps = {
  vercelEnv: string | undefined;
  /** The mode of the configured secret key; null without one. */
  keyMode: StripeMode | null;
  now: () => Date;
  claim: (event: Stripe.Event, mode: StripeMode) => Promise<ClaimResult>;
  finish: (
    event: Stripe.Event,
    outcome: EventOutcome,
    workspace: string | null,
    detail: Record<string, string>,
  ) => Promise<void>;
  /** The object as Stripe has it now; a synthetic event's own object. */
  loadSubscription: (id: string, event: Stripe.Event) => Promise<Stripe.Subscription>;
  loadSchedule: (id: string, event: Stripe.Event) => Promise<Stripe.SubscriptionSchedule | null>;
  loadInvoice: (id: string, event: Stripe.Event) => Promise<Stripe.Invoice>;
  invoiceOfCharge: (charge: Stripe.Charge, event: Stripe.Event) => Promise<string | null>;
  account: (workspace: string) => Promise<{ email: string | null; internal: boolean } | null>;
  isE2eAccount: (email: string | null) => boolean;
  applySubscription: (state: SubscriptionState, mode: StripeMode, eventAt: Date) => Promise<ApplyAnswer>;
  recordPayment: (
    payment: PaymentState,
    status: PaymentStatus,
    workspace: string,
    mode: StripeMode,
    eventAt: Date,
  ) => Promise<RecordAnswer>;
  track: (call: AnalyticsCall, workspace: string) => Promise<void>;
  /** Records an alert for the owner's digest; never throws. */
  alert: (alert: OwnerAlert) => Promise<void>;
  /** Into error_events with a GR code (and the owner's e-mail). */
  report: (problem: WebhookProblem, context: { type: string; workspace: string | null }) => void;
};

export type WebhookResult = { status: 200 | 409; body: { received: true; outcome: EventOutcome | "duplicate" | "busy" } };

class Rejected extends Error {
  constructor(
    readonly problem: WebhookProblem,
    readonly workspace: string | null,
  ) {
    super(problem);
  }
}

const isHandled = (type: string): type is HandledEvent => (HANDLED_EVENTS as readonly string[]).includes(type);
const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null);
/** A charged currency for analytics: three capital letters, else nothing. */
const asCurrency = (value: string | null | undefined): string | null =>
  value && /^[A-Z]{3}$/.test(value) ? value : null;

/** Folds several writes into the event's one outcome; a refusal wins, then a change. */
function merge(a: EventOutcome, b: EventOutcome): EventOutcome {
  const order: EventOutcome[] = ["rejected", "applied", "unchanged", "stale", "ignored"];
  return order.indexOf(a) <= order.indexOf(b) ? a : b;
}

export async function processStripeEvent(event: Stripe.Event, deps: WebhookDeps): Promise<WebhookResult> {
  const mode = eventMode(event.livemode);
  const synthetic = isSyntheticE2eEvent(event, deps.vercelEnv);
  const eventAt = new Date(event.created * 1000);

  const claim = await deps.claim(event, mode);
  if (claim === "duplicate") return { status: 200, body: { received: true, outcome: "duplicate" } };
  if (claim === "busy") return { status: 409, body: { received: true, outcome: "busy" } };

  const finish = async (outcome: EventOutcome, workspace: string | null, detail: Record<string, string>) => {
    await deps.finish(event, outcome, workspace, detail);
    return { status: 200 as const, body: { received: true as const, outcome } };
  };

  if (!modeAllowedInEnv(mode, deps.vercelEnv)) {
    deps.report("wrong_env_mode", { type: event.type, workspace: null });
    return finish("rejected", null, { problem: "wrong_env_mode" });
  }
  if (!isHandled(event.type)) return finish("ignored", null, { type: "unhandled" });
  if (!synthetic && deps.keyMode !== mode) {
    deps.report("key_mode", { type: event.type, workspace: null });
    return finish("rejected", null, { problem: "key_mode" });
  }

  const context = new EventContext(event, deps, mode, eventAt, synthetic);
  try {
    const outcome = await context.run();
    return finish(outcome, context.workspace, context.detail);
  } catch (error) {
    if (!(error instanceof Rejected)) throw error;
    deps.report(error.problem, { type: event.type, workspace: error.workspace });
    return finish("rejected", error.workspace ?? context.workspace, { ...context.detail, problem: error.problem });
  }
}

class EventContext {
  workspace: string | null = null;
  detail: Record<string, string> = {};
  private checked = new Set<string>();
  /** Workspaces of @gradus.local accounts: their payments alert nobody. */
  private local = new Set<string>();

  constructor(
    private readonly event: Stripe.Event,
    private readonly deps: WebhookDeps,
    private readonly mode: StripeMode,
    private readonly eventAt: Date,
    private readonly synthetic: boolean,
  ) {}

  async run(): Promise<EventOutcome> {
    const object = this.event.data.object as unknown;
    switch (this.event.type as HandledEvent) {
      case "checkout.session.completed":
        return this.checkoutCompleted(object as Stripe.Checkout.Session);
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = object as Stripe.Subscription;
        this.detail.object = sub.id;
        return (await this.subscription(sub.id)).outcome;
      }
      case "invoice.paid":
        return this.invoice(object as Stripe.Invoice, "paid");
      case "invoice.payment_failed":
        return this.invoice(object as Stripe.Invoice, "failed");
      case "charge.refunded":
        return this.refund(object as Stripe.Charge);
    }
  }

  /** The account the mode may change (and, for a synthetic event, a test account). */
  private async ensureAccount(workspace: string) {
    if (this.checked.has(workspace)) return;
    const account = await this.deps.account(workspace);
    if (!account) throw new Rejected("unknown_account", workspace);
    if (!accountAllowedInMode(this.mode, account)) throw new Rejected("account_mode", workspace);
    if (this.synthetic && !this.deps.isE2eAccount(account.email)) throw new Rejected("not_e2e_account", workspace);
    this.checked.add(workspace);
    if (isLocalEmail(account.email)) this.local.add(workspace);
    this.workspace = workspace;
  }

  private async subscription(
    id: string,
    expected: string | null = null,
  ): Promise<{ outcome: EventOutcome; state: SubscriptionState | null }> {
    const sub = await this.deps.loadSubscription(id, this.event);
    const scheduleId = idOf(sub.schedule);
    const schedule = scheduleId ? await this.deps.loadSchedule(scheduleId, this.event) : null;
    const mapped = subscriptionState(sub, schedule, this.deps.now());
    if (!mapped.ok) {
      if (mapped.problem === "incomplete") {
        this.detail.status = sub.status;
        return { outcome: "ignored", state: null };
      }
      throw new Rejected(mapped.problem, mapped.workspace ?? expected);
    }
    const { state } = mapped;
    if (expected && expected !== state.workspace) throw new Rejected("workspace_mismatch", expected);
    await this.ensureAccount(state.workspace);
    this.detail.subscription = state.subscriptionRef;
    this.detail.status = state.status;
    const answer = await this.deps.applySubscription(state, this.mode, this.eventAt);
    if (answer.outcome === "rejected") throw new Rejected("db_rejected", state.workspace);
    if (answer.reason) this.detail.reason = answer.reason;
    // Stripe gave up collecting: the workspace is read-only from now on, the owner hears of it.
    if (state.endedForNonPayment && answer.outcome !== "stale" && !this.local.has(state.workspace)) {
      this.detail.ended = "payment_failed";
      await this.deps.alert({
        kind: "final_failure",
        workspace: state.workspace,
        mode: this.mode,
        ref: state.subscriptionRef,
        planKey: state.planKey,
        billing: state.billing,
      });
    }
    return { outcome: answer.outcome, state };
  }

  private async checkoutCompleted(session: Stripe.Checkout.Session): Promise<EventOutcome> {
    this.detail.object = session.id;
    if (session.mode !== "subscription") return "ignored";
    const subId = idOf(session.subscription);
    const reference = isWorkspaceId(session.client_reference_id)
      ? session.client_reference_id.toLowerCase()
      : workspaceOf(session.metadata);
    if (!subId) throw new Rejected("no_workspace", reference);
    const { outcome, state } = await this.subscription(subId, reference);
    const currency = asCurrency(state?.currency);
    if (state && currency) {
      await this.deps.track(
        { name: "checkout_completed", props: { plan: state.planKey, billing: state.billing, currency } },
        state.workspace,
      );
    }
    return outcome;
  }

  private async invoice(object: Stripe.Invoice, status: "paid" | "failed"): Promise<EventOutcome> {
    if (!object.id) return "ignored";
    this.detail.object = object.id;
    const invoice = await this.deps.loadInvoice(object.id, this.event);
    const fromInvoice = paymentFromInvoice(invoice, status, this.eventAt);
    // The subscription first: its period moves with the invoice, and it names the workspace.
    let sub: { outcome: EventOutcome; state: SubscriptionState | null } | null = null;
    if (fromInvoice.subscriptionRef) sub = await this.subscription(fromInvoice.subscriptionRef, fromInvoice.workspace);
    const subState = sub?.state ?? null;
    // What it paid for: the subscription's plan, the lines' period (else the subscription's).
    const payment: PaymentState = {
      ...fromInvoice,
      plan: subState ? { planKey: subState.planKey, billing: subState.billing } : null,
      period:
        fromInvoice.period ??
        (subState?.periodStart && subState.periodEnd
          ? { start: subState.periodStart, end: subState.periodEnd }
          : null),
    };
    const workspace = subState?.workspace ?? payment.workspace;
    if (!workspace) {
      // An invoice of no subscription of Gradus (made by hand in Stripe).
      return sub?.outcome ?? "ignored";
    }
    await this.ensureAccount(workspace);
    const answer = await this.deps.recordPayment(payment, status, workspace, this.mode, this.eventAt);
    if (answer.outcome === "rejected") throw new Rejected("db_rejected", workspace);
    const moved = answer.outcome === "applied" && answer.previous_status !== status;
    const state = sub?.state ?? null;
    // An invoice of 0 (the trial's start, a free month) is recorded, but nobody paid.
    if (status === "paid" && moved && payment.amount > 0) {
      const currency = asCurrency(payment.currency);
      if (state && currency) {
        await this.deps.track(
          {
            name: "payment_succeeded",
            props: { plan: state.planKey, billing: state.billing, currency, first: answer.first === true },
          },
          workspace,
        );
      }
      if (answer.first === true && !this.local.has(workspace)) {
        await this.deps.alert({
          kind: "first_payment",
          workspace,
          mode: this.mode,
          ref: payment.invoiceRef,
          planKey: state?.planKey ?? null,
          billing: state?.billing ?? null,
          amount: payment.amount,
          currency: payment.currency,
        });
      }
    } else if (status === "failed" && answer.outcome === "applied") {
      await this.deps.track(
        {
          name: "payment_failed",
          props: {
            attempt: Math.min(payment.attempt, 100),
            ...(state ? { plan: state.planKey, billing: state.billing } : {}),
          },
        },
        workspace,
      );
    }
    return merge(answer.outcome, sub?.outcome ?? answer.outcome);
  }

  private async refund(charge: Stripe.Charge): Promise<EventOutcome> {
    this.detail.object = charge.id;
    if (!isFullRefund(charge)) {
      this.detail.reason = "partial_refund";
      return "ignored";
    }
    const invoiceId = await this.deps.invoiceOfCharge(charge, this.event);
    if (!invoiceId) {
      this.detail.reason = "no_invoice";
      return "ignored";
    }
    const invoice = await this.deps.loadInvoice(invoiceId, this.event);
    const payment = paymentFromInvoice(invoice, "refunded", this.eventAt);
    let workspace = payment.workspace;
    let plan: PaidPlanKey | undefined;
    if (payment.subscriptionRef) {
      const sub = await this.deps.loadSubscription(payment.subscriptionRef, this.event);
      const mapped = subscriptionState(sub, null, this.deps.now());
      if (mapped.ok) {
        workspace = mapped.state.workspace;
        plan = mapped.state.planKey;
      } else {
        workspace = workspace ?? mapped.workspace;
      }
    }
    if (!workspace) throw new Rejected("no_workspace", null);
    await this.ensureAccount(workspace);
    this.detail.invoice = payment.invoiceRef;
    const answer = await this.deps.recordPayment(payment, "refunded", workspace, this.mode, this.eventAt);
    if (answer.outcome === "rejected") throw new Rejected("db_rejected", workspace);
    const currency = asCurrency(payment.currency);
    if (answer.outcome === "applied" && answer.previous_status !== "refunded" && currency) {
      await this.deps.track(
        { name: "payment_refunded", props: { currency, ...(plan ? { plan } : {}) } },
        workspace,
      );
    }
    return answer.outcome;
  }
}
