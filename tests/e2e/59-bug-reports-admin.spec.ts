import type { Page } from "@playwright/test";
import { admin, e2eEmail, signIn, type Account } from "./support/accounts";
import { expect, test, watchConsole } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { totp } from "./support/totp";
import { openApp } from "./support/ui";

/**
 * 27.1: a report from an internal account (every e2e account is one) shows
 * in Administration → Feedback → Reports for an admin with the "internal"
 * label, whatever the internal switch says; a new one announces itself
 * without a reload; "Clear filters" keeps the controls; Grady files nothing
 * and offers the report form; /podpora files into the same list.
 */

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

/** Same as src/features/grady/server/e2e-model.ts: the echo stand-in instead of Anthropic. */
const E2E_MODEL_HEADER = "x-gradus-e2e-model";

test.use({ reducedMotion: "reduce" });

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
  await page.getByRole("button", { name: exact(L, "admin.login.backupSkip") }).click();
  await expect(page.getByRole("link", { name: exact(L, "admin.shell.nav.users") }).first()).toBeVisible();
}

async function sendReport(page: Page, description: string) {
  await page.keyboard.press("Control+Shift+B");
  const form = page.getByTestId("report-form");
  await expect(form).toBeVisible();
  await form.getByRole("textbox", { name: t("feedback.whatLabel") }).fill(description);
  await form.getByRole("button", { name: exact(L, "feedback.send") }).click();
  await expect(page.getByTestId("report-thanks")).toBeVisible();
}

test("59a · an internal account's report is in the admin's list, labelled, and new ones come without a reload", async ({
  page,
  browser,
  accounts,
  consoleErrors,
}) => {
  const tag = `E2E-HLASENI-${Math.random().toString(36).slice(2, 8)}`;
  const author = await accounts.create({ label: "report-author" });
  const reviewer = await accounts.create({ label: "report-admin" });
  const { error: roleError } = await admin().from("user_roles").insert({ user_id: reviewer.id, role: "admin" });
  if (roleError) throw roleError;

  await signIn(page, author);
  await openApp(page, "/app/kalendar");
  await sendReport(page, `${tag} první`);

  const adminContext = await browser.newContext({ locale: "cs-CZ", timezoneId: "Europe/Prague", reducedMotion: "reduce" });
  watchConsole(adminContext, consoleErrors);
  const adminPage = await adminContext.newPage();
  try {
    await signInToAdmin(adminPage, reviewer);
    await adminPage.goto("/admin/zpetna-vazba?tab=reports");
    // The internal accounts switch is off, the report is there all the same.
    const list = adminPage.getByTestId("bug-reports");
    const first = list.locator("li").filter({ hasText: `${tag} první` });
    await expect(first).toBeVisible();
    await expect(first.getByTestId("report-internal")).toHaveText(t("admin.feedback.internal"));

    // "Clear filters" keeps the controls of the bar (the meeting's bug).
    const bar = adminPage.getByTestId("admin-page-bar");
    await adminPage.locator("label", { hasText: t("admin.controls.internal") }).click();
    await expect(adminPage).toHaveURL(/internal=1/);
    await adminPage.getByRole("button", { name: exact(L, "admin.controls.clearFilters") }).click();
    await expect(adminPage).not.toHaveURL(/internal=1/);
    await expect(bar.getByRole("button", { name: exact(L, "admin.controls.refresh") })).toBeVisible();
    await expect(bar.getByRole("radiogroup", { name: exact(L, "admin.controls.period") })).toBeVisible();
    await expect(first).toBeVisible();

    // A second report while the list is open: a button with the count, no reload needed.
    await sendReport(page, `${tag} druhé`);
    const fresh = adminPage.getByTestId("new-reports");
    await expect(fresh).toBeVisible({ timeout: 45_000 });
    await fresh.click();
    await expect(list.locator("li").filter({ hasText: `${tag} druhé` })).toBeVisible();
  } finally {
    await adminContext.close();
  }
});

test("59b · Grady files no report: he offers the report form", async ({ page, accounts }) => {
  const account = await accounts.create({ label: "report-grady" });
  await signIn(page, account);
  await page.route("**/api/grady", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.continue({ headers: { ...route.request().headers(), [E2E_MODEL_HEADER]: "echo-notes" } });
  });
  await page.getByRole("button", { name: exact(L, "grady.open") }).click();
  const panel = page.getByRole("dialog", { name: t("grady.title") });
  await panel.getByRole("textbox", { name: t("grady.inputLabel") }).fill("Chci nahlásit chybu, kalendář se nenačítá");
  await panel.getByRole("button", { name: exact(L, "grady.send") }).click();
  const offer = panel.getByTestId("grady-report-problem");
  await expect(offer).toBeVisible({ timeout: 30_000 });
  const { count: before } = await admin()
    .from("bug_reports")
    .select("id", { count: "exact", head: true })
    .eq("user_id", account.id);
  expect(before).toBe(0);
  await offer.click();
  // The usual form, empty: the page and screenshot go with it, never the chat's text.
  const form = page.getByTestId("report-form");
  await expect(form).toBeVisible();
  await expect(form.getByRole("textbox", { name: t("feedback.whatLabel") })).toHaveValue("");
});

test("59c · the support page files into the same reports, signed out too", async ({ page }) => {
  const email = e2eEmail("support");
  const tag = `E2E-PODPORA-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await page.goto("/podpora");
    const form = page.getByTestId("support-form");
    await form.getByRole("textbox", { name: t("marketing.support.whatLabel") }).fill(tag);
    await form.getByRole("textbox", { name: t("marketing.support.emailLabel") }).fill(email);
    await form.getByTestId("support-send").click();
    await expect(page.getByTestId("support-thanks")).toBeVisible();
    const { data, error } = await admin()
      .from("bug_reports")
      .select("source, user_id, contact_email, page")
      .eq("description", tag)
      .single();
    if (error) throw error;
    expect(data).toEqual({ source: "support", user_id: null, contact_email: email, page: "/podpora" });
    // The footer of the site leads there.
    await page.goto("/");
    await expect(
      page.getByRole("contentinfo").getByRole("link", { name: exact(L, "marketing.footer.support") }),
    ).toHaveAttribute("href", "/podpora");
  } finally {
    await admin().from("bug_reports").delete().eq("contact_email", email);
  }
});
