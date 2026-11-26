import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { admin, type Account } from "./support/accounts";
import { requiredEnv } from "./support/env";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { totp } from "./support/totp";
import { waitForAdmin } from "./support/ui";

/**
 * The daily summary to administrators (30.1): a limited administrator sets
 * their own summary in Settings → Notifications (off, on again at 7:00, only
 * when there is news) and it is stored; "Send me a preview" puts yesterday's
 * "Gradus včera" in their inbox (the mock Resend of the test accounts), with
 * the people numbers and without any money. Nobody else's summary is shown
 * to a limited administrator.
 */

const L = "cs" as const;

test.use({ reducedMotion: "reduce" });

async function outbox(page: Page, to: string) {
  const secret = requiredEnv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  const key = createHash("sha256").update(`gradus-e2e-outbox:${secret}`).digest("hex");
  const response = await page.request.get(`/api/e2e/outbox?to=${encodeURIComponent(to)}`, {
    headers: { "x-gradus-e2e-key": key },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { mail: { subject: string; text: string; kind?: string }[] }).mail;
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
  await expect(page.getByTestId("admin-dashboard")).toBeVisible();
  await waitForAdmin(page);
}

test("73 · admin digest: own settings are saved, the preview arrives without money", async ({ page, accounts }) => {
  const account = await accounts.create({ label: "digest" });
  const { error } = await admin().from("user_roles").insert({ user_id: account.id, role: "admin", level: "limited" });
  if (error) throw error;
  await signInToAdmin(page, account);

  await page.goto("/admin/upozorneni");
  await waitForAdmin(page);
  const forms = page.getByTestId("digest-prefs");
  // A limited administrator sees only their own summary.
  await expect(forms).toHaveCount(1);
  const form = forms.first();

  // Off, saved.
  await form.getByRole("switch").click();
  await form.getByRole("button", { name: exact(L, "admin.digest.save") }).click();
  await expect(form.getByText(exact(L, "admin.digest.saved"))).toBeVisible();
  const stored = async () =>
    (
      await admin()
        .from("admin_notify_prefs")
        .select("digest_enabled, digest_hour, digest_only_news")
        .eq("user_id", account.id)
        .maybeSingle()
    ).data;
  await expect.poll(stored).toMatchObject({ digest_enabled: false });

  // On again, at 7:00, only when there is news.
  await form.getByRole("switch").click();
  await form.locator('[id$="-hour"]').click();
  await page.getByRole("option", { name: /^0?7:00$/ }).click();
  await form.getByText(exact(L, "admin.digest.onlyNews")).click();
  await form.getByRole("button", { name: exact(L, "admin.digest.save") }).click();
  await expect.poll(stored).toMatchObject({ digest_enabled: true, digest_hour: 7, digest_only_news: true });

  // The preview: yesterday's summary now, the people part and no money for a limited admin.
  await form.getByRole("button", { name: exact(L, "admin.digest.preview") }).click();
  await expect(form.getByText(exact(L, "admin.digest.previewSent"))).toBeVisible({ timeout: 60_000 });
  let mail: Awaited<ReturnType<typeof outbox>> = [];
  await expect.poll(async () => (mail = await outbox(page, account.email)).length, { timeout: 15_000 }).toBe(1);
  expect(mail[0]!.kind).toBe("admin_digest");
  expect(mail[0]!.subject).toMatch(/^Gradus včera · /);
  expect(mail[0]!.text).toContain(text(L, "email.adminDigest.people.title"));
  expect(mail[0]!.text).not.toContain(text(L, "email.adminDigest.money.title"));
  expect(mail[0]!.text).toContain("/admin");
});
