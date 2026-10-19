import type { Locator, Page } from "@playwright/test";
import { admin, seedContacts, signIn, type Account } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { totp } from "./support/totp";
import { dismissCelebrationsAutomatically, mainNav } from "./support/ui";

/**
 * Switching a tab or a filter keeps the page where it was (step 14.2): no
 * scroll to the top and no short skeleton that pulls the page up. The menu
 * still starts another section at the top.
 */

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);
const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));
/** How far the page can scroll now: a shorter tab may not reach the old position. */
const maxScroll = (page: Page) =>
  page.evaluate(() => Math.round(document.documentElement.scrollHeight - window.innerHeight));

/** Scrolls until the control is a little below the top and returns the position. */
async function scrollTo(page: Page, control: Locator, offset: number) {
  await control.evaluate((element, by) => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, top - by));
  }, offset);
  await expect(control).toBeInViewport();
  return mustBeScrolled(page);
}

/** Scrolls the page itself down by `by` pixels (for controls in a sticky bar) and returns the position. */
async function scrollDown(page: Page, by: number) {
  await page.evaluate((y) => window.scrollTo(0, y), by);
  return mustBeScrolled(page);
}

async function mustBeScrolled(page: Page) {
  const y = await scrollY(page);
  expect(y, "the page must be scrolled for the test to mean anything").toBeGreaterThan(60);
  return y;
}

async function signInToAdmin(page: Page, account: Account) {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000";
  await page.context().addCookies([{ name: "locale", value: L, url: baseURL }]);
  await page.goto("/admin/prihlaseni");
  await page.locator("#admin-email").fill(account.email);
  await page.locator("#admin-password").fill(account.password);
  await page.getByRole("button", { name: exact(L, "admin.login.submit") }).click();
  await expect(page.getByText(t("admin.login.secretLabel"))).toBeVisible();
  const secret = (await page.locator("code").first().textContent())?.trim() ?? "";
  await page.locator("#admin-code").fill(totp(secret));
  await page.getByRole("button", { name: exact(L, "admin.login.enrollSubmit") }).click();
  const skip = page.getByRole("button", { name: exact(L, "admin.login.backupSkip") });
  const overview = page.getByRole("link", { name: exact(L, "admin.shell.nav.features") });
  await expect(skip.or(overview)).toBeVisible();
  // On the sign-in page the code's new session cookies render the page again,
  // which goes straight on: the offer can vanish between seeing and clicking it.
  await skip.click({ timeout: 3_000 }).catch(() => undefined);
  await expect(overview).toBeVisible();
}

test.describe("a short window", () => {
  test.use({ viewport: { width: 1440, height: 560 } });

  test("21 · the feature tabs and the shared controls keep the scroll position", async ({
    page,
    accounts,
  }) => {
    const owner = await accounts.create({ label: "viewscroll" });
    const { error } = await admin().from("user_roles").insert({ user_id: owner.id, role: "owner" });
    if (error) throw error;
    await signInToAdmin(page, owner);

    await page.goto("/admin/funkce");
    const tabs = page.getByRole("navigation", { name: t("admin.features.tabs") });
    const main = page.locator("main");
    await expect(tabs.getByRole("link", { name: t("admin.users.sections.milestones") })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(main).not.toHaveAttribute("aria-busy", "true");

    // Milestones → Pipeline from halfway down. The tabs sit in the sticky page
    // bar (step 14.6), so the page is scrolled under them.
    const before = await scrollDown(page, 400);
    expect(before, "the milestones tab must reach the position").toBe(400);
    await tabs.getByRole("link", { name: t("admin.users.sections.pipeline") }).click();
    await expect(page).toHaveURL(/tab=pipeline/);
    await expect(tabs.getByRole("link", { name: t("admin.users.sections.pipeline") })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(main).not.toHaveAttribute("aria-busy", "true");
    expect(Math.abs((await scrollY(page)) - Math.min(before, await maxScroll(page)))).toBeLessThanOrEqual(50);

    // A shared control (the period, also in the sticky bar) from the same
    // place: the page stays where it was.
    const beforePeriod = await scrollDown(page, 400);
    await page.getByRole("radio", { name: exact(L, "admin.controls.periods.7d") }).click();
    await expect(page).toHaveURL(/period=7d/);
    await expect(page).toHaveURL(/tab=pipeline/);
    await expect(main).not.toHaveAttribute("aria-busy", "true");
    expect(Math.abs((await scrollY(page)) - Math.min(beforePeriod, await maxScroll(page)))).toBeLessThanOrEqual(50);

    // Another section from the menu starts at the top, as it should.
    await page.getByRole("link", { name: exact(L, "admin.shell.nav.ai") }).click();
    await expect(page).toHaveURL(/\/admin\/ai/);
    await expect.poll(() => scrollY(page)).toBeLessThanOrEqual(50);
  });

  test("21 · switching the contact table keeps the scroll position", async ({ page, accounts }) => {
    const account = await accounts.create({ label: "tablescroll", mode: "tool" });
    await seedContacts(
      account,
      Array.from({ length: 30 }, (_, index) => ({ company_name: `E2E Posun ${index + 1}` })),
    );
    const { data: tables, error } = await admin()
      .from("contact_tables")
      .select("id, name, system_key")
      .eq("user_id", account.id);
    if (error) throw error;
    const unreached = tables!.find((table) => table.system_key === "unreached")!;

    await signIn(page, account);
    await dismissCelebrationsAutomatically(page, L);
    await mainNav(page, L).getByRole("link", { name: t("nav.contacts") }).click();
    await expect(page).toHaveURL(/\/app\/kontakty$/);
    await expect(page.getByText("E2E Posun 30", { exact: true }).first()).toBeVisible();

    const chip = page.getByRole("button", { name: new RegExp(unreached.name) });
    const before = await scrollTo(page, chip, 120);
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(new RegExp(`table=${unreached.id}`));
    await expect(page.getByText("E2E Posun 1", { exact: true }).first()).toBeVisible();
    expect(Math.abs((await scrollY(page)) - Math.min(before, await maxScroll(page)))).toBeLessThanOrEqual(50);
  });
});
