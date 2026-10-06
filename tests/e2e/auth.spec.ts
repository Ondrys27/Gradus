import { expect, test } from "@playwright/test";

test("a signed-out visitor is sent to login and keeps where they wanted to go", async ({
  page,
}) => {
  await page.goto("/app/pipeline?deal=1");
  await expect(page).toHaveURL(/\/prihlaseni\?next=%2Fapp%2Fpipeline%3Fdeal%3D1$/);
  await expect(page.locator('input[name="next"]')).toHaveValue("/app/pipeline?deal=1");
});

test("the password reset page needs the link from the e-mail", async ({ page }) => {
  await page.goto("/nove-heslo");
  await expect(page).toHaveURL(/\/zapomenute-heslo\?expired=1$/);
  await expect(page.locator("form [role=alert]")).toBeVisible();
});

test("registration rejects a wrong invite code", async ({ page }) => {
  await page.goto("/registrace?invite=definitely-not-the-code");
  await page.fill("#register-email", "e2e@example.com");
  await page.fill("#register-password", "12345678");
  await page.click("button[type=submit]");
  // Either the code is wrong, or INVITE_CODE is not configured and registration is closed.
  await expect(
    page.locator("#register-invite-message.text-pink, form [role=alert]").first(),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/registrace/);
});

test("an old address answers with a permanent redirect under /app", async ({ request }) => {
  const response = await request.get("/milestones", { maxRedirects: 0 });
  expect(response.status()).toBe(301);
  expect(response.headers().location).toBe("/app/milniky");
});

test("the home page is the public site for a signed-out visitor", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "accept-language": "cs-CZ,cs;q=0.9" });
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("header a[href='/prihlaseni']")).toBeVisible();
});

test("an English browser lands on the English site on its first visit", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "accept-language": "en-GB,en;q=0.9" });
  await page.goto("/");
  await expect(page).toHaveURL(/\/en$/);
});
