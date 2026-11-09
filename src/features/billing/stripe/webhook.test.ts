import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { eventOf, fixture, WORKSPACE } from "./fixtures.test-helper";
import type { PaymentState, SubscriptionState } from "./mapping";
import {
  processStripeEvent,
  type AnalyticsCall,
  type ApplyAnswer,
  type ClaimResult,
  type OwnerAlert,
  type WebhookDeps,
  type WebhookProblem,
} from "./webhook";

/**
 * processStripeEvent() with an in-memory database that keeps the same rules
 * as billing_apply_subscription() / billing_record_payment() (an older event
 * is stale, a payment only moves forward), so the order of events, the
 * idempotency and the modes can be checked without Stripe or Postgres.
 */

type Row = { state: SubscriptionState; syncedAt: number };

function harness(overrides: Partial<WebhookDeps> = {}, options: { account?: { email: string | null; internal: boolean } | null } = {}) {
  const claims = new Map<string, "processing" | "done">();
  const subscriptions = new Map<string, Row>();
  const payments = new Map<string, { status: string; syncedAt: number }>();
  const tracked: AnalyticsCall[] = [];
  const alerts: OwnerAlert[] = [];
  const recorded: PaymentState[] = [];
  const reported: WebhookProblem[] = [];
  const finished: { id: string; outcome: string }[] = [];
  const stripeSubs = new Map<string, Stripe.Subscription>();
  const invoices = new Map<string, Stripe.Invoice>();
  const schedules = new Map<string, Stripe.SubscriptionSchedule>();

  const deps: WebhookDeps = {
    vercelEnv: "preview",
    keyMode: "test",
    now: () => new Date(1793491400 * 1000),
    claim: async (event): Promise<ClaimResult> => {
      const seen = claims.get(event.id);
      if (seen === "done") return "duplicate";
      if (seen === "processing") return "busy";
      claims.set(event.id, "processing");
      return "new";
    },
    finish: async (event, outcome) => {
      claims.set(event.id, "done");
      finished.push({ id: event.id, outcome });
    },
    loadSubscription: async (id) => {
      const sub = stripeSubs.get(id);
      if (!sub) throw new Error(`no ${id}`);
      return sub;
    },
    loadSchedule: async (id) => schedules.get(id) ?? null,
    loadInvoice: async (id) => {
      const invoice = invoices.get(id);
      if (!invoice) throw new Error(`no ${id}`);
      return invoice;
    },
    invoiceOfCharge: async () => "in_1Paid",
    account: async () =>
      options.account === undefined ? { email: "e2e-owner@gradus.local", internal: true } : options.account,
    isE2eAccount: (email) => !!email && /^e2e-.*@gradus\.local$/.test(email),
    applySubscription: async (state, _mode, eventAt): Promise<ApplyAnswer> => {
      const row = subscriptions.get(state.workspace);
      if (row && eventAt.getTime() < row.syncedAt) return { outcome: "stale" };
      subscriptions.set(state.workspace, { state, syncedAt: eventAt.getTime() });
      return { outcome: "applied", previous_status: row?.state.status, linked: !row };
    },
    recordPayment: async (payment, status, _workspace, _mode, eventAt) => {
      recorded.push(payment);
      const ranks = ["failed", "paid", "refunded"];
      const row = payments.get(payment.invoiceRef);
      if (row && ranks.indexOf(status) < ranks.indexOf(row.status)) return { outcome: "stale" };
      if (row && row.status === status && status !== "failed") return { outcome: "unchanged", previous_status: row.status };
      const first = status === "paid" && ![...payments.values()].some((p) => p.status !== "failed");
      payments.set(payment.invoiceRef, { status, syncedAt: eventAt.getTime() });
      return { outcome: "applied", previous_status: row?.status ?? null, first };
    },
    track: async (call) => {
      tracked.push(call);
    },
    alert: async (alert) => {
      alerts.push(alert);
    },
    report: (problem) => {
      reported.push(problem);
    },
    ...overrides,
  };
  return { deps, subscriptions, payments, tracked, alerts, recorded, reported, finished, stripeSubs, invoices, schedules };
}

