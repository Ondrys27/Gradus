/**
 * Screenshots of Grady's tutorial as a new user sees it, at 1440 and 390 px,
 * into docs/tutorial/<before|after>/: the choice of how to start, every step
 * of the quick look and the first steps of the full tutorial (hands-on steps
 * are skipped, the sample data deleted at the end). Makes throw-away
 * accounts (e2e-…@gradus.local, game mode, a trades business) and removes
 * them again. Needs the dev server on :3000 (or SHOT_BASE_URL).
 *
 *   bun scripts/tutorial-shots.ts before|after [quick|full]
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { admin, createAccount, deleteAccount, signIn } from "../tests/e2e/support/accounts";
import { exact, text } from "../tests/e2e/support/i18n";

const ROOT = process.cwd();
const BASE_URL = process.env.SHOT_BASE_URL ?? "http://localhost:3000";
const phase = process.argv[2] === "after" ? "after" : "before";
const only = process.argv[3];
const OUT = path.join(ROOT, "docs/tutorial", phase);
const L = "cs" as const;
/** How many steps of the full tutorial are shot (the rest repeats the same two layouts). */
const FULL_STEPS = 12;

const overlay = (page: Page) => page.locator("[data-tutorial-overlay]");
const button = (page: Page, key: string) =>
  overlay(page).getByRole("button", { name: exact(L, key) });

async function settle(page: Page, ms = 900) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function shot(page: Page, name: string, suffix: string) {
  await page.screenshot({ path: path.join(OUT, `${name}-${suffix}.png`) });
  console.log(`  ${name}-${suffix}.png`);
}

async function openChoice(page: Page) {
  await page.goto(`${BASE_URL}/app/nastaveni/grady`, { waitUntil: "networkidle" }).catch(() => {});
  await settle(page, 400);
  await page.getByRole("button", { name: exact(L, "settings.help.start") }).click();
  const choice = page.getByTestId("tutorial-choice");
  await choice.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(600);
  return choice;
}

async function walkQuick(page: Page, suffix: string) {
  const choice = await openChoice(page);
  await shot(page, "choice", suffix);
  await choice.locator('[data-tutorial-choice="quick"]').click();
  await choice.waitFor({ state: "hidden", timeout: 30_000 });
  for (let index = 0; index < 30; index += 1) {
    await overlay(page).first().waitFor({ state: "visible", timeout: 30_000 });
    await settle(page);
    await shot(page, `quick-${String(index + 1).padStart(2, "0")}`, suffix);
    const next = button(page, "tutorial.next");
    const done = button(page, "tutorial.done");
    if (await done.isVisible()) {
      await done.click();
      break;
    }
    await next.click();
    await page.waitForTimeout(250);
  }
  await overlay(page)
    .waitFor({ state: "hidden", timeout: 30_000 })
    .catch(() => {});
}

async function walkFull(page: Page, suffix: string) {
  const choice = await openChoice(page);
  await choice.locator('[data-tutorial-choice="full"]').click();
  await choice.waitFor({ state: "hidden", timeout: 60_000 });
  for (let index = 0; index < FULL_STEPS; index += 1) {
    await overlay(page).first().waitFor({ state: "visible", timeout: 30_000 });
    await settle(page);
    await shot(page, `full-${String(index + 1).padStart(2, "0")}`, suffix);
    const next = button(page, "tutorial.next");
    const skip = button(page, "tutorial.skipStep");
    if ((await overlay(page).getAttribute("data-tutorial-step")) === "milestoneCreate") {
      // The hands-on step done in the app: Grady's reaction and the lit Next.
      await page
        .getByRole("button", { name: exact(L, "milestones.actions.new") })
        .first()
        .click();
      const form = page.getByRole("dialog", { name: text(L, "milestones.form.createTitle") });
      await form
        .locator("#milestone-title")
        .fill(text(L, "onboarding.industry.industries.trades.milestoneTitle"));
      await form.getByRole("button", { name: exact(L, "milestones.form.create") }).click();
      await next.waitFor({ state: "attached" });
      await page.waitForFunction(
        () => !document.querySelector("[data-tutorial-overlay] button[disabled]"),
        undefined,
        { timeout: 20_000 },
      );
      await settle(page, 1200);
      await shot(page, "full-04-done", suffix);
    }
    if (await next.isEnabled()) await next.click();
    else await skip.click();
    await page.waitForTimeout(250);
  }
  await overlay(page).first().waitFor({ state: "visible", timeout: 30_000 });
  await button(page, "tutorial.end").click();
  await page.waitForTimeout(400);
  await shot(page, "full-end", suffix);
  await button(page, "tutorial.endConfirm.delete").click();
  await overlay(page)
    .waitFor({ state: "hidden", timeout: 60_000 })
    .catch(() => {});
}

async function withContext(
  browser: Browser,
  size: "1440" | "390",
  account: Parameters<typeof signIn>[1],
  run: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: size === "1440" ? { width: 1440, height: 900 } : { width: 390, height: 844 },
    deviceScaleFactor: size === "1440" ? 1 : 2,
    isMobile: size === "390",
    hasTouch: size === "390",
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    colorScheme: "dark",
  });
  const page = await context.newPage();
  try {
    await signIn(page, account);
    await run(page);
  } finally {
    await context.close();
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const accounts: string[] = [];
  try {
    for (const size of ["1440", "390"] as const) {
      if (!only || only === "quick") {
        const quick = await createAccount({ label: `shottq${size}`, mode: "game" });
        accounts.push(quick.id);
        await admin().from("profiles").update({ industry: "trades" }).eq("id", quick.id);
        console.log(`quick look · ${size}`);
        await withContext(browser, size, quick, (page) => walkQuick(page, size));
      }
      if (!only || only === "full") {
        const full = await createAccount({ label: `shottf${size}`, mode: "game" });
        accounts.push(full.id);
        await admin().from("profiles").update({ industry: "trades" }).eq("id", full.id);
        console.log(`full tutorial · ${size}`);
        await withContext(browser, size, full, (page) => walkFull(page, size));
      }
    }
  } finally {
    await browser.close();
    for (const id of accounts) await deleteAccount(id).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
