import type { Page } from "@playwright/test";
import { admin, type Account } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { totp } from "./support/totp";

/**
 * The AI caps in the administration (step 13.5): a throw-away owner signs in
 * with password and a fresh authenticator, the form refuses a negative cap,
 * a change is confirmed, saved and audited, and a user's exception (AI
 * blocked) is saved from their detail. The caps row in force before the test
 * is put back afterwards, so real users never feel it; the test only moves
 * the warning threshold, which sends no one anything but the owner's e-mail.
 */

/** The administration speaks the language of the locale cookie; the test pins it. */
const L = "cs";

async function signInToAdmin(page: Page, account: Account) {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000";
  await page.context().addCookies([{ name: "locale", value: L, url: baseURL }]);
  await page.goto("/admin/prihlaseni");
  await page.locator("#admin-email").fill(account.email);
  await page.locator("#admin-password").fill(account.password);
  await page.getByRole("button", { name: exact(L, "admin.login.submit") }).click();

  // A new owner sets up the authenticator; the secret is printed under the QR code.
  await expect(page.getByText(text(L, "admin.login.secretLabel"))).toBeVisible();
  const secret = (await page.locator("code").first().textContent())?.trim() ?? "";
  expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  await page.locator("#admin-code").fill(totp(secret));
  await page.getByRole("button", { name: exact(L, "admin.login.enrollSubmit") }).click();
  // The offer of a backup device may show, or the refreshed session goes straight in.
  const skip = page.getByRole("button", { name: exact(L, "admin.login.backupSkip") });
  const overview = page.getByRole("link", { name: exact(L, "admin.shell.nav.ai") });
  await expect(skip.or(overview)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await expect(overview).toBeVisible();
}

test("20 · the owner sets the AI caps and a user's exception in the administration", async ({
  page,
  accounts,
}) => {
  const db = admin();
  const owner = await accounts.create({ label: "capsowner" });
  const target = await accounts.create({ label: "capstarget" });
  const { error: roleError } = await db
    .from("user_roles")
    .insert({ user_id: owner.id, role: "owner" });
  if (roleError) throw roleError;

  const { data: before, error: readError } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "ai_caps")
    .maybeSingle();
  if (readError) throw readError;

  try {
    await signInToAdmin(page, owner);
    await page.goto("/admin/ai");
    const form = page.getByTestId("ai-caps-form");
    await expect(form).toBeVisible();

    const monthly = form.getByLabel(text(L, "admin.ai.caps.monthlyLabel"));
    const warn = form.getByLabel(text(L, "admin.ai.caps.warnLabel"));
    const monthlyBefore = await monthly.inputValue();
    const warnBefore = Number(await warn.inputValue());
    const warnAfter = warnBefore === 79 ? 78 : 79;

    // A negative cap is refused in the form, no confirmation opens.
    await monthly.fill("-5");
    await form.getByRole("button", { name: exact(L, "admin.ai.caps.save") }).click();
    await expect(form.locator("#caps-monthly-message")).toHaveClass(/text-pink/);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await monthly.fill(monthlyBefore);
    await warn.fill(String(warnAfter));
    await form.getByRole("button", { name: exact(L, "admin.ai.caps.save") }).click();
    const dialog = page.getByRole("dialog", { name: exact(L, "admin.ai.caps.confirmTitle") });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("ai-caps-changes")).toContainText(
      `${warnBefore} % → ${warnAfter} %`,
    );
    await dialog.getByRole("button", { name: exact(L, "admin.ai.caps.confirm") }).click();
    await expect(dialog).toBeHidden();
    await expect(form.getByRole("status")).toHaveText(exact(L, "admin.ai.caps.saved"));

    const { data: saved } = await db
      .from("app_settings")
      .select("value, updated_by")
      .eq("key", "ai_caps")
      .single();
    expect(saved?.updated_by).toBe(owner.id);
    expect((saved?.value as { warn_percent: number }).warn_percent).toBe(warnAfter);
    const { data: audit } = await db
      .from("admin_audit")
      .select("kind, detail")
      .eq("user_id", owner.id)
      .eq("target", "settings.ai_caps")
      .order("id", { ascending: false })
      .limit(1)
      .single();
    expect(audit?.kind).toBe("update");
    expect((audit?.detail as { to: { warn_percent: number } }).to.warn_percent).toBe(warnAfter);

    // A user's exception: AI blocked for the target account.
    await page.goto(`/admin/uzivatele/${target.id}`);
    const userForm = page.getByTestId("user-ai-cap-form");
    await userForm.getByLabel(exact(L, "admin.users.aiCap.modes.blocked")).check();
    await userForm.getByRole("button", { name: exact(L, "admin.users.aiCap.save") }).click();
    const userDialog = page.getByRole("dialog", {
      name: exact(L, "admin.users.aiCap.confirmTitle"),
    });
    await userDialog.getByRole("button", { name: exact(L, "admin.users.aiCap.confirm") }).click();
    await expect(userForm.getByRole("status")).toHaveText(exact(L, "admin.users.aiCap.saved"));
    const { data: exception } = await db
      .from("ai_user_caps")
      .select("blocked, cap_usd")
      .eq("user_id", target.id)
      .single();
    expect(exception).toEqual({ blocked: true, cap_usd: null });
  } finally {
    // Put the caps in force before the test back (none = the defaults again).
    const restore = before
      ? await db.from("app_settings").update({ value: before.value }).eq("key", "ai_caps")
      : await db.from("app_settings").delete().eq("key", "ai_caps");
    if (restore.error) throw restore.error;
  }
});
