import type { Browser, Page } from "@playwright/test";
import { admin, signIn, type Account } from "./support/accounts";
import { expect, test, watchConsole } from "./support/fixtures";
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

/** Owner role for a fresh account. */
async function makeOwner(account: Account) {
  const { error } = await admin().from("user_roles").insert({ user_id: account.id, role: "owner" });
  if (error) throw error;
}

/** The secret printed under the QR code of the authenticator being set up. */
async function readSecret(page: Page) {
  await expect(page.getByText(text(L, "admin.login.secretLabel"))).toBeVisible();
  const secret = (await page.locator("code").first().textContent())?.trim() ?? "";
  expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  return secret;
}

/**
 * Sends a code and waits for the server action's answer: the code's new
 * session cookies make Next.js render the sign-in page again in that answer,
 * which is exactly the moment the backup offer used to vanish.
 */
async function submitCode(page: Page, code: string, button: "enrollSubmit" | "verifySubmit") {
  await page.locator("#admin-code").fill(code);
  const answer = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().includes("/admin/prihlaseni"),
  );
  await page.getByRole("button", { name: exact(L, `admin.login.${button}`) }).click();
  // Only the headers: when the page goes on to /admin, the body is never read to the end.
  await answer;
}

/** The next 30-second window, so a code is never the one just used. */
async function nextCodeWindow(page: Page) {
  await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
}

/**
 * Remembers in the tab (across page loads) whether the backup offer was ever
 * on screen, even for a moment.
 */
async function watchForBackupOffer(page: Page) {
  const title = text(L, "admin.login.backupTitle");
  await page.addInitScript((wanted) => {
    const check = () => {
      for (const heading of document.querySelectorAll("h1")) {
        if (heading.textContent?.trim() === wanted) sessionStorage.setItem("sawBackupOffer", "1");
      }
    };
    new MutationObserver(check).observe(document, { childList: true, subtree: true });
  }, title);
  return async () => page.evaluate(() => sessionStorage.getItem("sawBackupOffer") === "1");
}

/**
 * An admin who already has the authenticator signs in again in a fresh
 * browser: password, the code, straight into /admin with no backup offer, and
 * the sign-in page itself goes straight on afterwards too.
 */
async function signInAgain(browser: Browser, account: Account, secret: string) {
  const context = await browser.newContext({ locale: "cs-CZ", timezoneId: "Europe/Prague" });
  const errors: string[] = [];
  watchConsole(context, errors);
  try {
    const page = await context.newPage();
    await pinLocale(page);
    const sawOffer = await watchForBackupOffer(page);
    await page.goto("/admin/prihlaseni");
    await enterPassword(page, account);
    await expect(
      page.getByRole("heading", { name: exact(L, "admin.login.verifyTitle") }),
    ).toBeVisible();
    await submitCode(page, totp(secret), "verifySubmit");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("link", { name: exact(L, "admin.shell.nav.ai") }).first()).toBeVisible();
    expect(await sawOffer(), "backup offer on an ordinary sign-in").toBe(false);

    await page.goto("/admin/prihlaseni?next=%2Fadmin%2Fai");
    await expect(page).toHaveURL(/\/admin\/ai$/);
    expect(await sawOffer(), "backup offer on an ordinary sign-in").toBe(false);
    expect(errors, "errors in the browser console").toEqual([]);
  } finally {
    await context.close();
  }
}

test("14 · the owner without the second factor signs in, may skip the backup and returns to the page asked for", async ({
  page,
  browser,
  accounts,
}) => {
  test.setTimeout(180_000);
  const owner = await accounts.create({ label: "gateowner" });
  await makeOwner(owner);

  // Signed in to the app (aal1): the administration still asks for the sign-in.
  await signIn(page, owner);
  await pinLocale(page);
  await page.goto("/admin/ai");
  await expect(page).toHaveURL(/\/admin\/prihlaseni\?next=%2Fadmin%2Fai$/);

  await enterPassword(page, owner);
  // A new owner sets up the authenticator; after its first code the backup
  // device is offered, and the offer stays until the owner decides.
  const secret = await readSecret(page);
  await submitCode(page, totp(secret), "enrollSubmit");
  const backupTitle = page.getByRole("heading", { name: exact(L, "admin.login.backupTitle") });
  await expect(backupTitle).toBeVisible();
  await page.waitForTimeout(1_500);
  await expect(backupTitle).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/prihlaseni\?next=%2Fadmin%2Fai$/);

  await page.getByRole("button", { name: exact(L, "admin.login.backupSkip") }).click();
  await expect(page).toHaveURL(/\/admin\/ai$/);
  await expect(page.getByTestId("ai-caps-form")).toBeVisible();

  // With the live admin session the sign-in page goes straight on.
  await page.goto("/admin/prihlaseni");
  await expect(page).toHaveURL(/\/admin$/);

  // The next sign-in with the one authenticator never offers the backup again.
  await nextCodeWindow(page);
  await signInAgain(browser, owner, secret);
});

test("14 · the owner adds a backup device right after the first code, and it signs in", async ({
  page,
  browser,
  accounts,
}) => {
  test.setTimeout(180_000);
  const owner = await accounts.create({ label: "backupowner" });
  await makeOwner(owner);
  await pinLocale(page);
  await page.goto("/admin/prihlaseni");
  await enterPassword(page, owner);

  const primary = await readSecret(page);
  await submitCode(page, totp(primary), "enrollSubmit");
  await expect(page.getByRole("heading", { name: exact(L, "admin.login.backupTitle") })).toBeVisible();
  await page.waitForTimeout(1_500);
  await page.getByRole("button", { name: exact(L, "admin.login.backupAdd") }).click();
  await expect(
    page.getByRole("heading", { name: exact(L, "admin.login.backupEnrollTitle") }),
  ).toBeVisible();
  const backup = await readSecret(page);
  expect(backup).not.toBe(primary);
  await submitCode(page, totp(backup), "enrollSubmit");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("link", { name: exact(L, "admin.shell.nav.ai") }).first()).toBeVisible();

  const { data: factors, error } = await admin().auth.admin.mfa.listFactors({ userId: owner.id });
  if (error) throw error;
  expect(factors.factors.filter((f) => f.factor_type === "totp" && f.status === "verified")).toHaveLength(2);

  // Either device signs in straight to /admin, with no offer.
  await nextCodeWindow(page);
  await signInAgain(browser, owner, backup);
});