const active = () => fixture<Stripe.Subscription>("subscription-active");
const withStatus = (sub: Stripe.Subscription, status: Stripe.Subscription.Status) =>
  ({ ...sub, status }) as Stripe.Subscription;

describe("subscription events", () => {
  it("writes the subscription as Stripe has it now, at the event's time", async () => {
    const h = harness();
    h.stripeSubs.set("sub_1Active", active());
    const event = eventOf("customer.subscription.updated", withStatus(active(), "past_due"));
    const result = await processStripeEvent(event, h.deps);
    expect(result).toEqual({ status: 200, body: { received: true, outcome: "applied" } });
    // Loaded from Stripe: active now, whatever the event carried.
    const row = h.subscriptions.get(WORKSPACE)!;
    expect(row.state).toMatchObject({ status: "active", planKey: "pro", subscriptionRef: "sub_1Active" });
    expect(row.syncedAt).toBe(event.created * 1000);
  });

  it("never lets an older event overwrite a newer state", async () => {
    const h = harness();
    h.stripeSubs.set("sub_1Active", withStatus(active(), "past_due"));
    await processStripeEvent(eventOf("customer.subscription.updated", active(), { created: 2000 }), h.deps);
    h.stripeSubs.set("sub_1Active", active());
    const late = await processStripeEvent(eventOf("customer.subscription.updated", active(), { created: 1000 }), h.deps);
    expect(late.body.outcome).toBe("stale");
    expect(h.subscriptions.get(WORKSPACE)?.state.status).toBe("past_due");
  });

  it("processes an event once: a second delivery is a duplicate, one meanwhile comes back later", async () => {
    const h = harness();
    h.stripeSubs.set("sub_1Active", active());
    let applied = 0;
    const apply = h.deps.applySubscription;
    h.deps.applySubscription = async (...args) => {
      applied += 1;
      return apply(...args);
    };
    const event = eventOf("customer.subscription.created", active(), { id: "evt_test_once" });
    expect((await processStripeEvent(event, h.deps)).body.outcome).toBe("applied");
    expect(await processStripeEvent(event, h.deps)).toEqual({ status: 200, body: { received: true, outcome: "duplicate" } });
    expect(applied).toBe(1);

    const busy = harness({ claim: async () => "busy" });
    expect((await processStripeEvent(event, busy.deps)).status).toBe(409);
  });

  it("ignores a subscription that never started and events it does not handle", async () => {
    const h = harness();
    const incomplete = fixture<Stripe.Subscription>("subscription-incomplete");
    h.stripeSubs.set(incomplete.id, incomplete);
    expect((await processStripeEvent(eventOf("customer.subscription.created", incomplete), h.deps)).body.outcome).toBe(
      "ignored",
    );
    expect((await processStripeEvent(eventOf("customer.created", {}), h.deps)).body.outcome).toBe("ignored");
    expect(h.subscriptions.size).toBe(0);
    expect(h.reported).toEqual([]);
  });

  it("answers 200 and records an unknown workspace or price, never a retry loop", async () => {
    const h = harness();
    const anonymous = { ...active(), metadata: {} } as Stripe.Subscription;
    h.stripeSubs.set("sub_1Active", anonymous);
    const result = await processStripeEvent(eventOf("customer.subscription.updated", anonymous), h.deps);
    expect(result).toEqual({ status: 200, body: { received: true, outcome: "rejected" } });
    const foreign = fixture<Stripe.Subscription>("subscription-foreign-price");
    h.stripeSubs.set(foreign.id, foreign);
    await processStripeEvent(eventOf("customer.subscription.updated", foreign), h.deps);
    const unknown = harness({}, { account: null });
    unknown.stripeSubs.set("sub_1Active", active());
    await processStripeEvent(eventOf("customer.subscription.updated", active()), unknown.deps);
    expect([...h.reported, ...unknown.reported]).toEqual(["no_workspace", "unknown_price", "unknown_account"]);
    expect(h.subscriptions.size + unknown.subscriptions.size).toBe(0);
  });
});

