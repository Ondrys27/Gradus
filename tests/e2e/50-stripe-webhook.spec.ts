import { admin, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { text } from "./support/i18n";
import { openApp } from "./support/ui";
import { DAY, invoiceObject, secret, send, subscriptionObject, tag } from "./support/stripe";

/**
 * Payments through Stripe (step 23.1) without a network call to Stripe: the
 * test signs synthetic events (evt_e2e_…, test mode) with the test
 * STRIPE_WEBHOOK_SECRET and posts them to the webhook, which outside
 * production and only for e2e-…@gradus.local accounts takes the objects the
 * events carry. Paid: Settings → Subscription shows the active plan and the
 * payment with its receipt; a failed payment: the past-due banner. The same
 * event twice is processed once.
 */

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);
const PATH = "/app/nastaveni/predplatne";

test("50 · Stripe webhook: paid → active plan and receipt, failed → past-due banner", async ({
  page,
  accounts,
}) => {
  test.skip(!secret, "STRIPE_WEBHOOK_SECRET is not set");
  test.setTimeout(120_000);
  const account = await accounts.create({ label: "stripe" });
  const now = Math.floor(Date.now() / 1000);
  const subId = `sub_e2e_${tag()}`;

  // A bad signature is refused before anything is read.
  const forged = await page.request.post("/api/stripe/webhook", {
    data: "{}",
    headers: { "stripe-signature": "t=1,v1=bad", "content-type": "application/json" },
  });
  expect(forged.status()).toBe(400);

  const active = subscriptionObject(account, subId, "active", now);
  const created = await send(page.request, "customer.subscription.created", active, now);
  expect(created).toMatchObject({ status: 200, body: { outcome: "applied" } });
  // The same event again is processed once.
  const again = await send(page.request, "customer.subscription.created", active, now, created.id);
  expect(again).toMatchObject({ status: 200, body: { outcome: "duplicate" } });

  const paid = await send(page.request, "invoice.paid", invoiceObject(active, true, now + 1), now + 1);
  expect(paid).toMatchObject({ status: 200, body: { outcome: "applied" } });

  const { data: sub, error } = await admin()
    .from("subscriptions")
    .select("plan_key, status, provider, provider_ref, stripe_mode")
    .eq("user_id", account.id)
    .single();
  if (error) throw error;
  expect(sub).toEqual({ plan_key: "pro", status: "active", provider: "stripe", provider_ref: subId, stripe_mode: "test" });

  await signIn(page, account);
  await openApp(page, PATH);
  await expect(page.getByTestId("subscription-status")).toHaveText(t("subscription.status.active"));
  const payments = page.getByTestId("subscription-payments");
  await expect(payments.getByText(t("subscription.payments.statuses.paid"))).toBeVisible();
  await expect(payments.getByTestId("subscription-receipt")).toHaveAttribute(
    "href",
    "https://invoice.stripe.com/i/e2e/receipt",
  );
  await expect(page.getByTestId("subscription-past-due")).toHaveCount(0);

  // The next invoice fails: past due, the banner says so.
  const pastDue = subscriptionObject(account, subId, "past_due", now);
  const failed = await send(page.request, "invoice.payment_failed", invoiceObject(pastDue, false, now + 30 * DAY), now + 2);
  expect(failed).toMatchObject({ status: 200, body: { outcome: "applied" } });
  await page.reload();
  await expect(page.getByTestId("subscription-past-due")).toBeVisible();
  await expect(page.getByTestId("subscription-status")).toHaveText(t("subscription.status.pastDue"));
  await expect(payments.getByText(t("subscription.payments.statuses.failed"))).toBeVisible();

  // An older event arriving late never overwrites the newer state.
  const late = await send(page.request, "customer.subscription.updated", active, now - 60);
  expect(late).toMatchObject({ status: 200, body: { outcome: "stale" } });

  // Analytics: keys only.
  const { data: events } = await admin()
    .from("analytics_events")
    .select("event, props")
    .eq("user_id", account.id)
    .in("event", ["payment_succeeded", "payment_failed"]);
  expect(events?.map((row) => row.event).sort()).toEqual(["payment_failed", "payment_succeeded"]);
  expect(JSON.stringify(events)).not.toContain("890");
});
