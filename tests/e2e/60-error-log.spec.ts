import type { Page } from "@playwright/test";
import { admin, signIn, type Account } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { totp } from "./support/totp";
import { waitForAdmin } from "./support/ui";

/**
 * Operations → Errors (step 27.2): an error caught on purpose
 * (/app/test-chyby, a tag of its own in the message, so its own fingerprint)
 * shows in the log under its code, with its occurrence and its user; marked
 * Resolved, it comes back as New with the label "came back" after it
 * happens again. The admin here is a limited one: triage is everyone's.
 * ⌘K finds a setting ("strop AI") and goes to it with the place highlighted.
 */

const L = "cs" as const;
const CRASH_PATH = "/app/test-chyby";
const CRASH_MESSAGE = "Gradus crash test";

test.use({ reducedMotion: "reduce" });

function randomTag() {
  return Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
}

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
  await expect(page.getByRole("link", { name: exact(L, "admin.shell.nav.errors") }).first()).toBeVisible();
}

async function crash(page: Page, tag: string): Promise<string> {
  await page.goto(`${CRASH_PATH}?tag=${tag}`);
  await expect(page.getByRole("heading", { name: exact(L, "errorPage.title") })).toBeVisible();
  const code = (await page.getByTestId("error-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^GR-[A-Z0-9]{6}$/);
  // The record is written in the background of the report.
  await expect
    .poll(async () => {
      const { data } = await admin().from("error_events").select("id").eq("code", code).maybeSingle();
      return Boolean(data);
    }, { timeout: 30_000 })
    .toBe(true);
  return code;
}

/** The crash is the point of the test: its own console messages are expected, nothing else. */
function dropExpectedCrashErrors(errors: string[]) {
  for (let index = errors.length - 1; index >= 0; index -= 1) {
    const error = errors[index]!;
    if (error.includes(CRASH_MESSAGE) || error.includes(CRASH_PATH)) errors.splice(index, 1);
  }
}

test("60 · a caught error is in the log, is resolved, and comes back as new when it happens again", async ({
  page,
  browser,
  accounts,
  consoleErrors,
}) => {
  const user = await accounts.create({ label: "error-log-user" });
  const reviewer = await accounts.create({ label: "error-log-admin" });
  const role = await admin().from("user_roles").insert({ user_id: reviewer.id, role: "admin", level: "limited" });
  if (role.error) throw role.error;
  const tag = randomTag();
  let fingerprint: string | null = null;
  const adminPage = await (await browser.newContext()).newPage();

  try {
    await signIn(page, user);
    const first = await crash(page, tag);
    const { data: event } = await admin().from("error_events").select("fingerprint").eq("code", first).single();
    fingerprint = event!.fingerprint;

    // 1. The log finds it by its code, with the message, the page and one occurrence.
    await signInToAdmin(adminPage, reviewer);
    await adminPage.goto(`/admin/chyby?code=${first}`);
    await waitForAdmin(adminPage);
    const log = adminPage.getByTestId("error-log");
    await expect(log).toContainText(first);
    await expect(log).toContainText(`${CRASH_MESSAGE} ${tag}`);
    await expect(log).toContainText(CRASH_PATH);
    await expect(log).toContainText(text(L, "admin.errors.status.new"));

    // 2. Its detail: the occurrence with the user, then Resolved.
    await log.getByTestId("error-group-link").first().click();
    const detail = adminPage.getByTestId("error-group");
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId("error-occurrence")).toHaveCount(1);
    await expect(detail.getByTestId("error-occurrence").first()).toContainText(first);
    await expect(detail.getByTestId("user-detail-link")).toHaveAttribute("href", `/admin/uzivatele/${user.id}`);
    await detail
      .getByTestId("error-status")
      .getByRole("button", { name: exact(L, "admin.errors.status.resolved") })
      .click();
    await expect
      .poll(async () => {
        const { data } = await admin().from("error_groups").select("status").eq("fingerprint", fingerprint!).maybeSingle();
        return data?.status ?? "none";
      })
      .toBe("resolved");
    const { data: audit } = await admin()
      .from("admin_audit")
      .select("detail")
      .eq("user_id", reviewer.id)
      .eq("target", "errors.status");
    expect(audit?.length).toBe(1);

    // 3. The same error again: back among the new ones, labelled "came back".
    const second = await crash(page, tag);
    await adminPage.goto(`/admin/chyby?code=${second}`);
    await waitForAdmin(adminPage);
    await expect(log).toContainText(second);
    await expect(log).toContainText(text(L, "admin.errors.status.new"));
    await expect(log).toContainText(text(L, "admin.errors.cameBack"));
    const { data: group } = await admin()
      .from("error_groups")
      .select("status, returned_at")
      .eq("fingerprint", fingerprint)
      .single();
    expect(group?.status).toBe("new");
    expect(group?.returned_at).not.toBeNull();

    // 4. ⌘K finds a setting and goes to it, highlighted.
    await adminPage.keyboard.press("Control+K");
    const switcher = adminPage.getByRole("dialog", { name: exact(L, "admin.shell.switcher.title") });
    await switcher.getByRole("combobox").fill("strop ai");
    await switcher.getByRole("option", { name: new RegExp(text(L, "admin.help.items.aiCaps.title")) }).first().click();
    await expect(adminPage).toHaveURL(/\/admin\/ai.*#stropy$/);
    await expect(adminPage.locator("#stropy")).toHaveAttribute("data-admin-highlight", "");
  } finally {
    dropExpectedCrashErrors(consoleErrors);
    await adminPage.context().close();
    const db = admin();
    const { data } = await db.from("error_events").select("id").eq("user_id", user.id);
    const ids = (data ?? []).map((row) => row.id);
    if (ids.length) {
      await db.from("error_alert_sends").delete().in("event_id", ids);
      await db.from("error_events").delete().in("id", ids);
    }
    if (fingerprint) await db.from("error_groups").delete().eq("fingerprint", fingerprint);
  }
});
