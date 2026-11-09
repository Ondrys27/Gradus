/**
 * Screenshots of Finance → Month (the month plan) at 1440 and 390 px into
 * docs/finance-redesign/<before|after>/. Makes a throw-away account
 * (e2e-…@gradus.local), builds the owner's November in it through the
 * interface (the same numbers as the e2e test) and removes the account again.
 * Needs the dev server on :3000 (or SHOT_BASE_URL).
 *
 *   bun scripts/finance-redesign-shots.ts before|after
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createAccount, deleteAccount, signIn } from "../tests/e2e/support/accounts";
import { exact, text } from "../tests/e2e/support/i18n";
import { openApp } from "../tests/e2e/support/ui";

const ROOT = process.cwd();
const BASE_URL = process.env.SHOT_BASE_URL ?? "http://localhost:3000";
const phase = process.argv[2] === "after" ? "after" : "before";
const OUT = path.join(ROOT, "docs/finance-redesign", phase);
const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

const MONTH = "/app/finance?tab=month&month=2026-11";
const EMPTY_MONTH = "/app/finance?tab=month&month=2027-02";

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function shoot(page: Page, name: string) {
  await settle(page);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  console.log(`  ${name}.png`);
}

async function cell(page: Page, row: string, week: number, value: string) {
  const name = `${row}, ${t("finance.plan.grid.week", { week })}`;
  await page.getByRole("gridcell", { name }).click();
  const input = page.getByRole("textbox", { name });
  await input.fill(value);
  await input.press("Enter");
  await expect(input).toHaveCount(0);
}

async function addRow(page: Page, kind: "Income" | "Expense", label: string) {
  const input = page.getByRole("textbox", { name: exact(L, `finance.plan.grid.new${kind}`) });
  await input.fill(label);
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(page.getByRole("rowheader", { name: new RegExp(label) })).toBeVisible();
}

/** The owner's November: 8 500 to start, 74 500 in, 66 000 out, lowest 6 500 in week 1. */
async function buildNovember(page: Page) {
  await openApp(page, MONTH);
  await page.getByRole("button", { name: exact(L, "finance.plan.empty.create", { month: "listopad" }) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("8 500");
  await dialog.getByRole("button", { name: exact(L, "finance.plan.create.submit") }).click();
  await expect(page.getByTestId("finance-plan-grid")).toBeVisible();
  await shoot(page, "fresh-1440");

  await addRow(page, "Income", "Grid");
  await addRow(page, "Income", "Fajn Jídlo");
  await addRow(page, "Expense", "Nájem");
  await addRow(page, "Expense", "Mzdy");
  await addRow(page, "Expense", "Software");

  await cell(page, "Fajn Jídlo", 1, "10 000");
  await cell(page, "Grid", 2, "40k");
  await cell(page, "Fajn Jídlo", 3, "24,5k");
  await cell(page, "Nájem", 1, "12000");
  await cell(page, "Mzdy", 2, "3*10000");
  await cell(page, "Mzdy", 4, "14 000");
  await cell(page, "Software", 3, "10000");
  await expect(page.getByTestId("plan-summary-closing")).toContainText("17");
}

async function desktop(browser: Browser, account: Awaited<ReturnType<typeof createAccount>>) {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await signIn(page, account);
  await openApp(page, EMPTY_MONTH);
  await shoot(page, "empty-1440");
  try {
    await buildNovember(page);
  } catch (error) {
    await page.screenshot({ path: "/tmp/finance-shots-failed.png", fullPage: true });
    throw error;
  }
  await page.keyboard.press("Escape");
  await shoot(page, "month-1440");
  await page.getByRole("tab", { name: exact(L, "finance.plan.views.actual") }).click();
  await shoot(page, "actual-1440");
  const state = await context.storageState();
  await context.close();
  return state;
}

async function mobile(browser: Browser, storageState: Awaited<ReturnType<BrowserContext["storageState"]>>) {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    colorScheme: "dark",
    reducedMotion: "reduce",
    storageState,
  });
  const page = await context.newPage();
  await openApp(page, MONTH);
  await shoot(page, "month-390");
  await openApp(page, EMPTY_MONTH);
  await shoot(page, "empty-390");
  await context.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const owner = await createAccount({ label: "shotfinance", mode: "tool" });
  const browser = await chromium.launch();
  try {
    const state = await desktop(browser, owner);
    await mobile(browser, state);
  } finally {
    await browser.close();
    await deleteAccount(owner.id);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