describe("modes", () => {
  it("refuses a live event outside production and a test event in production", async () => {
    const preview = harness();
    preview.stripeSubs.set("sub_1Active", active());
    const live = await processStripeEvent(eventOf("customer.subscription.updated", active(), { livemode: true }), preview.deps);
    expect(live).toEqual({ status: 200, body: { received: true, outcome: "rejected" } });
    expect(preview.reported).toEqual(["wrong_env_mode"]);

    const production = harness({ vercelEnv: "production", keyMode: "live" });
    production.stripeSubs.set("sub_1Active", active());
    await processStripeEvent(eventOf("customer.subscription.updated", active()), production.deps);
    expect(production.reported).toEqual(["wrong_env_mode"]);
    expect(production.subscriptions.size + preview.subscriptions.size).toBe(0);
  });

  it("refuses an event of the other mode than the key, and an account the mode may not change", async () => {
    const noKey = harness({ keyMode: null });
    await processStripeEvent(eventOf("customer.subscription.updated", active()), noKey.deps);
    expect(noKey.reported).toEqual(["key_mode"]);

    const customer = harness({}, { account: { email: "jana@example.com", internal: false } });
    customer.stripeSubs.set("sub_1Active", active());
    await processStripeEvent(eventOf("customer.subscription.updated", active()), customer.deps);
    expect(customer.reported).toEqual(["account_mode"]);
    expect(customer.subscriptions.size).toBe(0);

    const live = harness({ vercelEnv: "production", keyMode: "live" }, { account: { email: "e2e-x@gradus.local", internal: true } });
    live.stripeSubs.set("sub_1Active", active());
    await processStripeEvent(eventOf("customer.subscription.updated", active(), { livemode: true }), live.deps);
    expect(live.reported).toEqual(["account_mode"]);
  });

  it("takes a synthetic end-to-end event only for an end-to-end account, without a key", async () => {
    const synthetic = (h: ReturnType<typeof harness>) => {
      const sub = active();
      h.deps.loadSubscription = async (id, event) => {
        const object = event.data.object as Stripe.Subscription;
        if (object.id !== id) throw new Error("not embedded");
        return object;
      };
      return eventOf("customer.subscription.updated", sub, { id: "evt_e2e_1" });
    };
    const ok = harness({ keyMode: null });
    expect((await processStripeEvent(synthetic(ok), ok.deps)).body.outcome).toBe("applied");

    const internal = harness({ keyMode: null }, { account: { email: "ondrej@example.com", internal: true } });
    await processStripeEvent(synthetic(internal), internal.deps);
    expect(internal.reported).toEqual(["not_e2e_account"]);
    expect(internal.subscriptions.size).toBe(0);
  });
});

