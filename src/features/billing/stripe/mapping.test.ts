import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { seedPlanCatalog } from "@/features/plan/catalog-seed";
import { fixture, WORKSPACE } from "./fixtures.test-helper";
import {
  invoicePeriod,
  isFullRefund,
  paymentFromInvoice,
  storedStatusOf,
  subscriptionState,
  workspaceOf,
} from "./mapping";
import { catalogPriceSpecs, parseLookupKey, priceLookupKey, workerPeriodPrice } from "./prices";

const iso = (unix: number) => new Date(unix * 1000).toISOString();
const NOW = new Date(1793491400 * 1000);

describe("prices", () => {
  it("names a price by plan, currency, period and catalog version, and reads it back", () => {
    const key = { kind: "plan" as const, plan: "pro" as const, currency: "CZK" as const, billing: "monthly" as const, version: 4 };
    expect(priceLookupKey(key)).toBe("plan:pro:CZK:monthly:v4");
    expect(parseLookupKey("plan:pro:CZK:monthly:v4")).toEqual(key);
    expect(parseLookupKey("worker:team:EUR:yearly:v12")).toMatchObject({ kind: "worker", plan: "team", version: 12 });
    for (const bad of ["plan:beta:CZK:monthly:v1", "plan:pro:USD:monthly:v1", "plan:pro:CZK:weekly:v1", "pro", null]) {
      expect(parseLookupKey(bad)).toBeNull();
    }
  });

  it("makes a price per plan × currency × period, and one per extra worker where the plan takes them", () => {
    const catalog = seedPlanCatalog();
    const specs = catalogPriceSpecs(catalog, 2);
    const plans = specs.filter((spec) => spec.kind === "plan");
    expect(plans).toHaveLength(12);
    expect(new Set(specs.map((spec) => spec.lookupKey)).size).toBe(specs.length);
    const proMonthly = plans.find((spec) => spec.plan === "pro" && spec.currency === "CZK" && spec.billing === "monthly");
    const pro = catalog.find((plan) => plan.key === "pro")!;
    expect(proMonthly).toMatchObject({ unitAmount: Math.round(pro.monthly.CZK * 100), productId: "gradus_plan_pro" });
    const yearly = plans.find((spec) => spec.plan === "pro" && spec.currency === "EUR" && spec.billing === "yearly");
    expect(yearly?.unitAmount).toBe(Math.round(pro.yearly.EUR * 100));
    for (const plan of catalog) {
      const workers = specs.filter((spec) => spec.kind === "worker" && spec.plan === plan.key);
      expect(workers).toHaveLength(plan.per_worker ? 4 : 0);
    }
  });

  it("prices a yearly extra worker at twelve discounted months", () => {
    const team = seedPlanCatalog().find((plan) => plan.per_worker)!;
    const monthly = workerPeriodPrice(team, "CZK", "monthly")!;
    const yearly = workerPeriodPrice(team, "CZK", "yearly")!;
    expect(monthly).toBe(team.per_worker!.CZK);
    expect(yearly).toBeLessThanOrEqual(monthly * 12);
    expect(yearly).toBeGreaterThan(0);
  });
});

