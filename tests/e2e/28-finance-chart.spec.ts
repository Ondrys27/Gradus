import { signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact } from "./support/i18n";

/**
 * GR-KQHYBN: zooming the Finance chart (+/-, the wheel) made a fractional bar
 * index and the whole page fell to the error page. Zooming in and out must
 * keep the chart and its range.
 */

const L = "cs";

test.use({ reducedMotion: "reduce" });

test("28 · zooming the Finance chart in and out never crashes the page", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "finance-zoom" });
  await signIn(page, account);
  await page.goto("/app/finance");

  const zoomIn = page.getByRole("button", { name: exact(L, "finance.chart.zoomIn") });
  const zoomOut = page.getByRole("button", { name: exact(L, "finance.chart.zoomOut") });
  await expect(zoomIn).toBeEnabled();
  for (let step = 0; step < 3; step += 1) {
    await zoomIn.click();
    await expect(zoomOut).toBeEnabled();
  }
  await zoomOut.click();
  await page.getByRole("button", { name: exact(L, "finance.chart.resetZoom") }).click();

  await expect(page.getByRole("heading", { name: exact(L, "errorPage.title") })).toHaveCount(0);
  await expect(zoomIn).toBeEnabled();
});