describe("checkout and invoices", () => {
  it("links the subscription after Checkout and records it once", async () => {
    const h = harness();
    h.stripeSubs.set("sub_1Active", active());
    const session = fixture<Stripe.Checkout.Session>("checkout-session-completed");
    await processStripeEvent(eventOf("checkout.session.completed", session), h.deps);
    expect(h.subscriptions.get(WORKSPACE)?.state.subscriptionRef).toBe("sub_1Active");
    expect(h.tracked).toEqual([
      { name: "checkout_completed", props: { plan: "pro", billing: "monthly", currency: "CZK" } },
    ]);
  });

  it("refuses a Checkout whose subscription names another workspace", async () => {
    const h = harness();
    h.stripeSubs.set("sub_1Active", active());
    const session = {
      ...fixture<Stripe.Checkout.Session>("checkout-session-completed"),
      client_reference_id: "22222222-2222-4222-8222-222222222222",
    };
    await processStripeEvent(eventOf("checkout.session.completed", session), h.deps);
    expect(h.reported).toEqual(["workspace_mismatch"]);
    expect(h.subscriptions.size).toBe(0);
  });

  it("records a paid invoice with the subscription's period, the first one as first", async () => {
    const h = harness();
    h.stripeSubs.set("sub_1Active", active());
    h.invoices.set("in_1Paid", fixture<Stripe.Invoice>("invoice-paid"));
    const event = eventOf("invoice.paid", { id: "in_1Paid", object: "invoice" });
    expect((await processStripeEvent(event, h.deps)).body.outcome).toBe("applied");
    expect(h.payments.get("in_1Paid")?.status).toBe("paid");
    expect(h.subscriptions.get(WORKSPACE)?.state.status).toBe("active");
    expect(h.tracked).toEqual([
      { name: "payment_succeeded", props: { plan: "pro", billing: "monthly", currency: "CZK", first: true } },
    ]);
    // The same invoice paid again (another event) is not a second payment.
    await processStripeEvent(eventOf("invoice.paid", { id: "in_1Paid", object: "invoice" }), h.deps);
    expect(h.tracked).toHaveLength(1);
  });

  it("records a failed attempt (workspace from the subscription), then the retry that paid", async () => {
    const h = harness();
    h.stripeSubs.set("sub_1Active", withStatus(active(), "past_due"));
    h.invoices.set("in_1Failed", fixture<Stripe.Invoice>("invoice-failed"));
    await processStripeEvent(eventOf("invoice.payment_failed", { id: "in_1Failed", object: "invoice" }), h.deps);
    expect(h.payments.get("in_1Failed")?.status).toBe("failed");
    expect(h.subscriptions.get(WORKSPACE)?.state.status).toBe("past_due");
    expect(h.tracked).toEqual([{ name: "payment_failed", props: { attempt: 2, plan: "pro", billing: "monthly" } }]);

    h.stripeSubs.set("sub_1Active", active());
    h.invoices.set("in_1Failed", { ...fixture<Stripe.Invoice>("invoice-failed"), amount_paid: 89000 } as Stripe.Invoice);
    await processStripeEvent(eventOf("invoice.paid", { id: "in_1Failed", object: "invoice" }, { created: 1793491500 }), h.deps);
    expect(h.payments.get("in_1Failed")?.status).toBe("paid");
    // A late failure of the same invoice changes nothing.
    await processStripeEvent(eventOf("invoice.payment_failed", { id: "in_1Failed", object: "invoice" }), h.deps);
    expect(h.payments.get("in_1Failed")?.status).toBe("paid");
  });

  it("records an invoice of 0 without counting it as a payment", async () => {
    const h = harness();
    h.stripeSubs.set("sub_1Active", active());
    h.invoices.set("in_1Paid", { ...fixture<Stripe.Invoice>("invoice-paid"), amount_paid: 0 } as Stripe.Invoice);
    await processStripeEvent(eventOf("invoice.paid", { id: "in_1Paid", object: "invoice" }), h.deps);
    expect(h.payments.get("in_1Paid")?.status).toBe("paid");
    expect(h.tracked).toEqual([]);
  });

  it("marks a payment refunded on a full refund only", async () => {
    const h = harness();
    h.stripeSubs.set("sub_1Active", active());
    h.invoices.set("in_1Paid", fixture<Stripe.Invoice>("invoice-paid"));
    await processStripeEvent(eventOf("invoice.paid", { id: "in_1Paid", object: "invoice" }), h.deps);
    const partial = { ...fixture<Stripe.Charge>("charge-refunded"), refunded: false, amount_refunded: 1000 };
    expect((await processStripeEvent(eventOf("charge.refunded", partial), h.deps)).body.outcome).toBe("ignored");
    expect(h.payments.get("in_1Paid")?.status).toBe("paid");
    await processStripeEvent(eventOf("charge.refunded", fixture<Stripe.Charge>("charge-refunded")), h.deps);
    expect(h.payments.get("in_1Paid")?.status).toBe("refunded");
    expect(h.tracked.at(-1)).toEqual({ name: "payment_refunded", props: { currency: "CZK", plan: "pro" } });
  });
});

