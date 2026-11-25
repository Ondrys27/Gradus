import type { Browser, Page } from "@playwright/test";
import { admin, signIn, type Account } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { totp } from "./support/totp";
import { waitForAdmin } from "./support/ui";

/**
 * The administration's overview of widgets (step 29.2):
 *
 * 1. An error caused on purpose (/app/test-chyby, a tag of its own) shows up
 *    without a reload, within a minute, in the red badge at Operations →
 *    Errors and among the new errors of the Errors widget, and no e-mail is
 *    decided for it (the alerts are off).
 * 2. A changed board and a second tab (the ready Operations set) are kept
 *    across signing out and in again.
 * 3. A limited admin has no Money widgets: not on the board, not in the
 *    gallery, and their data route is a 404.
 */

const L = "cs" as const;
const CRASH_PATH = "/app/test-chyby";
const CRASH_MESSAGE = "Gradus crash test";

test.use({ reducedMotion: "reduce" });

function randomTag() {
  return Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
}

async function makeAdmin(account: Account, level: "full" | "limited") {
  const { error } = await admin().from("user_roles").insert({ user_id: account.id, role: "admin", level });
  if (error) throw error;
}

/** Password, a new authenticator, skip the backup; returns the authenticator's secret. */
async function signInToAdmin(page: Page, account: Account): Promise<string> {
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
  await expect(page.getByTestId("admin-dashboard")).toBeVisible();
  await waitForAdmin(page);
  return secret;
}

/** The next 30-second window, so a code is never the one just used. */
async function nextCodeWindow(page: Page) {
  await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
}

async function signInAgain(browser: Browser, account: Account, secret: string) {
  const context = await browser.newContext({ locale: "cs-CZ", timezoneId: "Europe/Prague" });
  const page = await context.newPage();
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000";
  await context.addCookies([{ name: "locale", value: L, url: baseURL }]);
  await page.goto("/admin/prihlaseni");
  await page.locator("#admin-email").fill(account.email);
  await page.locator("#admin-password").fill(account.password);
  await page.getByRole("button", { name: exact(L, "admin.login.submit") }).click();
  await expect(page.getByRole("heading", { name: exact(L, "admin.login.verifyTitle") })).toBeVisible();
  await page.locator("#admin-code").fill(totp(secret));
  await page.getByRole("button", { name: exact(L, "admin.login.verifySubmit") }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByTestId("admin-dashboard")).toBeVisible();
  await waitForAdmin(page);
  return { context, page };
}

function boardWidgets(page: Page) {
  return page.getByTestId("widget-grid").getByTestId("widget");
}

/** The crash is the point of the test: its own console messages are expected, nothing else. */
function dropExpectedCrashErrors(errors: string[]) {
  for (let index = errors.length - 1; index >= 0; index -= 1) {
    const error = errors[index]!;
    if (error.includes(CRASH_MESSAGE) || error.includes(CRASH_PATH)) errors.splice(index, 1);
  }
}

