import { signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { text } from "./support/i18n";
import { openApp } from "./support/ui";

const L = "cs" as const;

test.describe("13 · phone at 390 px", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  });

  test("dashboard, pipeline, cold calling and calendar: bottom bar, no sideways scroll", async ({
    page,
    accounts,
  }) => {
    const account = await accounts.create({ label: "phone", mode: "game" });
    await signIn(page, account);

    for (const route of ["/app", "/app/pipeline", "/app/cold-calling", "/app/kalendar"]) {
      await openApp(page, route);
      await expect(page.locator("main h1").first()).toBeVisible();

      // The bottom bar is there; the sidebar is not.
      const nav = page.getByRole("navigation", { name: text(L, "nav.label") }).filter({ visible: true });
      await expect(nav).toHaveCount(1);
      const box = (await nav.boundingBox())!;
      expect(box.y + box.height, `bottom bar at the bottom on ${route}`).toBeGreaterThan(844 - 40);
      expect(box.y, `bottom bar at the bottom on ${route}`).toBeGreaterThan(844 / 2);

      // Nothing pushes the page sideways (a board may scroll inside itself).
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        width: window.innerWidth,
      }));
      expect(overflow.scroll, `page width on ${route}`).toBeLessThanOrEqual(overflow.width);
      await page.mouse.wheel(300, 0);
      expect(await page.evaluate(() => window.scrollX), `sideways scroll on ${route}`).toBe(0);
    }
  });
});
