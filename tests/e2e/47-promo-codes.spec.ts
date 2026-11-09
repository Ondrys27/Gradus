import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { admin, e2eEmail, e2ePassword, findUserByEmail, type Account } from "./support/accounts";
import { env } from "./support/env";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { totp } from "./support/totp";

/**
 * Promo codes of partners (step 22.2): the owner makes a code in the
 * administration; a visitor opens the partner's link (…/?kod=…), the
 * registration has the code filled in and says what it gives, the new
 * account sees its benefit; the code's detail counts one sign-up; the first
 * payment of the account (a test row, @gradus.local only) makes a pending
 * payout of the commission on the payment without VAT, which the owner
 * approves.
 */

const L = "cs";
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

/** The exact case of an ICU plural ("=50 {…}"), which the text helper does not expand. */
function pluralCase(key: string, exactValue: number) {
  const match = new RegExp(`=${exactValue} \\{([^}]*)\\}`).exec(t(key));
  if (!match) throw new Error(`No =${exactValue} case in ${key}`);
  return match[1];
}

async function signInToAdmin(page: Page, account: Account) {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000";
  await page.context().addCookies([{ name: "locale", value: L, url: baseURL }]);
  await page.goto("/admin/prihlaseni");
  await page.locator("#admin-email").fill(account.email);
  await page.locator("#admin-password").fill(account.password);
  await page.getByRole("button", { name: exact(L, "admin.login.submit") }).click();
  await expect(page.getByText(t("admin.login.secretLabel"))).toBeVisible();
  const secret = (await page.locator("code").first().textContent())?.trim() ?? "";
  await page.locator("#admin-code").fill(totp(secret));
  await page.getByRole("button", { name: exact(L, "admin.login.enrollSubmit") }).click();
  await page.getByRole("button", { name: exact(L, "admin.login.backupSkip") }).click();
  await expect(page.getByRole("link", { name: exact(L, "admin.shell.nav.ai") })).toBeVisible();
}

