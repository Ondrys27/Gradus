import { admin, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { text } from "./support/i18n";
import { openApp } from "./support/ui";
import { invoiceObject, secret, send, subscriptionObject, tag } from "./support/stripe";

/**
 * A failed payment (step 23.2) with synthetic Stripe events, no network:
 * invoice.payment_failed → the owner sees "The payment did not go through,
 * update your card" above the app (the app keeps working) → the retry is
 * paid (invoice.paid) → the banner is gone; the payment history keeps the
 * plan it paid for. Then Stripe ends the subscription after the last failed
 * attempt (customer.subscription.deleted) → expired, read-only, nothing
 * deleted, and the card says the subscription ended.
 */

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

test("51 · Failed payment: banner while Stripe retries, gone once paid; ended after the last attempt = read-only", async ({
  page,
  accounts,
}) => {
  test.skip(!secret, "STRIPE_WEBHOOK_SECRET is not set");
  test.setTimeout(150_000);
  const account = await accounts.create({ label: "pastdue" });
  const now = Math.floor(Date.now() / 1000);
  const subId = `sub_e2e_${tag()}`;

  // Paying: active, the first invoice paid.
  const active = subscriptionObject(account, subId, "active", now);
  expect(await send(page.request, "customer.subscription.created", active, now)).toMatchObject({
    status: 200,
    body: { outcome: "applied" },
  });
  await send(page.request, "invoice.paid", invoiceObject(active, true, now + 1), now + 1);

  // The renewal fails: past due.
  const pastDue = subscriptionObject(account, subId, "past_due", now);
  const failedInvoice = invoiceObject(pastDue, false, now + 2);
  expect(await send(page.request, "invoice.payment_failed", failedInvoice, now + 2)).toMatchObject({
    status: 200,
    body: { outcome: "applied" },
  });

  await signIn(page, account);
  await openApp(page, "/app");
  const banner = page.getByTestId("past-due-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(t("subscription.pastDue.banner"));
  // The app runs as before while Stripe retries: not read-only.
  const { data: retrying } = await admin().rpc("current_plan", { _user_id: account.id });
  expect(retrying?.[0]).toMatchObject({ status: "past_due", read_only: false });

  // The retry is paid: the same invoice, later.
  const paidInvoice = {
    ...invoiceObject(active, true, now + 3),
    id: failedInvoice.id,
    attempt_count: 2,
  };
  expect(await send(page.request, "invoice.paid", paidInvoice, now + 3)).toMatchObject({
    status: 200,
    body: { outcome: "applied" },
  });
  await openApp(page, "/app");
  await expect(banner).toHaveCount(0);

  // The history says what each payment was for.
  await openApp(page, "/app/nastaveni/predplatne");
  const rows = page.getByTestId("subscription-payment");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText(t("plans.billing.monthly"));
  await expect(rows.first()).toContainText(t("subscription.payments.statuses.paid"));

  // Later a renewal fails for good: Stripe ends the subscription after the last attempt.
  const failedAgain = invoiceObject(pastDue, false, now + 4);
  await send(page.request, "invoice.payment_failed", failedAgain, now + 4);
  const ended = {
    ...subscriptionObject(account, subId, "canceled", now),
    ended_at: now + 5,
    canceled_at: now + 5,
    cancellation_details: { comment: null, feedback: null, reason: "payment_failed" },
  };
  expect(await send(page.request, "customer.subscription.deleted", ended, now + 5)).toMatchObject({
    status: 200,
    body: { outcome: "applied" },
  });

  const { data: plan } = await admin().rpc("current_plan", { _user_id: account.id });
  expect(plan?.[0]).toMatchObject({ status: "expired", read_only: true });
  await openApp(page, "/app");
  await expect(page.getByText(t("trial.subscriptionEnded.title"))).toBeVisible();
  await expect(banner).toHaveCount(0);
  // Nothing is deleted: the payments are all still there.
  const { count } = await admin()
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", account.id);
  expect(count).toBe(3);
  // A test account: the owner of the app hears nothing.
  const { count: alerts } = await admin()
    .from("billing_alerts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", account.id);
  expect(alerts).toBe(0);
});
