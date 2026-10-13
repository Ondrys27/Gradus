import { asUser, e2eEmail, e2ePassword, seedContacts, signIn } from "./support/accounts";
import { expect, test, watchConsole } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { finishTour, mainNav, openApp, waitForApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

test("9 · a worker joins through the invite: with the contacts right sees contacts, never finance", async ({
  page,
  browser,
  accounts,
  consoleErrors,
}) => {
  const owner = await accounts.create({ label: "owner" });
  await seedContacts(owner, [{ company_name: "E2E Klient majitele" }]);
  await asUser(owner, async (client) => {
    const { error } = await client.from("transactions").insert({
      user_id: owner.id,
      type: "income",
      amount: 4321,
      occurred_on: new Date().toISOString().slice(0, 10),
      description: "E2E Tajný příjem",
    });
    if (error) throw error;
  });
  await signIn(page, owner);

  // The owner invites the worker with the contacts right only.
  const workerEmail = e2eEmail("worker");
  accounts.register(workerEmail);
  await openApp(page, "/app/pracovnici");
  await page.getByRole("button", { name: exact(L, "workers.add") }).first().click();
  const form = page.getByRole("dialog", { name: t("workers.form.newTitle") });
  await form.locator("#worker-name").fill("E2E Pracovník");
  await form.locator("#worker-email").fill(workerEmail);
  const contactsName = t("nav.contacts");
  const financeName = t("nav.finance");
  await form.getByRole("switch", { name: t("workers.permissions.viewSection", { section: contactsName }) }).click();
  await expect(form.getByRole("switch", { name: t("workers.permissions.viewSection", { section: contactsName }) })).toBeChecked();
  await expect(form.getByRole("switch", { name: t("workers.permissions.viewSection", { section: financeName }) })).not.toBeChecked();
  await form.getByRole("button", { name: exact(L, "workers.form.create") }).click();
  const ready = page.getByRole("dialog", { name: t("workers.form.inviteReady") });
  const code = await ready.getByRole("textbox", { name: t("workers.invite.code"), exact: true }).inputValue();
  expect(code).toBeTruthy();
  await ready.getByRole("button", { name: exact(L, "workers.form.done") }).click();

  // The worker registers from the link in a browser of their own.
  const workerContext = await browser.newContext({ locale: "cs-CZ", timezoneId: "Europe/Prague" });
  watchConsole(workerContext, consoleErrors);
  try {
    const worker = await workerContext.newPage();
    await worker.goto(`/registrace?invite=${encodeURIComponent(code)}`);
    await expect(worker.locator("#register-invite")).toHaveValue(code);
    await expect(worker.locator("#register-email")).toHaveValue(workerEmail);
    await worker.locator("#register-password").fill(e2ePassword());
    await worker.locator("form button[type=submit]").click();
    await expect(worker).toHaveURL(/\/app$/, { timeout: 60_000 });
    await waitForApp(worker);
    await finishTour(worker, L);

    const nav = mainNav(worker, L);
    await expect(nav.getByRole("link", { name: contactsName })).toBeVisible();
    await expect(nav.getByRole("link", { name: financeName })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: t("nav.workers") })).toHaveCount(0);

    await openApp(worker, "/app/kontakty");
    await expect(worker.locator("main").getByText("E2E Klient majitele").first()).toBeVisible();
    // Viewing only: no new contact button.
    await expect(worker.getByRole("button", { name: exact(L, "contacts.actions.newContact") })).toHaveCount(0);

    // Finance by its address: sent back home, nothing of the owner's money shown.
    await worker.goto("/app/finance");
    await expect(worker).toHaveURL(/\/app$/);
    await expect(worker.getByText("E2E Tajný příjem")).toHaveCount(0);
  } finally {
    await workerContext.close();
  }
});
