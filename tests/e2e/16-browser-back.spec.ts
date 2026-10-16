import { seedContacts, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { dismissCelebrationsAutomatically, mainNav } from "./support/ui";

const L = "cs" as const;
const t = (key: string) => text(L, key);

/**
 * The browser's Back and Forward around the app: from an open dialog, a
 * milestone's and a contact's detail, Cold Calling with its panel open and
 * the timer running. Every step lands on a working page without an error in
 * the console (the fixture fails the test on any).
 */
test("16 · browser Back and Forward across the app", async ({ page, accounts }) => {
  const account = await accounts.create({ label: "browser-back", mode: "game" });
  await seedContacts(account, [{ company_name: "E2E Back Firma", phone: "+420777111222" }]);
  await signIn(page, account);
  await dismissCelebrationsAutomatically(page, L);
  const nav = mainNav(page, L);
  const heading = page.locator("h1.page-title");
  /** A full page is there: the address and its heading. */
  const landed = async (url: RegExp, title: string | null) => {
    await expect(page).toHaveURL(url);
    if (title) await expect(heading).toHaveText(title);
    else await expect(heading).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };

  // Milestones: open the "new" dialog, press Back.
  await nav.getByRole("link", { name: t("nav.milestones") }).click();
  await expect(page).toHaveURL(/milniky$/);
  await page.getByRole("button", { name: exact(L, "milestones.actions.new") }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await landed(/\/app$/, null);
  await page.goForward();
  await landed(/\/app\/milniky$/, t("nav.milestones"));

  // Milestone detail.
  await page.getByRole("button", { name: exact(L, "milestones.actions.new") }).first().click();
  const form = page.getByRole("dialog", { name: t("milestones.form.createTitle") });
  await form.locator("#milestone-title").fill("E2E Back milník");
  await form.getByRole("button", { name: exact(L, "milestones.form.create") }).click();
  await expect(page).toHaveURL(/\/app\/milniky\/[0-9a-f-]{36}$/);
  await page.goBack();
  await landed(/\/app\/milniky$/, t("nav.milestones"));
  await page.goForward();
  await expect(page).toHaveURL(/\/app\/milniky\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "E2E Back milník" })).toBeVisible();

  // Contacts: detail, back.
  await nav.getByRole("link", { name: t("nav.contacts") }).click();
  await page.getByText("E2E Back Firma").first().click();
  await expect(page).toHaveURL(/kontakty\/[0-9a-f-]{36}/);
  await page.goBack();
  await landed(/\/app\/kontakty$/, t("nav.contacts"));

  // Cold calling: open the panel, back; start the timer, back.
  await nav.getByRole("link", { name: t("nav.coldCalling") }).click();
  await expect(page).toHaveURL(/cold-calling/);
  await page.getByRole("button", { name: /E2E Back Firma/ }).first().click();
  await expect(page.getByRole("dialog", { name: t("coldCalling.panel.title") })).toBeVisible();
  await page.goBack();
  await landed(/\/app\/kontakty$/, t("nav.contacts"));
  await page.goForward();
  await landed(/\/app\/cold-calling$/, t("nav.coldCalling"));
  await page.getByRole("button", { name: exact(L, "coldCalling.timer.start") }).first().click();
  await expect(page.getByText(t("coldCalling.timer.running")).first()).toBeVisible();
  await page.goBack();
  await landed(/\/app\/kontakty$/, t("nav.contacts"));
  await page.goForward();
  await landed(/\/app\/cold-calling$/, t("nav.coldCalling"));
  // The timer kept running on the server and shows so again.
  await expect(page.getByText(t("coldCalling.timer.running")).first()).toBeVisible();

  // Pipeline new deal dialog.
  await nav.getByRole("link", { name: t("nav.pipeline") }).click();
  await page.getByRole("button", { name: exact(L, "pipeline.actions.newDeal") }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await landed(/\/app\/cold-calling$/, t("nav.coldCalling"));
});
