import type { Locator, Page } from "@playwright/test";
import { admin, signIn, type Account } from "./support/accounts";
import { expect, test, watchConsole } from "./support/fixtures";
import { exact, text, within } from "./support/i18n";
import { totp } from "./support/totp";

/**
 * The error page (step 15.2): /app/test-chyby crashes on purpose for test
 * accounts. The page apologises, shows a code (copied with one click), has no
 * Jarvis, and "Send feedback" stores one report in bug_reports under that
 * code (a second click sends nothing). The same code is in the client_error
 * event, and the administration finds the report by it.
 */

const L = "cs";
const CRASH_PATH = "/app/test-chyby";
const CRASH_MESSAGE = "Gradus crash test";
/** With `?later=1` the page renders, then crashes on this window event (src/features/errors/crash-test.ts). */
const CRASH_EVENT = "gradus:crash-test";

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
  await expect(
    page.getByRole("link", { name: exact(L, "admin.shell.nav.users") }).first(),
  ).toBeVisible();
}

/** The crash is the point of the test: its own console messages are expected, nothing else. */
function dropExpectedCrashErrors(errors: string[]) {
  const expected = errors.filter((error) => error.includes(CRASH_MESSAGE));
  expect(expected.length).toBeGreaterThan(0);
  for (const error of expected) errors.splice(errors.indexOf(error), 1);
}

test("25 · a crash shows the error page, and its feedback is found by the code", async ({
  page,
  browser,
  accounts,
  consoleErrors,
}) => {
  const db = admin();
  const account = await accounts.create({ label: "error-page" });
  const owner = await accounts.create({ label: "error-owner" });
  const { error: roleError } = await db
    .from("user_roles")
    .insert({ user_id: owner.id, role: "owner" });
  if (roleError) throw roleError;

  // A regular account (not @gradus.local) would get a 404; the test account crashes.
  await signIn(page, account);
  await page.goto(CRASH_PATH);
  await expect(page.getByRole("heading", { name: exact(L, "errorPage.title") })).toBeVisible();
  const code = (await page.getByTestId("error-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^GR-[A-Z0-9]{6}$/);
  await expect(page.getByRole("button", { name: within(L, "jarvis.open") })).toHaveCount(0);
  await expect(page.getByRole("link", { name: exact(L, "errorPage.home.app") })).toBeVisible();

  // Copy puts the code on the clipboard.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: exact(L, "errorPage.copy") }).click();
  await expect(page.getByRole("button", { name: exact(L, "errorPage.copied") })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);

  // Send feedback: the field appears; one report however often it is clicked.
  const reports: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/bug-report") {
      reports.push(request.url());
    }
  });
  await page.getByRole("button", { name: exact(L, "errorPage.feedback") }).click();
  await page.getByLabel(text(L, "errorPage.feedbackLabel")).fill("E2E: the crash test page");
  const send = page.getByRole("button", { name: exact(L, "errorPage.send") });
  await send.dblclick();
  await expect(page.getByText(text(L, "errorPage.thanks"))).toBeVisible();
  await expect(page.getByRole("button", { name: exact(L, "errorPage.feedback") })).toHaveCount(0);
  await expect(page.getByRole("button", { name: exact(L, "errorPage.send") })).toHaveCount(0);
  expect(reports).toHaveLength(1);

  // The row: the session's user, the page, the browser, no data.
  const { data: rows, error } = await db
    .from("bug_reports")
    .select(
      "user_id, source, status, description, page, browser, device, locale, app_version, error_message, viewport",
    )
    .eq("error_code", code);
  if (error) throw error;
  expect(rows).toEqual([
    {
      user_id: account.id,
      source: "error_page",
      status: "new",
      description: "E2E: the crash test page",
      page: CRASH_PATH,
      browser: "chrome",
      device: "desktop",
      locale: "cs",
      app_version: expect.stringMatching(/^[A-Za-z0-9._-]+$/),
      error_message: `Error: ${CRASH_MESSAGE}`,
      viewport: "1440x900",
    },
  ]);

  // The same code again (a repeated request) stores nothing new.
  const again = await page.request.post("/api/bug-report", {
    data: { code, page: CRASH_PATH, description: "twice" },
  });
  expect(again.status()).toBe(200);
  const { count } = await db
    .from("bug_reports")
    .select("id", { count: "exact", head: true })
    .eq("error_code", code);
  expect(count).toBe(1);

  // The error itself is in analytics under the same code (sent with the next batch).
  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("analytics_events")
          .select("props")
          .eq("user_id", account.id)
          .eq("event", "client_error");
        return (data ?? []).some((row) => (row.props as { code?: string }).code === code);
      },
      { timeout: 30_000 },
    )
    .toBe(true);

  // Back to the dashboard: Jarvis is there again.
  await page.getByRole("link", { name: exact(L, "errorPage.home.app") }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("button", { name: within(L, "jarvis.open") })).toBeVisible();
  dropExpectedCrashErrors(consoleErrors);

  // The administration finds the report by its code (internal accounts' too).
  const adminContext = await browser.newContext({ locale: "cs-CZ", timezoneId: "Europe/Prague" });
  const adminErrors: string[] = [];
  watchConsole(adminContext, adminErrors);
  const adminPage = await adminContext.newPage();
  try {
    await signInToAdmin(adminPage, owner);
    await adminPage.goto("/admin/zpetna-vazba");
    const search = adminPage.getByRole("searchbox", {
      name: text(L, "admin.feedback.searchPlaceholder"),
    });
    await search.fill(code.toLowerCase());
    await search.press("Enter");
    await expect(adminPage).toHaveURL(new RegExp(`code=${code.toLowerCase()}`));
    const list = adminPage.getByTestId("bug-reports");
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list).toContainText(code);
    await expect(list).toContainText("E2E: the crash test page");
    await expect(list).toContainText(CRASH_PATH);
    await expect(list).toContainText(text(L, "admin.feedback.reportStatus.new"));

    // A code nobody has: the empty answer names it.
    await adminPage.goto("/admin/zpetna-vazba?code=GR-ZZZZZZ");
    await expect(
      adminPage.getByText(text(L, "admin.feedback.reportsNotFound", { code: "GR-ZZZZZZ" })),
    ).toBeVisible();
    expect(adminErrors).toEqual([]);
  } finally {
    await adminContext.close();
  }
});

