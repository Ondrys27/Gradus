import type { Page } from "@playwright/test";
import { admin, signIn } from "./support/accounts";
import { expect, test, watchConsole } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { openApp, waitForApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

test.use({ reducedMotion: "reduce" });

async function inviteById(page: Page, name: string, publicId: string) {
  await openApp(page, "/app/firma");
  await page.getByRole("button", { name: exact(L, "workers.add") }).first().click();
  const form = page.getByRole("dialog", { name: t("workers.form.newTitle") });
  await form.locator("#worker-name").fill(name);
  await form.locator("#worker-email").fill(publicId);
  await form.getByRole("button", { name: exact(L, "workers.form.create") }).click();
  const sent = page.getByRole("dialog", { name: t("workers.form.inviteSent") });
  await sent.getByRole("button", { name: exact(L, "workers.form.done") }).click();
}

/**
 * A walk-through of the company flow (15. 11.): an invite to an account that
 * expired takes no seat and can be sent again from the person's dashboard;
 * on the invited person's dashboard declining asks first and accepting
 * offers the company.
 */
test("61 · expired invite: no seat, send again · dashboard: decline asks, accept offers the company", async ({
  page,
  browser,
  accounts,
  consoleErrors,
}) => {
  const boss = await accounts.create({ label: "polish-boss" });
  const person = await accounts.create({ label: "polish-person" });
  const db = admin();
  await db.from("profiles").update({ company_name: "E2E Firma Doladění" }).eq("id", boss.id);
  const { data: profile, error } = await db.from("profiles").select("public_id").eq("id", person.id).single();
  if (error) throw error;

  await signIn(page, boss);
  await inviteById(page, "E2E Prošlý", profile.public_id!);

  // The invite runs out: the chip says so and the person takes no seat.
  const { data: worker } = await db
    .from("workers")
    .select("id")
    .eq("owner_id", boss.id)
    .eq("name", "E2E Prošlý")
    .single();
  const expired = await db
    .from("worker_invites")
    .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("worker_id", worker!.id);
  if (expired.error) throw expired.error;
  await openApp(page, "/app/firma");
  await expect(page.locator('[data-testid="seat-chip"][data-seat="expired"]')).toHaveText(
    t("workers.company.seat.expired"),
  );

  // Send again from the dashboard: a fresh invite waits in the person's app.
  await page.getByTestId("company-open-person").filter({ hasText: "E2E Prošlý" }).first().click();
  await page.getByTestId("worker-dashboard").waitFor();
  await page.getByTestId("invite-resend").click();
  await expect(page.getByTestId("invite-resend")).toHaveCount(0);
  const { data: open } = await db
    .from("worker_invites")
    .select("id, invitee_id, expires_at")
    .eq("worker_id", worker!.id);
  expect(open).toHaveLength(1);
  expect(open![0]!.invitee_id).toBe(person.id);
  expect(new Date(open![0]!.expires_at).getTime()).toBeGreaterThan(Date.now());

  // The person, on the dashboard: Decline asks first; Accept offers the company.
  const personContext = await browser.newContext({ locale: "cs-CZ", timezoneId: "Europe/Prague" });
  watchConsole(personContext, consoleErrors);
  const personPage = await personContext.newPage();
  try {
    await signIn(personPage, person);
    const card = personPage.getByTestId("waiting-invite");
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: exact(L, "dashboard.waiting.invite.decline") }).click();
    const confirm = personPage.getByRole("dialog", { name: t("invites.declineTitle") });
    await expect(confirm).toBeVisible();
    await personPage.keyboard.press("Escape");
    await expect(confirm).toHaveCount(0);
    await expect(card).toBeVisible();

    await card.getByTestId("waiting-invite-accept").click();
    const accepted = personPage.getByTestId("waiting-invite-accepted");
    await expect(accepted).toBeVisible();
    await accepted.getByRole("button", { name: exact(L, "dashboard.waiting.invite.goThere") }).click();
    await expect(personPage).toHaveURL(/\/app$/);
    await waitForApp(personPage);
    await expect(personPage.getByTestId("space-current")).toHaveText("E2E Firma Doladění");
  } finally {
    await personContext.close();
  }
});
