import { expect, test } from "./support/fixtures";

test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
});
