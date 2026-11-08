import type { Page } from "@playwright/test";
import { admin, e2eEmail, signIn } from "./support/accounts";
import { expect, test, watchConsole } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { openApp, waitForApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

test.use({ reducedMotion: "reduce" });

/** Opens "Invite a worker" in Company and fills the name and the short id or e-mail. */
async function invite(page: Page, name: string, target: string) {
  await openApp(page, "/app/firma");
  await page
    .getByRole("button", { name: exact(L, "workers.add") })
    .first()
    .click();
  const form = page.getByRole("dialog", { name: t("workers.form.newTitle") });
  await form.locator("#worker-name").fill(name);
  await form.locator("#worker-email").fill(target);
  await form.getByRole("button", { name: exact(L, "workers.form.create") }).click();
}

/**
 * 22.5: the owner invites an existing account by its short id → the invite
 * waits in that account's app (bell) → it is accepted there → the company is
 * in the switcher → the owner's subscription shows nothing extra for a
 * worker with a plan of their own. Then a new person by e-mail: a link, and
 * 290 Kč extra on the owner's beta.
 */
test("49 · invite by short id → accept → in the switcher → 0 Kč extra; a new person → 290 Kč extra", async ({
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
  const { data: profile, error } = await db.from("profiles").select("public_id").eq("id", person.id).single();
  if (error) throw error;
  expect(profile.public_id).toMatch(/^[2-9A-HJKMNP-TV-Z]{6}$/);

  // An id nobody has is refused in the field, nothing is created.
  await signIn(page, boss);
  await invite(page, "E2E Nikdo", "ZZZZZZ");
  await expect(page.getByText(t("workers.errors.targetNotFound"))).toBeVisible();
  await page.keyboard.press("Escape");

  // The short id, typed in lower case: the invite waits in the person's app.
  await invite(page, "E2E Pozvaný", profile.public_id!.toLowerCase());
  const sent = page.getByRole("dialog", { name: t("workers.form.inviteSent") });
  await expect(sent.getByTestId("invite-waiting-card")).toBeVisible();
  await sent.getByRole("button", { name: exact(L, "workers.form.done") }).click();
  await expect(page.getByTestId("invite-waiting").first()).toBeVisible();

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

  // The owner: the person has a plan of their own (beta from a code), so nothing extra.
  await openApp(page, "/app/firma");
  await expect(page.locator('[data-testid="seat-chip"][data-seat="own"]')).toHaveText(t("workers.company.seat.own"));
  await openApp(page, "/app/nastaveni/predplatne");
  await expect(page.getByTestId("subscription-workers-extra")).toHaveText(/\b0\s*Kč/);

  // A new person by e-mail: the link as before, and the owner pays for the seat.
  await invite(page, "E2E Nový", e2eEmail("invite-new"));
  const ready = page.getByRole("dialog", { name: t("workers.form.inviteReady") });
  await expect(ready.getByRole("textbox", { name: t("workers.invite.link") })).toHaveValue(/invite=/);
  await ready.getByRole("button", { name: exact(L, "workers.form.done") }).click();
  await expect(page.locator('[data-testid="seat-chip"][data-seat="extra"]')).toContainText(/290\s*Kč/);
  await openApp(page, "/app/nastaveni/predplatne");
  await expect(page.getByTestId("subscription-workers-extra")).toHaveText(/290\s*Kč/);
});
