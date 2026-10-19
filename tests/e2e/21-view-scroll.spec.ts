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

/** Scrolls until the control is a little below the top and returns the position. */
async function scrollTo(page: Page, control: Locator, offset: number) {
  await control.evaluate((element, by) => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, top - by));
  }, offset);
  await expect(control).toBeInViewport();
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
  if (await skip.isVisible()) await skip.click();
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

    // Milestones → Pipeline from halfway down.
    const before = await scrollTo(page, tabs, 120);
    await tabs.getByRole("link", { name: t("admin.users.sections.pipeline") }).click();
    await expect(page).toHaveURL(/tab=pipeline/);
    await expect(tabs.getByRole("link", { name: t("admin.users.sections.pipeline") })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(main).not.toHaveAttribute("aria-busy", "true");
    expect(Math.abs((await scrollY(page)) - before)).toBeLessThanOrEqual(50);

    // A shared control (the period) from the same place: the page stays. The
    // active filter shows as a label above the content, so the browser keeps
    // the content in place on screen rather than the raw scroll offset.
    await scrollTo(page, tabs, 120);
    const tabsTop = () => tabs.evaluate((element) => Math.round(element.getBoundingClientRect().top));
    const onScreen = await tabsTop();
    await page.getByRole("radio", { name: exact(L, "admin.controls.periods.7d") }).click();
    await expect(page).toHaveURL(/period=7d/);
    await expect(page).toHaveURL(/tab=pipeline/);
    await expect(main).not.toHaveAttribute("aria-busy", "true");
    expect(Math.abs((await tabsTop()) - onScreen)).toBeLessThanOrEqual(50);
    expect(await scrollY(page)).toBeGreaterThan(60);

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
    expect(Math.abs((await scrollY(page)) - before)).toBeLessThanOrEqual(50);
  });
});
