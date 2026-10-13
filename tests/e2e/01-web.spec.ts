import { publicSignupEnabled } from "./support/env";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";

test.describe("1 · signed-out website", () => {
  test.use({ extraHTTPHeaders: { "accept-language": "cs-CZ,cs;q=0.9" } });

  test(`the main button follows PUBLIC_SIGNUP_ENABLED (${publicSignupEnabled ? "on" : "off"})`, async ({
    page,
  }) => {
    await page.goto("/");
    const header = page.locator("header");

    if (publicSignupEnabled) {
      const cta = header.getByRole("link", { name: exact("cs", "marketing.cta.tryFree") }).first();
      await expect(cta).toBeVisible();
      await expect(header.getByRole("button", { name: exact("cs", "marketing.cta.waitlist") })).toHaveCount(0);
      await cta.click();
      await expect(page).toHaveURL(/\/registrace$/);
      await expect(page.getByText(text("cs", "auth.register.descriptionPublic"))).toBeVisible();
      await expect(page.locator("#register-invite")).not.toHaveAttribute("required", "");
    } else {
      const cta = header.getByRole("button", { name: exact("cs", "marketing.cta.waitlist") }).first();
      await expect(cta).toBeVisible();
      await expect(header.getByRole("link", { name: exact("cs", "marketing.cta.tryFree") })).toHaveCount(0);
      await cta.click();
      const dialog = page.getByRole("dialog", { name: text("cs", "marketing.waitlist.title") });
      await expect(dialog).toBeVisible();
      // Without consent the server refuses and nothing is stored or sent.
      await dialog.locator("#waitlist-email").fill("e2e-waitlist@gradus.local");
      await dialog.locator("button[type=submit]").click();
      await expect(dialog.getByText(text("cs", "marketing.waitlist.errors.consentRequired"))).toBeVisible();
    }
  });
});
