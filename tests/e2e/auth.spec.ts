import { expect, test } from "@playwright/test";

test("a signed-out visitor is sent to login and keeps where they wanted to go", async ({
  page,
}) => {
  await page.goto("/pipeline?deal=1");
  await expect(page).toHaveURL(/\/login\?next=%2Fpipeline%3Fdeal%3D1$/);
  await expect(page.locator('input[name="next"]')).toHaveValue("/pipeline?deal=1");
});

test("the password reset page needs the link from the e-mail", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page).toHaveURL(/\/forgot-password\?expired=1$/);
  await expect(page.locator("form [role=alert]")).toBeVisible();
});

test("registration rejects a wrong invite code", async ({ page }) => {
  await page.goto("/register");
  await page.fill("#register-invite", "definitely-not-the-code");
  await page.fill("#register-email", "e2e@example.com");
  await page.fill("#register-password", "12345678");
  await page.click("button[type=submit]");
  // Either the code is wrong, or INVITE_CODE is not configured and registration is closed.
  await expect(
    page.locator("#register-invite-message.text-pink, form [role=alert]").first(),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);
});
