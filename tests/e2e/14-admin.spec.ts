import type { Page } from "@playwright/test";
import { admin, signIn, type Account } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { totp } from "./support/totp";

/**
 * The gate of the administration (step 14.1): without a live admin session
 * every page leads to the sign-in, which remembers the page asked for. The
 * owner continues there after the second factor; anyone else gets the 404
 * after the password.
 */

/** The administration speaks the language of the locale cookie; the test pins it. */
const L = "cs";

async function pinLocale(page: Page) {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000";
  await page.context().addCookies([{ name: "locale", value: L, url: baseURL }]);
}

async function enterPassword(page: Page, account: Account) {
  await page.locator("#admin-email").fill(account.email);
  await page.locator("#admin-password").fill(account.password);
  await page.getByRole("button", { name: exact(L, "admin.login.submit") }).click();
}

test("14 · /admin without an admin session leads to the sign-in, with a way back", async ({
  page,
}) => {
  await pinLocale(page);
  // Through the browser session, without following the redirect.
  for (const [path, target] of [
    ["/admin", "/admin/prihlaseni"],
    ["/admin/uzivatele", "/admin/prihlaseni?next=%2Fadmin%2Fuzivatele"],
  ]) {
    const response = await page.request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    const location = new URL(response.headers().location, "http://local");
    expect(location.pathname + location.search, path).toBe(target);
  }

  await page.goto("/admin/uzivatele");
  await expect(page).toHaveURL(/\/admin\/prihlaseni\?next=%2Fadmin%2Fuzivatele$/);
  await expect(page.locator("#admin-email")).toBeVisible();
  await expect(
    page.getByRole("link", { name: exact(L, "admin.login.backToApp", { appName: "Gradus" }) }),
  ).toHaveAttribute("href", "/app");
});

test("14 · a signed-in account that is not the owner gets the 404 after the password", async ({
  page,
  accounts,
  consoleErrors,
}) => {
  const account = await accounts.create({ label: "notadmin" });
  await signIn(page, account);
  await pinLocale(page);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/prihlaseni$/);
  await enterPassword(page, account);
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
  await expect(page.locator("#admin-code")).toHaveCount(0);
  // The 404 is the point here; the browser reports exactly that answer, nothing else.
  const expected = consoleErrors.filter((error) =>
    /admin\/prihlaseni\] Failed to load resource: .* status of 404/.test(error),
  );
  expect(expected).toHaveLength(1);
  consoleErrors.splice(consoleErrors.indexOf(expected[0]), 1);
  // The app session is untouched and the administration stays closed.
  const response = await page.request.get("/admin/uzivatele", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
});

test("14 · the owner without the second factor signs in and returns to the page asked for", async ({
  page,
  accounts,
}) => {
  const owner = await accounts.create({ label: "gateowner" });
  const { error: roleError } = await admin()
    .from("user_roles")
    .insert({ user_id: owner.id, role: "owner" });
  if (roleError) throw roleError;

  // Signed in to the app (aal1): the administration still asks for the sign-in.
  await signIn(page, owner);
  await pinLocale(page);
  await page.goto("/admin/ai");
  await expect(page).toHaveURL(/\/admin\/prihlaseni\?next=%2Fadmin%2Fai$/);

  await enterPassword(page, owner);
  // A new owner sets up the authenticator; the secret is printed under the QR code.
  await expect(page.getByText(text(L, "admin.login.secretLabel"))).toBeVisible();
  const secret = (await page.locator("code").first().textContent())?.trim() ?? "";
  expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  await page.locator("#admin-code").fill(totp(secret));
  await page.getByRole("button", { name: exact(L, "admin.login.enrollSubmit") }).click();
  // The offer of a backup device may show, or the refreshed session goes straight on.
  const skip = page.getByRole("button", { name: exact(L, "admin.login.backupSkip") });
  const form = page.getByTestId("ai-caps-form");
  await expect(skip.or(form)).toBeVisible();
  if (await skip.isVisible()) await skip.click();

  await expect(page).toHaveURL(/\/admin\/ai$/);
  await expect(form).toBeVisible();
});