test("71 · a caused error lights up in the Errors widget and the badge within a minute, and no e-mail goes", async ({
  page,
  browser,
  accounts,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  const { data: setting } = await admin()
    .from("app_settings")
    .select("value")
    .eq("key", "error_alerts")
    .maybeSingle();
  const mode = (setting?.value as { mode?: string } | null)?.mode ?? "off";
  test.skip(mode !== "off", `the error e-mails are switched to "${mode}" in this database`);

  const user = await accounts.create({ label: "dash-error-user" });
  const watcher = await accounts.create({ label: "dash-error-admin" });
  await makeAdmin(watcher, "full");
  const adminContext = await browser.newContext({ locale: "cs-CZ", timezoneId: "Europe/Prague" });
  const adminPage = await adminContext.newPage();
  const tag = randomTag();
  let code = "";
  try {
    // The overview is open first: what follows must reach it without a reload.
    await signInToAdmin(adminPage, watcher);
    const errorsWidget = adminPage.getByTestId("widget-grid").locator('[data-widget="errors"]').first();
    await expect(errorsWidget).toBeVisible();
    const badge = adminPage.getByTestId("admin-sidebar").getByTestId("admin-error-badge");
    const before = Number((await badge.textContent({ timeout: 5_000 }).catch(() => "0"))?.replace("+", "") || 0);

    await signIn(page, user);
    await page.goto(`${CRASH_PATH}?tag=${tag}`);
    await expect(page.getByRole("heading", { name: exact(L, "errorPage.title") })).toBeVisible();
    code = (await page.getByTestId("error-code").textContent())?.trim() ?? "";
    expect(code).toMatch(/^GR-[A-Z0-9]{6}$/);

    // Within a minute (the overview asks every 60 s): the badge counts it …
    await expect
      .poll(async () => Number((await badge.textContent().catch(() => "0"))?.replace("+", "") || 0), {
        timeout: 75_000,
        intervals: [2_000],
      })
      .toBeGreaterThan(Math.min(before, 98));
    // … and the widget's detail lists it among the new errors, with a link into the log.
    await expect
      .poll(
        async () => {
          await errorsWidget.getByRole("button").first().click();
          const detail = adminPage.getByTestId("widget-detail");
          await expect(detail).toBeVisible();
          const found = await detail.locator(`[data-testid="errors-widget-group"][data-code="${code}"]`).count();
          await adminPage.keyboard.press("Escape");
          await expect(detail).toBeHidden();
          return found;
        },
        { timeout: 75_000, intervals: [10_000] },
      )
      .toBeGreaterThan(0);
    await errorsWidget.getByRole("button").first().click();
    const link = adminPage
      .getByTestId("widget-detail")
      .locator(`[data-testid="errors-widget-group"][data-code="${code}"]`)
      .getByTestId("errors-widget-link");
    await expect(link).toHaveAttribute("href", /\/admin\/chyby\?group=[0-9a-f]+/);

    // No e-mail: the alerts are off, nothing was decided to be sent.
    const { data: event } = await admin().from("error_events").select("id, alert").eq("code", code).single();
    expect(event?.alert).toBe("off");
    const { count } = await admin()
      .from("error_alert_sends")
      .select("id", { count: "exact", head: true })
      .eq("event_id", event!.id);
    expect(count).toBe(0);
  } finally {
    await adminContext.close();
    if (code) {
      const db = admin();
      const { data } = await db.from("error_events").select("id, fingerprint").eq("code", code).maybeSingle();
      if (data) {
        await db.from("error_events").delete().eq("fingerprint", data.fingerprint);
        await db.from("error_groups").delete().eq("fingerprint", data.fingerprint);
      }
    }
    dropExpectedCrashErrors(consoleErrors);
  }
});

test("71 · a rearranged overview and a second tab survive signing out", async ({ page, browser, accounts }) => {
  test.setTimeout(240_000);
  const account = await accounts.create({ label: "dash-layout-admin" });
  await makeAdmin(account, "full");
  const secret = await signInToAdmin(page, account);

  // The default overview of 29.2 starts with Errors (L).
  await expect(boardWidgets(page).first()).toHaveAttribute("data-widget", "errors");
  await page.getByTestId("board-edit").click();
  await expect(page.getByTestId("widget-board")).toHaveAttribute("data-editing", "true");
  const errors = page.getByTestId("widget-grid").locator('[data-widget="errors"]').first();
  await errors.getByTestId("widget-resize").click();
  await page.getByTestId("widget-size-XL").click();
  await expect(errors).toHaveAttribute("data-size", "XL");
  await page.getByTestId("board-edit").click();

  // A second tab from the ready Operations set.
  await page.getByTestId("board-new-tab").click();
  await page.getByTestId("admin-tab-template-operations").click();
  await expect(page.getByTestId("board-tab-name")).toHaveValue(text(L, "admin.widgets.board.templates.operations"));
  await page.getByTestId("board-tab-save").click();
  await expect(page.getByTestId("board-tab")).toHaveCount(2);
  await expect(page).toHaveURL(/board=/);
  await expect(page.getByTestId("widget-grid").locator('[data-widget="latency"]')).toBeVisible();

  // Saved on the server for this administrator.
  await expect
    .poll(async () => {
      const { data } = await admin()
        .from("admin_dashboard_layouts")
        .select("is_default, items")
        .eq("user_id", account.id);
      const main = data?.find((row) => row.is_default)?.items as { widget: string; size: string }[] | null;
      return {
        rows: data?.length ?? 0,
        errors: main?.find((item) => item.widget === "errors")?.size ?? null,
      };
    })
    .toEqual({ rows: 2, errors: "XL" });

  // Sign out (once the widgets have their numbers: a request still on its way
  // when the session ends is answered 404), then in again in a fresh browser.
  await page.waitForLoadState("networkidle");
  await page.getByTestId("admin-sidebar").getByRole("button", { name: exact(L, "admin.shell.signOut") }).click();
  await expect(page).toHaveURL(/\/admin\/prihlaseni|\/prihlaseni/);
  await nextCodeWindow(page);
  const again = await signInAgain(browser, account, secret);
  try {
    const board = again.page;
    await expect(board.getByTestId("widget-grid").locator('[data-widget="errors"]').first()).toHaveAttribute(
      "data-size",
      "XL",
    );
    await expect(board.getByTestId("board-tab")).toHaveCount(2);
    await board.getByTestId("board-tab").nth(1).click();
    await expect(board.getByTestId("widget-grid").locator('[data-widget="latency"]')).toBeVisible();
  } finally {
    await again.context.close();
  }
});

test("71 · a limited admin has no Money widgets", async ({ page, accounts }) => {
  test.setTimeout(120_000);
  const account = await accounts.create({ label: "dash-limited-admin" });
  await makeAdmin(account, "limited");
  await signInToAdmin(page, account);

  const grid = page.getByTestId("widget-grid");
  await expect(grid.locator('[data-widget="errors"]')).toBeVisible();
  for (const key of ["revenue", "margin", "failedPayments"]) {
    await expect(grid.locator(`[data-widget="${key}"]`)).toHaveCount(0);
  }

  await page.getByTestId("board-edit").click();
  await page.getByTestId("board-add").click();
  const gallery = page.getByTestId("widget-gallery");
  await expect(gallery).toBeVisible();
  await expect(gallery.locator('[data-widget="aiSpend"]').first()).toBeVisible();
  for (const key of ["revenue", "payingByPlan", "subscriptions", "failedPayments", "promo", "margin"]) {
    await expect(gallery.locator(`[data-testid="gallery-widget"][data-widget="${key}"]`)).toHaveCount(0);
  }
  await expect(gallery.getByRole("button", { name: exact(L, "admin.widgets.categories.money") })).toHaveCount(0);

  for (const key of ["revenue", "margin"]) {
    const response = await page.request.get(`/api/admin/widgets/${key}`);
    expect(response.status(), key).toBe(404);
  }
  expect((await page.request.get("/api/admin/widgets/errors")).status()).toBe(200);
});
