import { LOCALIZED_PAGES, MARKETING_PAGES } from "../../src/lib/routes";
import { expect, test } from "./support/fixtures";

test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
});

// Every page of the public site, signed out, in both languages: it renders and
// the browser console stays clean (the fixture fails the test on any error).
const pages = MARKETING_PAGES.flatMap((name) =>
  (["cs", "en"] as const).map((locale) => ({ name, locale, path: LOCALIZED_PAGES[name][locale] })),
);

test("every public page renders without console errors", async ({ page }) => {
  for (const { path, locale } of pages) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBeLessThan(400);
    await expect(page.locator("main"), path).toBeVisible();
    await expect(page.locator("html"), path).toHaveAttribute("lang", locale);
  }
});
