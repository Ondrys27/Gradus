/**
 * Screenshots of every settings page as an owner, at 1440 and 390 px, into
 * docs/settings-redesign/<before|after>/. Makes a throw-away account
 * (e2e-…@gradus.local, game mode so the locked themes and the path show)
 * and removes it again. Needs the dev server on :3000 (or SHOT_BASE_URL).
 *
 *   bun scripts/settings-redesign-shots.ts before|after [page]
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { createAccount, deleteAccount, signIn } from "../tests/e2e/support/accounts";

const ROOT = process.cwd();
const BASE_URL = process.env.SHOT_BASE_URL ?? "http://localhost:3000";
const phase = process.argv[2] === "after" ? "after" : "before";
const OUT = path.join(ROOT, "docs/settings-redesign", phase);
const only = process.argv[3];

const PAGES: Record<typeof phase, [string, string][]> = {
  before: [
    ["settings", "/app/nastaveni"],
    ["subscription", "/app/nastaveni/predplatne"],
    ["profile", "/app/profil"],
  ],
  after: [
    ["settings", "/app/nastaveni"],
    ["account", "/app/nastaveni/ucet"],
    ["subscription", "/app/nastaveni/predplatne"],
    ["jarvis", "/app/nastaveni/jarvis"],
    ["appearance", "/app/nastaveni/vzhled"],
    ["work", "/app/nastaveni/prace"],
    ["privacy", "/app/nastaveni/soukromi"],
    ["search", "/app/nastaveni?q=měna"],
  ],
};

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function shootAll(context: BrowserContext, suffix: string) {
  const page = await context.newPage();
  for (const [name, href] of PAGES[phase]) {
    if (only && name !== only) continue;
    await page.goto(`${BASE_URL}${href}`, { waitUntil: "networkidle" }).catch(() => {});
    await settle(page);
    await page.screenshot({ path: path.join(OUT, `${name}-${suffix}.png`), fullPage: true });
    console.log(`  ${name}-${suffix}.png`);
  }
  await page.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const owner = await createAccount({ label: "shotsettings", mode: "game" });
  const browser = await chromium.launch();
  try {
    const desktop = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1440, height: 900 },
      locale: "cs-CZ",
      timezoneId: "Europe/Prague",
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    const page = await desktop.newPage();
    await signIn(page, owner);
    await page.close();
    await shootAll(desktop, "1440");
    const state = await desktop.storageState();
    const mobile = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: "cs-CZ",
      timezoneId: "Europe/Prague",
      colorScheme: "dark",
      reducedMotion: "reduce",
      storageState: state,
    });
    await shootAll(mobile, "390");
  } finally {
    await browser.close();
    await deleteAccount(owner.id);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
