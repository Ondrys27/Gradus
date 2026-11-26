import type { Page } from "@playwright/test";
import { admin, e2eEmail, signIn } from "./support/accounts";
import { expect, test, watchConsole } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { openApp, waitForApp, toInviteAccess } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

test.use({ reducedMotion: "reduce" });

/** Opens "Invite a worker" in Company and picks who: somebody with the app, or somebody new. */
async function openInvite(page: Page, kind: "existing" | "new") {
  await openApp(page, "/app/firma");
  await page
    .getByRole("button", { name: exact(L, "workers.add") })
    .first()
    .click();
  const form = page.getByRole("dialog", { name: t("workers.form.newTitle") });
  await form.locator(`[data-tutorial="worker-invite-${kind}"]`).click();
  return form;
}

/** Somebody who already uses the app, by @username or short id: the lookup only. */
async function lookUp(page: Page, handle: string) {
  const form = await openInvite(page, "existing");
  await form.locator("#worker-account").fill(handle);
  await form.getByTestId("worker-find").click();
  return form;
}

/**
 * 22.5 + 28.1: the owner finds an existing account by its short id (exact
 * only) → a card with its name → Invite → the invite waits in that account's
 * app (bell) → it is accepted there → the company is in the switcher. Nothing
 * about paying for workers shows while WORKER_BILLING_VISIBLE is off. Then
 * a username lookup and a new person by e-mail (a link).
 */
test("49 · find by short id → card → accept → in the switcher; @username; a new person by e-mail; no worker prices", async ({
  page,
  browser,
  accounts,
  consoleErrors,
}) => {
  const boss = await accounts.create({ label: "invite-boss" });
  const person = await accounts.create({ label: "invite-person" });
  const db = admin();
  const named = await db.from("profiles").update({ company_name: "E2E Firma Pozvánka" }).eq("id", boss.id);
  if (named.error) throw named.error;
  const handle = `e2e_${Date.now().toString(36)}`.slice(0, 20);
  const renamed = await db
    .from("profiles")
    .update({ display_name: "E2E Pozvaný", username: handle })
    .eq("id", person.id);
  if (renamed.error) throw renamed.error;
  const { data: profile, error } = await db.from("profiles").select("public_id").eq("id", person.id).single();
  if (error) throw error;
  expect(profile.public_id).toMatch(/^[2-9A-HJKMNP-TV-Z]{6}$/);

  // An id nobody has is refused in the field, nothing is created.
  await signIn(page, boss);
  let form = await lookUp(page, "ZZZZZZ");
  await expect(form.getByText(t("workers.errors.accountNotFound"))).toBeVisible();
  // Only an exact username: a part of it finds nobody.
  await form.locator("#worker-account").fill(`@${handle.slice(0, -2)}`);
  await form.getByTestId("worker-find").click();
  await expect(form.getByText(t("workers.errors.accountNotFound"))).toBeVisible();
  await page.keyboard.press("Escape");

  // The short id, typed in lower case: the card, then the invite waits in the person's app.
  form = await lookUp(page, profile.public_id!.toLowerCase());
  await expect(form.getByTestId("invite-found-name")).toHaveText("E2E Pozvaný");
  await expect(form.getByTestId("invite-found-username")).toHaveText(`@${handle}`);
  await toInviteAccess(form);
  await form.getByRole("button", { name: exact(L, "workers.form.create") }).click();
  const sent = page.getByRole("dialog", { name: t("workers.form.inviteSent") });
  await expect(sent.getByTestId("invite-waiting-card")).toBeVisible();
  await sent.getByRole("button", { name: exact(L, "workers.form.done") }).click();
  await expect(page.getByTestId("invite-waiting").first()).toBeVisible();

  // Asked again: already invited.
  form = await lookUp(page, `@${handle}`);
  await expect(form.getByText(t("workers.errors.targetAlreadyMember"))).toBeVisible();
  await page.keyboard.press("Escape");

  const personContext = await browser.newContext({ locale: "cs-CZ", timezoneId: "Europe/Prague" });
  watchConsole(personContext, consoleErrors);
  const personPage = await personContext.newPage();
  try {
    await signIn(personPage, person);
    await expect(personPage.getByTestId("inbox-count")).toHaveText("1");
    await personPage.getByTestId("inbox-bell").click();
    await personPage.getByTestId("inbox-invite").click();
    await expect(personPage).toHaveURL(/\/app\/pozvanky$/);
    const card = personPage.getByTestId("invite-card");
    await expect(card.getByTestId("invite-title")).toContainText("E2E Firma Pozvánka");
    await card.getByTestId("invite-accept").click();
    await expect(personPage.getByTestId("invite-accepted")).toBeVisible();

    // The company is in the switcher; going there works.
    await personPage.getByTestId("invite-switch").click();
    await expect(personPage).toHaveURL(/\/app$/);
    await waitForApp(personPage);
    await expect(personPage.getByTestId("space-current")).toHaveText("E2E Firma Pozvánka");
  } finally {
    await personContext.close();
  }

  // Nothing about paying for workers (WORKER_BILLING_VISIBLE off).
  await openApp(page, "/app/firma");
  await expect(page.locator('[data-testid="seat-chip"][data-seat="own"]')).toHaveCount(0);
  await openApp(page, "/app/nastaveni/predplatne");
  await expect(page.getByTestId("subscription-current")).toBeVisible();
  await expect(page.getByTestId("subscription-workers-extra")).toHaveCount(0);

  // A new person by e-mail: the link as before, and no price on them.
  form = await openInvite(page, "new");
  await form.locator("#worker-name").fill("E2E Nový");
  await form.locator("#worker-email").fill(`  ${e2eEmail("invite-new").toUpperCase()} `);
  await toInviteAccess(form);
  await form.getByRole("button", { name: exact(L, "workers.form.create") }).click();
  const ready = page.getByRole("dialog", { name: t("workers.form.inviteReady") });
  await expect(ready.getByRole("textbox", { name: t("workers.invite.link") })).toHaveValue(/invite=/);
  await ready.getByRole("button", { name: exact(L, "workers.form.done") }).click();
  await expect(page.locator('[data-testid="seat-chip"][data-seat="extra"]')).toHaveCount(0);
  await expect(page.getByText(/290\s*Kč/)).toHaveCount(0);
});
