import type { Page } from "@playwright/test";
import { admin, asUser, signIn } from "./support/accounts";
import { env } from "./support/env";
import { expect, test } from "./support/fixtures";
import { text } from "./support/i18n";
import { openApp } from "./support/ui";

/**
 * 24.1: currencies of the world. Switch the display currency to JPY →
 * finance and the plan prices are written in whole yen; a visitor from
 * another country sees the website's price list in their currency, with a
 * switcher and "roughly at the rate of …".
 */

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);
const SPACE = "[\\s\\u00a0\\u202f]";

/** A fresh rate of each currency, from the daily cron when the database has none yet. */
async function ensureRates(page: Page, codes: string[]) {
  const fresh = async () => {
    const { data } = await admin()
      .from("exchange_rates")
      .select("code, fetched_at")
      .in("code", codes)
      .gte("fetched_at", new Date(Date.now() - 6 * 86_400_000).toISOString());
    return (data ?? []).length === codes.length;
  };
  if (await fresh()) return;
  const secret = env("CRON_SECRET");
  test.skip(!secret, "no CRON_SECRET to fetch the exchange rates");
  // The same job Vercel Cron runs daily: real rates from the ECB and open.er-api.com.
  const response = await page.request.get("/api/cron/exchange-rates", {
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(response.ok()).toBe(true);
  expect(await fresh()).toBe(true);
}

async function pickCurrency(page: Page, trigger: string, query: string, code: string) {
  await page.locator(trigger).click();
  await page.getByRole("combobox", { name: t("currency.picker.search") }).fill(query);
  await page.getByRole("option", { name: new RegExp(`^${code}`) }).click();
}

test("54 · JPY in settings: finance and plan prices in whole yen", async ({ page, accounts }) => {
  const account = await accounts.create({ label: "currencies" });
  const today = new Date().toISOString().slice(0, 10);
  await asUser(account, async (client) => {
    const { error } = await client.from("transactions").insert([
      { user_id: account.id, type: "income", amount: 12_500, currency: "JPY", occurred_on: today, description: "E2E Yen" },
      { user_id: account.id, type: "expense", amount: 2_000, currency: "JPY", occurred_on: today, description: "E2E Yen out" },
    ]);
    if (error) throw error;
  });
  await ensureRates(page, ["JPY"]);
  await signIn(page, account);

  // The picker finds the yen by its Czech name.
  await openApp(page, "/app/nastaveni/vzhled");
  await pickCurrency(page, "#settings-currency", "jen", "JPY");
  await expect
    .poll(async () => (await admin().from("user_settings").select("currency").eq("user_id", account.id).single()).data?.currency)
    .toBe("JPY");

  // Finance: the stored yen as they are, whole, and the summary in yen.
  await openApp(page, "/app/finance?tab=transactions");
  const row = page.locator("main li, main tr").filter({ hasText: "E2E Yen" }).first();
  await expect(row).toContainText(new RegExp(`12${SPACE}500${SPACE}JP¥`));
  await expect(row).not.toContainText(/12\s500,00/);
  await openApp(page, "/app/finance?tab=overview");
  await expect(page.getByText(new RegExp(`10${SPACE}500${SPACE}JP¥`)).first()).toBeVisible();

  // Settings → Subscription: the plans in yen at the day's rate, charged in EUR.
  await openApp(page, "/app/nastaveni/predplatne");
  const current = page.getByTestId("subscription-current");
  await expect(current).toBeVisible();
  const addOn = page.getByTestId("add-on-no_branding-price");
  await expect(addOn).toContainText("JP¥");
  await expect(addOn).not.toContainText(",");

  // The website shows a signed-in user their own currency.
  await page.goto("/cenik");
  await expect(page.getByTestId("web-pricing")).toHaveAttribute("data-currency", "JPY");
  await expect(page.getByTestId("rate-note").first()).toContainText(t("currency.chargedIn", { currency: "EUR" }));
});

test.describe("54 · price list by the visitor's country", () => {
  test.use({ extraHTTPHeaders: { "accept-language": "cs-CZ,cs;q=0.9", "x-vercel-ip-country": "US" } });

  test("a visitor from the US sees dollars, can switch, and a link picks the currency", async ({ page }) => {
    await ensureRates(page, ["USD", "GBP"]);
    await page.goto("/cenik");
    const pricing = page.getByTestId("web-pricing");
    await expect(pricing).toHaveAttribute("data-currency", "USD");
    await expect(pricing).toContainText("US$");
    await expect(pricing.getByTestId("rate-note").first()).toBeVisible();

    // The switcher: CZK has manual prices, so no note about a rate.
    await pickCurrency(page, "#web-currency", "CZK", "CZK");
    await expect(pricing).toHaveAttribute("data-currency", "CZK");
    await expect(pricing).toContainText("Kč");
    await expect(pricing.getByTestId("rate-note")).toHaveCount(0);

    // A link with ?mena= wins over the country and the pick.
    await page.goto("/cenik?mena=GBP");
    await expect(pricing).toHaveAttribute("data-currency", "GBP");
    await expect(pricing).toContainText("£");
  });
});
