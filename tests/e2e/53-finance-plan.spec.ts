import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import type { Page } from "@playwright/test";
import { signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { dismissCelebrationsAutomatically, openApp } from "./support/ui";

/**
 * 21.1: the month plan with the owner's November from his Google Sheet.
 * Create November → opening capital 8 500, two incomes, three expenses →
 * the summary says what the sheet says (74 500 in, 66 000 out, 17 000 at the
 * end, lowest 6 500 in week 1) → create December from November (it starts
 * with 17 000) → export both as XLSX with the same numbers.
 */

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);
const money = (value: string) => new RegExp(`^${value.replace(/ /g, "\\s")}\\sKč$`);

async function cell(page: Page, row: string, week: number, value: string) {
  await page.getByRole("gridcell", { name: `${row}, ${t("finance.plan.grid.week", { week })}` }).click();
  const input = page.getByRole("textbox", { name: `${row}, ${t("finance.plan.grid.week", { week })}` });
  await input.fill(value);
  await input.press("Enter");
  await expect(input).toHaveCount(0);
}

async function addRow(page: Page, kind: "Income" | "Expense", label: string) {
  const input = page.getByRole("textbox", { name: exact(L, `finance.plan.grid.new${kind}`) });
  await input.fill(label);
  await input.press("Enter");
  await expect(page.getByRole("rowheader", { name: new RegExp(label) })).toBeVisible();
}

async function exportXlsx(page: Page, month: string) {
  await page.getByRole("button", { name: exact(L, "finance.plan.export.label") }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: exact(L, "finance.plan.export.xlsx") }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`${t("finance.plan.export.fileName", { month })}.xlsx`);
  const files = unzipSync(new Uint8Array(await readFile((await download.path())!)));
  return strFromU8(files["xl/worksheets/sheet1.xml"]);
}

test("53 · month plan: November from the sheet, December from November, XLSX", async ({ page, accounts }) => {
  const account = await accounts.create({ label: "finance-plan", mode: "tool" });
  await signIn(page, account);
  await dismissCelebrationsAutomatically(page, L);
  await openApp(page, "/app/finance?tab=month&month=2026-11");

  // An empty month offers to be created.
  await expect(page.getByText(t("finance.plan.empty.title", { month: "Listopad 2026" }))).toBeVisible();
  await page.getByRole("button", { name: exact(L, "finance.plan.empty.create", { month: "listopad" }) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("8 500");
  await dialog.getByRole("button", { name: exact(L, "finance.plan.create.submit") }).click();
  await expect(page.getByTestId("finance-plan-grid")).toBeVisible();

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

  const summary = page.getByTestId("finance-plan-summary");
  await expect(summary.getByTestId("plan-summary-opening")).toHaveText(money("8 500"));
  await expect(summary.getByTestId("plan-summary-income")).toHaveText(money("74 500"));
  await expect(summary.getByTestId("plan-summary-expense")).toHaveText(money("66 000"));
  await expect(summary.getByTestId("plan-summary-closing")).toHaveText(money("17 000"));
  await expect(summary.getByTestId("plan-summary-lowest")).toHaveText(money("6 500"));
  await expect(summary.getByTestId("plan-summary-lowest-week")).toContainText(
    t("finance.plan.summary.lowestWeek", { week: 1, range: "" }).replace(" ()", "").trim(),
  );

  // Saved, not only shown: a reload gives the same.
  await page.reload();
  await expect(page.getByTestId("plan-summary-closing")).toHaveText(money("17 000"));

  const november = await exportXlsx(page, "2026-11");
  expect(november).toContain("Fajn Jídlo");
  expect(november).toMatch(/<c r="B17" s="\d+"><f>B2\+B16<\/f><v>6500<\/v><\/c>/);

  // December from November, with the numbers; it starts with November's 17 000.
  await page
    .getByRole("button", { name: exact(L, "finance.plan.carry", { next: "prosinec", from: "listopadu" }) })
    .click();
  const carry = page.getByRole("dialog");
  await carry.getByLabel(t("finance.plan.create.mode.numbers")).check();
  await expect(carry.getByRole("textbox")).toHaveValue("17000");
  await carry.getByRole("button", { name: exact(L, "finance.plan.create.submit") }).click();
  await expect(page).toHaveURL(/month=2026-12/);
  await expect(page.getByRole("heading", { name: "Prosinec 2026" })).toBeVisible();
  await expect(page.getByTestId("plan-summary-opening")).toHaveText(money("17 000"));
  await expect(page.getByRole("rowheader", { name: /Fajn Jídlo/ })).toBeVisible();

  const december = await exportXlsx(page, "2026-12");
  expect(december).toContain("Software");
  expect(december).toContain("<v>17000</v>");
});
