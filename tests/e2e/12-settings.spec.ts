import type { Page } from "@playwright/test";
import { admin, asUser, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { mainNav, openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string) => text(L, key);

/** The value of one row of the live preview on the settings page. */
function previewValue(page: Page, label: string) {
  return page.locator("dl > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");
}

function minutesOf(value: string) {
  const match = value.match(/(\d{1,2}):(\d{2})/);
  if (!match) throw new Error(`No time in "${value}"`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesNowIn(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return get("hour") * 60 + get("minute");
}

async function savedSettings(userId: string) {
  const { data } = await admin()
    .from("user_settings")
    .select("locale, currency, timezone")
    .eq("user_id", userId)
    .single();
  return data;
}

/**
 * Finance over the last three months. The transaction is dated today in UTC,
 * which in the account's time zone (later Tokyo) can already be the next
 * month; "this month" would then rightly hide it.
 */
async function openFinance(page: Page) {
  await openApp(page, "/app/finance");
  await page.locator("#finance-period").click();
  await page.getByRole("option", { name: t("finance.period.last3Months") }).click();
  await expect(page.locator("#finance-period")).toContainText(t("finance.period.last3Months"));
}

test("12 · settings: language, currency and time zone take effect", async ({ page, accounts }) => {
  const account = await accounts.create({ label: "settings" });
  await asUser(account, async (client) => {
    const { error } = await client.from("transactions").insert({
      user_id: account.id,
      type: "income",
      amount: 1500,
      occurred_on: new Date().toISOString().slice(0, 10),
      description: "E2E Konzultace",
    });
    if (error) throw error;
  });
  await signIn(page, account);

  await openFinance(page);
  const row = page.locator("main li, main tr").filter({ hasText: "E2E Konzultace" }).first();
  await expect(row).toContainText("Kč");

  // Currency: only the display changes.
  await openApp(page, "/app/nastaveni");
  await expect(previewValue(page, t("settings.preview.amount"))).toContainText("Kč");
  await page.locator("#settings-currency").click();
  await page.getByRole("option", { name: /^EUR/ }).click();
  await expect(previewValue(page, t("settings.preview.amount"))).toContainText("€");
  await expect.poll(async () => (await savedSettings(account.id))?.currency).toBe("EUR");

  // Time zone: the clock in the preview moves to Tokyo.
  await page.locator("#settings-timezone").click();
  await page.getByRole("combobox", { name: t("settings.region.timeZoneSearch") }).fill("Tokyo");
  await page.getByRole("option", { name: /Tokyo/ }).click();
  await expect.poll(async () => (await savedSettings(account.id))?.timezone).toBe("Asia/Tokyo");
  await expect
    .poll(async () => {
      const shown = minutesOf(await previewValue(page, t("settings.preview.time")).innerText());
      const tokyo = minutesNowIn("Asia/Tokyo");
      return Math.min(Math.abs(shown - tokyo), 1440 - Math.abs(shown - tokyo));
    })
    .toBeLessThanOrEqual(1);

  // A stored amount keeps its own currency (nothing is converted) …
  await openFinance(page);
  await expect(row).toContainText("Kč");
  // … while a new deal starts in the new one.
  await openApp(page, "/app/pipeline");
  await page.getByRole("button", { name: exact(L, "pipeline.actions.newDeal") }).first().click();
  const dealForm = page.getByRole("dialog", { name: t("pipeline.form.createTitle") });
  await expect(dealForm.locator("#new-deal-currency")).toContainText("EUR");
  await dealForm.getByRole("button", { name: exact(L, "pipeline.form.cancel") }).click();

  // Language: the whole app switches to English.
  await openApp(page, "/app/nastaveni");
  await page
    .getByRole("radiogroup", { name: t("settings.language.title") })
    .getByRole("radio", { name: text(L, "settings.language.options.en") })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: text("en", "settings.title") })).toBeVisible();
  await expect(mainNav(page, "en").getByRole("link", { name: text("en", "nav.finance") })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect.poll(async () => (await savedSettings(account.id))?.locale).toBe("en");

  // And it stays English after a reload.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: text("en", "settings.title") })).toBeVisible();
});