describe("managing payments (step 23.2)", () => {
  // Internal in test mode, but not @gradus.local: the owner hears about it.
  const customer = { account: { email: "ondrej@example.com", internal: true } };

  it("records what a payment paid for: the plan, and the period of its lines or else the subscription's", async () => {
    const h = harness();
    h.stripeSubs.set("sub_1Active", active());
    h.invoices.set("in_1Paid", {
      ...fixture<Stripe.Invoice>("invoice-paid"),
      lines: { object: "list", data: [{ period: { start: 1793491200, end: 1796169600 } }] },
    } as unknown as Stripe.Invoice);
    await processStripeEvent(eventOf("invoice.paid", { id: "in_1Paid", object: "invoice" }), h.deps);
    expect(h.recorded[0]).toMatchObject({
      plan: { planKey: "pro", billing: "monthly" },
      period: { start: "2026-11-01T00:00:00.000Z", end: "2026-12-02T00:00:00.000Z" },
    });

    const without = harness();
    without.stripeSubs.set("sub_1Active", active());
    without.invoices.set("in_1Paid", fixture<Stripe.Invoice>("invoice-paid"));
    await processStripeEvent(eventOf("invoice.paid", { id: "in_1Paid", object: "invoice" }), without.deps);
    expect(without.recorded[0]?.period).toEqual({
      start: new Date(1793491200 * 1000).toISOString(),
      end: new Date(1796169600 * 1000).toISOString(),
    });
  });

  it("tells the owner about an account's first payment once, never about @gradus.local", async () => {
    const h = harness({}, customer);
    h.stripeSubs.set("sub_1Active", active());
    h.invoices.set("in_1Paid", fixture<Stripe.Invoice>("invoice-paid"));
    await processStripeEvent(eventOf("invoice.paid", { id: "in_1Paid", object: "invoice" }), h.deps);
    await processStripeEvent(eventOf("invoice.paid", { id: "in_1Paid", object: "invoice" }), h.deps);
    expect(h.alerts).toEqual([
      {
        kind: "first_payment",
        workspace: WORKSPACE,
        mode: "test",
        ref: "in_1Paid",
        planKey: "pro",
        billing: "monthly",
        amount: 445,
        currency: "CZK",
      },
    ]);

    const local = harness();
    local.stripeSubs.set("sub_1Active", active());
    local.invoices.set("in_1Paid", fixture<Stripe.Invoice>("invoice-paid"));
    await processStripeEvent(eventOf("invoice.paid", { id: "in_1Paid", object: "invoice" }), local.deps);
    expect(local.payments.get("in_1Paid")?.status).toBe("paid");
    expect(local.alerts).toEqual([]);
  });

  it("past due keeps the app running; ended after the last attempt it is cancelled now and the owner hears of it", async () => {
    const h = harness({}, customer);
    h.stripeSubs.set("sub_1Active", withStatus(active(), "past_due"));
    h.invoices.set("in_1Failed", fixture<Stripe.Invoice>("invoice-failed"));
    await processStripeEvent(eventOf("invoice.payment_failed", { id: "in_1Failed", object: "invoice" }), h.deps);
    expect(h.subscriptions.get(WORKSPACE)?.state.status).toBe("past_due");
    expect(h.alerts).toEqual([]);

    const ended = fixture<Stripe.Subscription>("subscription-ended-unpaid");
    h.stripeSubs.set("sub_1Active", ended);
    await processStripeEvent(eventOf("customer.subscription.deleted", ended, { created: 1795000001 }), h.deps);
    const state = h.subscriptions.get(WORKSPACE)!.state;
    expect(state).toMatchObject({ status: "cancelled", cancelAtPeriodEnd: false, endedForNonPayment: true });
    // It ends when Stripe ended it, not at the end of the period nobody paid for.
    expect(state.periodEnd).toBe(new Date(1795000000 * 1000).toISOString());
    expect(h.alerts).toEqual([
      { kind: "final_failure", workspace: WORKSPACE, mode: "test", ref: "sub_1Active", planKey: "pro", billing: "monthly" },
    ]);
  });

  it("a subscription the user cancelled is not a failure", async () => {
    const h = harness({}, customer);
    const ended = fixture<Stripe.Subscription>("subscription-canceled");
    h.stripeSubs.set(ended.id, ended);
    await processStripeEvent(eventOf("customer.subscription.deleted", ended), h.deps);
    expect(h.subscriptions.get(WORKSPACE)?.state.endedForNonPayment).toBe(false);
    expect(h.alerts).toEqual([]);
  });
});
