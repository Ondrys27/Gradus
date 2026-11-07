import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { admin, type Account } from "./support/accounts";
import { requiredEnv } from "./support/env";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { totp } from "./support/totp";

/**
 * Support in the administration (step 22.1): the owner finds an account by
 * a part of its e-mail, opens it, and sends a password reset link with a
 * reason. The link never shows in the administration; it goes to the mock
 * Resend (the outbox kept for e2e-…@gradus.local outside production), it
 * really opens the new password page, and admin_audit has the action with
 * whom it was about and why.
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
  expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  await page.locator("#admin-code").fill(totp(secret));
  await page.getByRole("button", { name: exact(L, "admin.login.enrollSubmit") }).click();
  await page.getByRole("button", { name: exact(L, "admin.login.backupSkip") }).click();
  await expect(page.getByRole("link", { name: exact(L, "admin.shell.nav.ai") })).toBeVisible();
}

/** The mail the mock Resend kept for a test address (GET /api/e2e/outbox). */
async function outbox(page: Page, to: string) {
  const secret = requiredEnv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  const key = createHash("sha256").update(`gradus-e2e-outbox:${secret}`).digest("hex");
  const response = await page.request.get(`/api/e2e/outbox?to=${encodeURIComponent(to)}`, {
    headers: { "x-gradus-e2e-key": key },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { mail: { subject: string; text: string; html: string }[] }).mail;
}

test("46 · the owner finds an account by part of its e-mail and sends a password reset", async ({
  page,
  browser,
  accounts,
}) => {
  test.setTimeout(180_000);
  const db = admin();
  const owner = await accounts.create({ label: "supportowner" });
  const target = await accounts.create({ label: "supporttarget" });
  const { error: roleError } = await db.from("user_roles").insert({ user_id: owner.id, role: "owner" });
  if (roleError) throw roleError;

  await signInToAdmin(page, owner);

  // Test accounts are internal: the view includes them, the search is a part of the address.
  await page.goto("/admin/uzivatele?internal=1");
  const part = target.email.slice(4, 22).toUpperCase();
  const search = page.getByRole("searchbox", { name: exact(L, "admin.users.searchPlaceholder") });
  await search.fill(part);
  await search.press("Enter");
  await expect(page).toHaveURL(/q=/);
  const emailCell = page.getByTestId("user-email").filter({ hasText: target.email });
  await expect(emailCell).toHaveCount(1);
  await expect(page.getByTestId("user-email")).toHaveCount(1);

  await page.getByRole("link", { name: "E2E supporttarget" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/uzivatele/${target.id}`));
  const card = page.getByTestId("account-card");
  await expect(card.getByTestId("account-email")).toHaveText(target.email);

  // A reason is required before anything is sent.
  await card
    .getByRole("button", { name: exact(L, "admin.users.account.actions.passwordReset.button") })
    .click();
  const dialog = page.getByTestId("account-dialog-passwordReset");
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", {
    name: exact(L, "admin.users.account.actions.passwordReset.confirm"),
  });
  await confirm.click();
  await expect(dialog.getByText(text(L, "admin.users.account.errors.reason"))).toBeVisible();
  expect(await outbox(page, target.email)).toEqual([]);

  const reason = "Tester psal na podporu, zapomněl heslo";
  await dialog.getByLabel(text(L, "admin.users.account.reasonLabel")).fill(reason);
  await confirm.click();
  await expect(page.getByTestId("account-action-done")).toHaveText(
    text(L, "admin.users.account.actions.passwordReset.done", { email: target.email }),
  );
  // The link is the person's: it is nowhere on the administration's page.
  await expect(page.locator("body")).not.toContainText("token_hash");

  // The mock Resend got the reset e-mail with the recovery link.
  let mail: Awaited<ReturnType<typeof outbox>> = [];
  await expect
    .poll(async () => (mail = await outbox(page, target.email)).length, { timeout: 15_000 })
    .toBe(1);
  expect(mail[0].subject).toBe(text(L, "email.auth.resetPassword.subject", { appName: "Gradus" }));
  const link = /https?:\/\/\S+\/auth\/confirm\?\S+/.exec(mail[0].text)?.[0] ?? "";
  const url = new URL(link);
  expect(url.searchParams.get("type")).toBe("recovery");
  expect(url.searchParams.get("token_hash")).toMatch(/^[0-9a-f]{20,}$/);
  expect(url.searchParams.get("next")).toBe("/nove-heslo");

  // The audit has the action, whom it was about and why.
  const { data: rows, error: auditError } = await db
    .from("admin_audit")
    .select("user_id, kind, target, detail")
    .eq("target", "users.password_reset")
    .eq("detail->>user", target.id);
  if (auditError) throw auditError;
  expect(rows).toHaveLength(1);
  expect(rows![0]).toMatchObject({
    user_id: owner.id,
    kind: "update",
    detail: { user: target.id, reason },
  });
  expect(JSON.stringify(rows![0].detail)).not.toContain("token");

  // The link really works: in a browser without a session it opens the new password page.
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL ?? "http://localhost:3000",
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
  });
  try {
    const guest = await context.newPage();
    await guest.goto(`${url.pathname}${url.search}`);
    await expect(guest).toHaveURL(/\/nove-heslo$/);
  } finally {
    await context.close();
  }
});
