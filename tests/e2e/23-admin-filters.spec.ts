import type { Page } from "@playwright/test";
import { admin, type Account } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { totp } from "./support/totp";

/**
 * Filters of the administration (step 14.5): on the Users page, switching on
 * internal accounts and then the plan "Beta" really changes the rows, the
 * active filters are labels with a cross and a count on the button, they stay
 * in the address across sections, and "Clear filters" brings the list back.
 * The test accounts are internal (@gradus.local), so by default none shows.
 */

const L = "cs";

async function signInToAdmin(page: Page, account: Account) {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000";
  await page.context().addCookies([{ name: "locale", value: L, url: baseURL }]);
  await page.goto("/admin/prihlaseni");
  await page.locator("#admin-email").fill(account.email);
  await page.locator("#admin-password").fill(account.password);
  await page.getByRole("button", { name: exact(L, "admin.login.submit") }).click();
  await expect(page.getByText(text(L, "admin.login.secretLabel"))).toBeVisible();
  const secret = (await page.locator("code").first().textContent())?.trim() ?? "";
  await page.locator("#admin-code").fill(totp(secret));
  await page.getByRole("button", { name: exact(L, "admin.login.enrollSubmit") }).click();
  const skip = page.getByRole("button", { name: exact(L, "admin.login.backupSkip") });
  const nav = page.getByRole("link", { name: exact(L, "admin.shell.nav.users") }).first();
  // The backup offer stays until it is skipped, then the sign-in goes on.
  await skip.click();
  await expect(nav).toBeVisible();
}

test("23 · admin filters change the rows, show as labels and stay in the address", async ({
  page,
  accounts,
}) => {
  const db = admin();
  const tag = `flt${Math.random().toString(36).slice(2, 8)}`;
  const owner = await accounts.create({ label: "filterowner" });
  await accounts.create({ label: `${tag}a` });
  const paying = await accounts.create({ label: `${tag}b` });
  const { error: roleError } = await db.from("user_roles").insert({ user_id: owner.id, role: "owner" });
  if (roleError) throw roleError;
  // One of the two is no longer on the beta plan.
  const { error: planError } = await db
    .from("subscriptions")
    .update({ plan_key: "pro", status: "active" })
    .eq("user_id", paying.id);
  if (planError) throw planError;

  await signInToAdmin(page, owner);
  await page.goto(`/admin/uzivatele?q=${tag}`);
  const rows = page.locator("tbody tr");

  // Internal accounts are left out by default: nothing of the tag.
  await expect(page.getByText(text(L, "admin.users.emptyTitle"))).toBeVisible();
  await expect(rows).toHaveCount(0);
  // The Users page has no period.
  await expect(page.getByRole("radiogroup", { name: exact(L, "admin.controls.period") })).toHaveCount(0);

  await page.locator("label", { hasText: text(L, "admin.controls.internal") }).click();
  await expect(page).toHaveURL(/internal=1/);
  await expect(rows).toHaveCount(2);

  // Plan: Beta from the filters panel.
  await page.getByRole("button", { name: exact(L, "admin.controls.filtersActive", { count: 1 }) }).click();
  await page.locator("#admin-segment-plan").click();
  await page.getByRole("option", { name: text(L, "admin.controls.segmentValues.plan.beta") }).click();
  await expect(page).toHaveURL(/plan=beta/);
  await expect(page).toHaveURL(new RegExp(`q=${tag}`));
  await expect(rows).toHaveCount(1);

  const betaLabel = `${text(L, "admin.controls.segmentKeys.plan")}: ${text(L, "admin.controls.segmentValues.plan.beta")}`;
  const chips = page.getByRole("list", { name: exact(L, "admin.controls.activeFilters") });
  await expect(
    chips.getByRole("button", { name: exact(L, "admin.controls.removeFilter", { filter: betaLabel }) }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: exact(L, "admin.controls.filtersActive", { count: 2 }) }),
  ).toBeVisible();

  // Another section keeps the filters, and so does the way back.
  await page.getByRole("link", { name: exact(L, "admin.shell.nav.growth") }).first().click();
  await expect(page).toHaveURL(/\/admin\/rust\?.*internal=1.*plan=beta/);
  await expect(chips.getByRole("button", { name: exact(L, "admin.controls.removeFilter", { filter: betaLabel }) })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/admin/uzivatele\\?.*q=${tag}.*plan=beta|plan=beta.*q=${tag}`));
  await expect(rows).toHaveCount(1);

  // Removing the plan label brings the other account back; clearing all hides both again.
  await chips
    .getByRole("button", { name: exact(L, "admin.controls.removeFilter", { filter: betaLabel }) })
    .click();
  await expect(rows).toHaveCount(2);
  await page.getByRole("button", { name: exact(L, "admin.controls.clearFilters") }).click();
  await expect(page).not.toHaveURL(/internal=1/);
  await expect(rows).toHaveCount(0);
  await expect(chips).toHaveCount(0);
});