test("47 · promo code: link → sign-up with the code → one sign-up → first payment → payout approved", async ({
  page,
  browser,
  accounts,
}) => {
  const inviteCode = env("INVITE_CODE");
  test.skip(!inviteCode, "INVITE_CODE is not set");
  test.setTimeout(240_000);
  const db = admin();
  const code = `E2E${randomUUID().replace(/-/g, "").slice(0, 9).toUpperCase()}`;
  const owner = await accounts.create({ label: "promoowner" });
  const { error: roleError } = await db
    .from("user_roles")
    .insert({ user_id: owner.id, role: "owner" });
  if (roleError) throw roleError;

  try {
    // The owner makes the code: half off the first month, 20 % commission (the defaults).
    await signInToAdmin(page, owner);
    await page.goto("/admin/promo-kody");
    await page.getByTestId("promo-create").click();
    const form = page.getByTestId("promo-form");
    await form
      .getByLabel(t("admin.promoCodes.form.code"), { exact: true })
      .fill(code.toLowerCase());
    await form
      .getByLabel(t("admin.promoCodes.form.partnerName"), { exact: true })
      .fill("E2E Partner");
    const half = pluralCase("promo.benefit.percent_off_first", 50);
    const offer = t("promo.offer", { code, benefit: half });
    await expect(form.getByTestId("promo-preview")).toHaveText(
      t("admin.promoCodes.form.preview", { text: offer }),
    );
    await form.getByTestId("promo-save").click();
    await expect(form).toBeHidden();
    const row = page.getByTestId("promo-row").filter({ hasText: code });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("promo-registrations")).toHaveText("0");
    const { data: saved, error: savedError } = await db
      .from("promo_codes")
      .select("id, benefit, benefit_value, commission_percent_first, created_by")
      .eq("code", code)
      .single();
    if (savedError) throw savedError;
    expect(saved).toMatchObject({
      benefit: "percent_off_first",
      benefit_value: 50,
      commission_percent_first: 20,
      created_by: owner.id,
    });

    // A visitor opens the partner's link; the registration has the code and says what it gives.
    const email = e2eEmail("promo");
    accounts.register(email);
    const guest = await browser.newContext({
      baseURL: test.info().project.use.baseURL ?? "http://localhost:3000",
      locale: "cs-CZ",
      timezoneId: "Europe/Prague",
      extraHTTPHeaders: { "accept-language": "cs-CZ,cs;q=0.9" },
    });
    try {
      const visitor = await guest.newPage();
      await visitor.goto(`/?kod=${code.toLowerCase()}`);
      const cookies = await guest.cookies();
      expect(cookies.find((cookie) => cookie.name === "gradus_promo")?.value).toBe(code);

      await visitor.goto("/registrace");
      await expect(visitor.getByTestId("promo-input")).toHaveValue(code);
      await expect(visitor.getByTestId("promo-verdict")).toHaveText(offer);
      await visitor.locator("#register-invite").fill(inviteCode!);
      await visitor.locator("#register-name").fill("E2E Promo");
      await visitor.locator("#register-email").fill(email);
      await visitor.locator("#register-password").fill(e2ePassword());
      await visitor.getByTestId("register-terms").click();
      await visitor.locator("form button[type=submit]").click();
      await expect(visitor).toHaveURL(/\/app$/, { timeout: 60_000 });

      // The benefit is in the wizard's welcome.
      const wizard = visitor.getByRole("dialog", { name: t("onboarding.title") });
      await expect(wizard.getByTestId("promo-offer")).toHaveText(offer);
    } finally {
      await guest.close();
    }

    const user = await findUserByEmail(email);
    expect(user).not.toBeNull();
    const userId = user!.id;
    const { data: redemption, error: redemptionError } = await db
      .from("promo_redemptions")
      .select("code_id, source, benefit, benefit_value")
      .eq("user_id", userId)
      .single();
    if (redemptionError) throw redemptionError;
    expect(redemption).toEqual({
      code_id: saved.id,
      source: "signup",
      benefit: "percent_off_first",
      benefit_value: 50,
    });
    const { data: events } = await db
      .from("analytics_events")
      .select("props")
      .eq("user_id", userId)
      .eq("event", "promo_redeemed");
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(code);

    // The code's detail counts one sign-up, not paid yet.
    await page.goto(`/admin/promo-kody/${saved.id}`);
    await expect(page.getByTestId("promo-detail-registrations")).toHaveAttribute("data-count", "1");
    const users = page.getByTestId("promo-users");
    await expect(users.getByRole("link", { name: "E2E Promo" })).toBeVisible();
    await expect(users.getByTestId("promo-user-paid")).toHaveText(
      t("admin.promoCodes.users.notPaid"),
    );
    await expect(page.getByTestId("promo-payout")).toHaveCount(0);

    // The first payment (a test row, as a gateway will write it): 604.79 CZK with 104.96 VAT.
    const { error: paymentError } = await db.from("payments").insert({
      user_id: userId,
      amount: 604.79,
      vat_amount: 104.96,
      currency: "CZK",
      status: "paid",
    });
    if (paymentError) throw paymentError;

    await page.reload();
    const payout = page.getByTestId("promo-payout");
    await expect(payout).toHaveCount(1);
    await expect(payout.getByTestId("payout-status")).toHaveText(
      t("admin.promoCodes.payouts.statuses.pending"),
    );
    const { data: pending, error: pendingError } = await db
      .from("partner_payouts")
      .select("id, amount, base_amount, status")
      .eq("user_id", userId)
      .single();
    if (pendingError) throw pendingError;
    expect(pending).toMatchObject({ amount: 99.97, base_amount: 499.83, status: "pending" });

    await payout.getByTestId("payout-approve").click();
    await expect(payout.getByTestId("payout-status")).toHaveText(
      t("admin.promoCodes.payouts.statuses.approved"),
    );
    const { data: approved } = await db
      .from("partner_payouts")
      .select("status, approved_by")
      .eq("id", pending.id)
      .single();
    expect(approved).toEqual({ status: "approved", approved_by: owner.id });
    await expect(users.getByTestId("promo-user-paid")).not.toHaveText(
      t("admin.promoCodes.users.notPaid"),
    );

    const { data: audit } = await db
      .from("admin_audit")
      .select("user_id, detail")
      .eq("target", "settings.promo_payouts")
      .eq("detail->>payout", pending.id);
    expect(audit).toHaveLength(1);
    expect(audit![0]).toMatchObject({ user_id: owner.id, detail: { to: { status: "approved" } } });
  } finally {
    // Codes are never deleted in the app; the test removes its own.
    const { data: own } = await db.from("promo_codes").select("id").eq("code", code).maybeSingle();
    if (own) {
      await db.from("partner_payouts").delete().eq("code_id", own.id);
      await db.from("promo_redemptions").delete().eq("code_id", own.id);
      await db.from("promo_codes").delete().eq("id", own.id);
    }
  }
});
