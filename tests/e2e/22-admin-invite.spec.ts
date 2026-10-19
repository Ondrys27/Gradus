import type { Browser, Page } from "@playwright/test";
import { admin, e2eEmail, e2ePassword, type Account } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { totp } from "./support/totp";

/**
 * Administrators (step 14.4): the owner invites someone, the link leads to a
 * new account, the authenticator and /admin. The same link fails the second
 * time. The admin does not see the Administrators section. Once removed, the
 * admin is out on the very next request.
 */

const L = "cs";

async function pinLocale(page: Page) {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000";
  await page.context().addCookies([{ name: "locale", value: L, url: baseURL }]);
}

/** A fresh authenticator after the password: read the secret, enter a code, skip the backup. */
async function enrollAuthenticator(page: Page) {
  await expect(page.getByText(text(L, "admin.login.secretLabel"))).toBeVisible();
  const secret = (await page.locator("code").first().textContent())?.trim() ?? "";
  expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  await page.locator("#admin-code").fill(totp(secret));
  await page.getByRole("button", { name: exact(L, "admin.login.enrollSubmit") }).click();
  const skip = page.getByRole("button", { name: exact(L, "admin.login.backupSkip") });
  const nav = page.getByRole("link", { name: exact(L, "admin.shell.nav.ai") }).first();
  await expect(skip.or(nav)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await expect(nav).toBeVisible();
}

async function signInOwner(page: Page, owner: Account) {
  await pinLocale(page);
  await page.goto("/admin/prihlaseni");
  await page.locator("#admin-email").fill(owner.email);
  await page.locator("#admin-password").fill(owner.password);
  await page.getByRole("button", { name: exact(L, "admin.login.submit") }).click();
  await enrollAuthenticator(page);
}

async function freshPage(browser: Browser) {
  const context = await browser.newContext({ locale: "cs-CZ", timezoneId: "Europe/Prague" });
  const page = await context.newPage();
  await pinLocale(page);
  return page;
}

test("22 · an invitation makes a new admin, works once, and removal locks them out", async ({
  page,
  browser,
  accounts,
}) => {
  const owner = await accounts.create({ label: "invowner" });
  const { error: roleError } = await admin()
    .from("user_roles")
    .insert({ user_id: owner.id, role: "owner" });
  if (roleError) throw roleError;

  // The owner creates the invitation; the link is shown once.
  await signInOwner(page, owner);
  await page.getByRole("link", { name: exact(L, "admin.shell.nav.admins") }).first().click();
  await expect(page).toHaveURL(/\/admin\/administratori$/);
  await page.getByRole("button", { name: exact(L, "admin.admins.invite.open") }).click();
  const adminEmail = e2eEmail("invadmin");
  accounts.register(adminEmail);
  await page.locator("#invite-email").fill(adminEmail);
  await page.getByRole("button", { name: exact(L, "admin.admins.invite.create") }).click();
  const link = page.getByTestId("admin-invite-link");
  await expect(link).toBeVisible();
  await expect(page.getByText(text(L, "admin.admins.invite.emailHint"))).toBeVisible();
  const invitePath = new URL((await link.textContent())?.trim() ?? "").pathname;
  expect(invitePath).toMatch(/^\/admin\/pozvanka\/[A-Za-z0-9_-]{43}$/);

  // The invited person: a new account, the authenticator, then /admin.
  const invited = await freshPage(browser);
  await invited.goto(invitePath);
  await expect(
    invited.getByRole("heading", { name: exact(L, "admin.invite.title", { appName: "Gradus" }) }),
  ).toBeVisible();
  await invited.locator("#admin-email").fill(adminEmail);
  await invited.locator("#admin-password").fill(e2ePassword());
  await invited.getByRole("button", { name: exact(L, "admin.invite.submit.signup") }).click();
  await enrollAuthenticator(invited);
  await expect(invited).toHaveURL(/\/admin$/);

  // The admin does not see the Administrators section, and its address is a 404.
  await expect(invited.getByRole("link", { name: exact(L, "admin.shell.nav.admins") })).toHaveCount(0);
  const hidden = await invited.goto("/admin/administratori");
  expect(hidden?.status()).toBe(404);

  // The same link a second time: one neutral message.
  const second = await freshPage(browser);
  await second.goto(invitePath);
  await expect(second.getByRole("heading", { name: exact(L, "admin.invite.invalidTitle") })).toBeVisible();
  await expect(second.locator("#admin-email")).toHaveCount(0);
  await second.context().close();

  // The owner sees the new admin and removes them.
  await page.goto("/admin/administratori");
  const row = page.getByTestId("admin-member").filter({ hasText: adminEmail });
  await expect(row).toContainText(text(L, "admin.admins.role.admin"));
  await expect(row).toContainText(text(L, "admin.admins.status.active"));
  await row.getByRole("button", { name: exact(L, "admin.admins.remove.open") }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: exact(L, "admin.admins.remove.confirm") })
    .click();
  await expect(row).toContainText(text(L, "admin.admins.status.removed"));

  // The removed admin's next request leads out of the administration.
  await invited.goto("/admin/rust");
  await expect(invited).toHaveURL(/\/admin\/prihlaseni/);
  await invited.context().close();
});