describe("subscription state", () => {
  it("maps an active subscription to plan, period, link and amount", () => {
    const sub = fixture<Stripe.Subscription>("subscription-active");
    const mapped = subscriptionState(sub, null, NOW);
    expect(mapped).toEqual({
      ok: true,
      state: {
        workspace: WORKSPACE,
        subscriptionRef: "sub_1Active",
        customerRef: "cus_1Owner",
        planKey: "pro",
        billing: "monthly",
        status: "active",
        periodStart: iso(1793491200),
        periodEnd: iso(1796169600),
        trialEnd: null,
        cancelAtPeriodEnd: false,
        scheduled: null,
        amount: 890,
        currency: "CZK",
        planItemId: "si_1Plan",
        workerItem: null,
        version: 2,
        endedForNonPayment: false,
      },
    });
  });

  it("reads a trial with extra workers and a downgrade held by a schedule", () => {
    const sub = fixture<Stripe.Subscription>("subscription-trialing-workers");
    const schedule = fixture<Stripe.SubscriptionSchedule>("schedule-downgrade");
    const mapped = subscriptionState(sub, schedule, NOW);
    if (!mapped.ok) throw new Error(mapped.problem);
    expect(mapped.state).toMatchObject({
      planKey: "team",
      billing: "yearly",
      status: "trialing",
      trialEnd: iso(1794009600),
      periodEnd: iso(1794009600),
      workerItem: { id: "si_1Workers", quantity: 2 },
      amount: 990 + 2 * 120,
      currency: "EUR",
      scheduled: { planKey: "pro", billing: "monthly", at: iso(1794009600) },
      version: 3,
    });
  });

  it("drops a schedule whose next phase is the plan already in force, or one that is over", () => {
    const sub = fixture<Stripe.Subscription>("subscription-trialing-workers");
    const schedule = fixture<Stripe.SubscriptionSchedule>("schedule-downgrade");
    const later = new Date(1794009600 * 1000 + 1000);
    const mapped = subscriptionState(sub, schedule, later);
    expect(mapped.ok && mapped.state.scheduled).toBeNull();
    const released = { ...schedule, status: "released" } as Stripe.SubscriptionSchedule;
    const again = subscriptionState(sub, released, NOW);
    expect(again.ok && again.state.scheduled).toBeNull();
  });

  it("a cancelled subscription is cancelled, not ending", () => {
    const mapped = subscriptionState(fixture<Stripe.Subscription>("subscription-canceled"), null, NOW);
    expect(mapped.ok && mapped.state).toMatchObject({ status: "cancelled", cancelAtPeriodEnd: false, planKey: "solo" });
  });

  it("an ended subscription ends when Stripe ended it, and says when it was for non-payment", () => {
    const unpaid = subscriptionState(fixture<Stripe.Subscription>("subscription-ended-unpaid"), null, NOW);
    expect(unpaid.ok && unpaid.state).toMatchObject({
      status: "cancelled",
      periodEnd: iso(1795000000),
      endedForNonPayment: true,
      scheduled: null,
    });
    // Without ended_at (an older object) the period's end stays.
    const cancelled = subscriptionState(fixture<Stripe.Subscription>("subscription-canceled"), null, NOW);
    expect(cancelled.ok && cancelled.state).toMatchObject({ periodEnd: iso(1796169600), endedForNonPayment: false });
  });

  it("marks an ending subscription by cancel_at too", () => {
    const sub = { ...fixture<Stripe.Subscription>("subscription-active"), cancel_at: 1796169600 } as Stripe.Subscription;
    const mapped = subscriptionState(sub, null, NOW);
    expect(mapped.ok && mapped.state.cancelAtPeriodEnd).toBe(true);
  });

  it("names its problems instead of guessing", () => {
    expect(subscriptionState(fixture<Stripe.Subscription>("subscription-incomplete"))).toEqual({
      ok: false,
      problem: "incomplete",
      workspace: WORKSPACE,
    });
    expect(subscriptionState(fixture<Stripe.Subscription>("subscription-foreign-price"))).toEqual({
      ok: false,
      problem: "unknown_price",
      workspace: WORKSPACE,
    });
    const anonymous = { ...fixture<Stripe.Subscription>("subscription-active"), metadata: {} } as Stripe.Subscription;
    expect(subscriptionState(anonymous)).toEqual({ ok: false, problem: "no_workspace", workspace: null });
    expect(workspaceOf({ workspace: "not-a-uuid" })).toBeNull();
  });

  it("maps every Stripe status", () => {
    expect(storedStatusOf("trialing")).toBe("trialing");
    expect(storedStatusOf("active")).toBe("active");
    expect(storedStatusOf("past_due")).toBe("past_due");
    expect(storedStatusOf("unpaid")).toBe("past_due");
    expect(storedStatusOf("paused")).toBe("past_due");
    expect(storedStatusOf("canceled")).toBe("cancelled");
    expect(storedStatusOf("incomplete")).toBeNull();
    expect(storedStatusOf("incomplete_expired")).toBeNull();
  });
});

describe("payments", () => {
  it("takes a paid invoice's amount, time, receipt and workspace", () => {
    const payment = paymentFromInvoice(fixture<Stripe.Invoice>("invoice-paid"), "paid", NOW);
    expect(payment).toEqual({
      invoiceRef: "in_1Paid",
      workspace: WORKSPACE,
      subscriptionRef: "sub_1Active",
      amount: 445,
      vatAmount: 0,
      currency: "CZK",
      paidAt: iso(1793491300),
      invoiceUrl: "https://invoice.stripe.com/i/acct_1/test_1Paid",
      attempt: 1,
      period: null,
      plan: null,
    });
  });

  it("covers the period of the invoice's lines, a proration included", () => {
    const invoice = {
      ...fixture<Stripe.Invoice>("invoice-paid"),
      lines: {
        object: "list",
        data: [
          { period: { start: 1794000000, end: 1796169600 } },
          { period: { start: 1793491200, end: 1796169600 } },
          { period: { start: 0, end: 0 } },
        ],
      },
    } as unknown as Stripe.Invoice;
    expect(invoicePeriod(invoice)).toEqual({ start: iso(1793491200), end: iso(1796169600) });
    expect(invoicePeriod(fixture<Stripe.Invoice>("invoice-paid"))).toBeNull();
  });

  it("takes what is due for a failed attempt and never a link that is not https", () => {
    const payment = paymentFromInvoice(fixture<Stripe.Invoice>("invoice-failed"), "failed", NOW);
    expect(payment).toMatchObject({
      amount: 890,
      paidAt: NOW.toISOString(),
      invoiceUrl: null,
      workspace: null,
      subscriptionRef: "sub_1Active",
      attempt: 2,
    });
  });

  it("counts the VAT inside the amount once Stripe Tax adds it", () => {
    const invoice = {
      ...fixture<Stripe.Invoice>("invoice-paid"),
      amount_paid: 121000,
      total_taxes: [{ amount: 21000, tax_behavior: "exclusive" }],
    } as unknown as Stripe.Invoice;
    expect(paymentFromInvoice(invoice, "paid", NOW)).toMatchObject({ amount: 1210, vatAmount: 210 });
  });

  it("a full refund only", () => {
    const charge = fixture<Stripe.Charge>("charge-refunded");
    expect(isFullRefund(charge)).toBe(true);
    expect(isFullRefund({ ...charge, refunded: false, amount_refunded: 100 } as Stripe.Charge)).toBe(false);
  });
});
