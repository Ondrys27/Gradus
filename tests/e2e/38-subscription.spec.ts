import { admin, signIn, type Account } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);
const PATH = "/app/nastaveni/predplatne";

async function subscriptionOf(account: Account) {
  const { data, error } = await admin()
    .from("subscriptions")
    .select("plan_key, status, scheduled_plan_key, cancel_at_period_end, cancel_reason, cancel_note")
    .eq("user_id", account.id)
    .single();
  if (error) throw error;
  return data;
}

async function eventsOf(account: Account, event: string) {
  const { data, error } = await admin()
    .from("analytics_events")
    .select("props")
    .eq("user_id", account.id)
    .eq("event", event);
  if (error) throw error;
  return data.map((row) => row.props as Record<string, unknown>);
}

test("38 · subscription: schedule a downgrade, cancel, resume", async ({ page, accounts }) => {
  test.setTimeout(120_000);
  const account = await accounts.create({ label: "subscription" });
  // A paid month of Pro, as the gateway (or the administration) would leave it,
  // and one test payment (only @gradus.local accounts ever get such rows).
  const { data: sub, error } = await admin()
    .from("subscriptions")
    .update({
      plan_key: "pro",
      status: "active",
      billing: "monthly",
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 20 * 86_400_000).toISOString(),
    })
    .eq("user_id", account.id)
    .select("id")
    .single();
  if (error) throw error;
  const { error: paymentError } = await admin().from("payments").insert({
    user_id: account.id,
    subscription_id: sub.id,
    amount: 890,
    currency: "CZK",
    status: "paid",
  });
  if (paymentError) throw paymentError;

  await signIn(page, account);
  await openApp(page, PATH);
  const status = page.getByTestId("subscription-status");
  await expect(status).toHaveText(t("subscription.status.active"));
  const payments = page.getByTestId("subscription-payments");
  await expect(payments.getByText(t("subscription.payments.statuses.paid"))).toBeVisible();
  await expect(
    payments.getByRole("button", {
      name: `${t("subscription.payments.download")}: ${t("subscription.payments.receiptsSoon")}`,
    }),
  ).toHaveAttribute("aria-disabled", "true");

  // Down to Solo: the confirmation says it waits for the end of the period.
  await page.getByRole("button", { name: exact(L, "subscription.actions.change") }).click();
  await page.getByTestId("subscription-pick-solo").click();
  const confirm = page.getByTestId("subscription-confirm");
  await expect(confirm.getByTestId("subscription-timing")).toContainText(
    t("subscription.change.scheduled", { date: "" }).split(",")[0].trim(),
  );
  await confirm.getByTestId("subscription-confirm-change").click();
  await expect(page.getByTestId("subscription-scheduled")).toBeVisible();
  await expect(status).toHaveText(t("subscription.status.active"));
  expect(await subscriptionOf(account)).toMatchObject({
    plan_key: "pro",
    status: "active",
    scheduled_plan_key: "solo",
  });

  // Cancel for the end of the period, with a reason and a note.
  await page.getByRole("button", { name: exact(L, "subscription.actions.cancel") }).click();
  const dialog = page.getByTestId("subscription-cancel");
  await dialog.getByLabel(t("subscription.cancel.reasons.too_expensive")).check();
  await dialog.getByLabel(t("subscription.cancel.noteLabel")).fill("E2E poznámka");
  await dialog.getByRole("button", { name: exact(L, "subscription.cancel.confirm") }).click();
  await expect(status).toContainText(t("subscription.status.ending", { date: "" }).trim());
  await expect(page.getByRole("button", { name: exact(L, "subscription.actions.change") })).toHaveCount(0);
  expect(await subscriptionOf(account)).toMatchObject({
    cancel_at_period_end: true,
    cancel_reason: "too_expensive",
    cancel_note: "E2E poznámka",
  });

  // Resume: active again, the scheduled downgrade still there.
  await page.getByRole("button", { name: exact(L, "subscription.actions.resume") }).click();
  await expect(status).toHaveText(t("subscription.status.active"));
  await expect(page.getByTestId("subscription-scheduled")).toBeVisible();
  expect(await subscriptionOf(account)).toMatchObject({
    cancel_at_period_end: false,
    cancel_reason: null,
    cancel_note: null,
    scheduled_plan_key: "solo",
  });

  // Analytics: keys only, never the note.
  const changes = await eventsOf(account, "subscription_change_requested");
  expect(changes).toEqual([
    expect.objectContaining({ from_plan: "pro", to_plan: "solo", when: "scheduled", direction: "downgrade" }),
  ]);
  const cancels = await eventsOf(account, "subscription_cancelled");
  expect(cancels).toEqual([expect.objectContaining({ reason: "too_expensive", with_note: true })]);
  expect(JSON.stringify(cancels)).not.toContain("E2E");
});