/**
 * One real click at the button's centre, after checking that nothing lies
 * over it there: a click an overlay swallows fails here instead of being
 * retried until it happens to land.
 */
async function clickOnce(page: Page, button: Locator) {
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  if (!box) throw new Error("button has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const onTop = await button.evaluate(
    (element, point) => element.contains(document.elementFromPoint(point.x, point.y)),
    { x, y },
  );
  expect(onTop, "nothing covers the button").toBe(true);
  await page.mouse.click(x, y);
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`25 · with Jarvis open, the error page takes the first click (${viewport.width} px)`, async ({
    page,
    accounts,
    consoleErrors,
  }) => {
    await page.setViewportSize(viewport);
    const account = await accounts.create({ label: "error-overlay" });
    await signIn(page, account);
    await page.goto(`${CRASH_PATH}?later=1`);

    // Jarvis is open when the page crashes.
    const openJarvis = page.getByRole("button", { name: within(L, "jarvis.open") });
    await openJarvis.click();
    const panel = page.getByRole("dialog", { name: exact(L, "jarvis.title") });
    await expect(panel).toBeVisible();
    await page.evaluate((name) => window.dispatchEvent(new Event(name)), CRASH_EVENT);

    // The error page is on top; Jarvis's panel and button are gone.
    await expect(page.getByRole("heading", { name: exact(L, "errorPage.title") })).toBeVisible();
    await expect(panel).toHaveCount(0);
    await expect(openJarvis).toHaveCount(0);

    // Copy: one click puts the code on the clipboard.
    const code = (await page.getByTestId("error-code").textContent())?.trim() ?? "";
    expect(code).toMatch(/^GR-[A-Z0-9]{6}$/);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await clickOnce(page, page.getByRole("button", { name: exact(L, "errorPage.copy") }));
    await expect(page.getByRole("button", { name: exact(L, "errorPage.copied") })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);

    // Send feedback: one click opens the note.
    await clickOnce(page, page.getByRole("button", { name: exact(L, "errorPage.feedback") }));
    await expect(page.getByLabel(text(L, "errorPage.feedbackLabel"))).toBeVisible();

    // Try again: one click brings the page back, with Jarvis's button and the panel closed.
    await clickOnce(page, page.getByRole("button", { name: exact(L, "errorPage.retry") }));
    await expect(page.getByRole("heading", { name: exact(L, "errorPage.title") })).toHaveCount(0);
    await expect(openJarvis).toBeVisible();
    await expect(panel).toHaveCount(0);
    dropExpectedCrashErrors(consoleErrors);
  });
}

test("25 · the crash page is not open signed out", async ({ page }) => {
  // Signed out, the app's pages send to the sign-in; nothing crashes.
  await page.goto(CRASH_PATH);
  await expect(page).toHaveURL(/\/prihlaseni/);
});
