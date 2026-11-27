/**
 * Screenshots of every section as a brand-new owner and as a brand-new worker
 * (the Obchodník template), at 1440 and 390 px, into
 * docs/srozumitelnost/<before|after>/ (step 30.9). Makes throw-away accounts
 * (e2e-…@gradus.local) and removes them again. Needs the dev server on :3000
 * (or SHOT_BASE_URL).
 *
 *   bun scripts/srozumitelnost-shots.ts before|after [page]
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import {
  admin,
  createAccount,
  deleteAccount,
  signIn,
  skipCompanyTutorial,
  type Account,
} from "../tests/e2e/support/accounts";
import { templateGrants } from "../src/features/workers/permissions-catalog";

const ROOT = process.cwd();
const BASE_URL = process.env.SHOT_BASE_URL ?? "http://localhost:3000";
const phase = process.argv[2] === "after" ? "after" : "before";
const OUT = path.join(ROOT, "docs/srozumitelnost", phase);
const only = process.argv[3];

const OWNER_PAGES: [string, string][] = [
  ["dashboard", "/app"],
  ["milestones", "/app/milniky"],
  ["notes", "/app/poznamky"],
  ["contacts", "/app/kontakty"],
  ["cold-calling", "/app/cold-calling"],
  ["pipeline", "/app/pipeline"],
  ["tasks", "/app/ukoly-crm"],
  ["calendar", "/app/kalendar"],
  ["scheduler", "/app/planovac"],
  ["finance", "/app/finance"],
  ["invoices", "/app/finance?tab=invoices"],
  ["company", "/app/firma"],
  ["messages", "/app/zpravy"],
  ["settings", "/app/nastaveni"],
  ["settings-appearance", "/app/nastaveni/vzhled"],
  ["settings-menu", "/app/nastaveni/vzhled?focus=settings-menu"],
  ["settings-work", "/app/nastaveni/prace"],
];

const WORKER_PAGES: [string, string][] = [
  ["dashboard", "/app"],
  ["tasks", "/app/ukoly-crm"],
  ["contacts", "/app/kontakty"],
  ["pipeline", "/app/pipeline"],
  ["cold-calling", "/app/cold-calling"],
  ["calendar", "/app/kalendar"],
  ["scheduler", "/app/planovac"],
  ["messages", "/app/zpravy"],
  ["rewards", "/app/odmeny"],
  ["company", "/app/firma"],
  ["notes", "/app/poznamky"],
];

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(900);
}

async function shootAll(context: BrowserContext, who: string, pages: [string, string][], suffix: string) {
  const page = await context.newPage();
  for (const [name, href] of pages) {
    if (only && name !== only) continue;
    await page.goto(`${BASE_URL}${href}`, { waitUntil: "networkidle" }).catch(() => {});
    await settle(page);
    // The frame only: a full page would hide how much fits above the fold.
    await page.screenshot({ path: path.join(OUT, `${who}-${name}-${suffix}.png`), fullPage: false });
    console.log(`  ${who}-${name}-${suffix}.png`);
  }
  await page.close();
}

async function shootBoth(browser: Browser, account: Account, who: string, pages: [string, string][]) {
  const desktop = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await desktop.newPage();
  await signIn(page, account);
  await page.close();
  await shootAll(desktop, who, pages, "1440");
  const state = await desktop.storageState();
  await desktop.close();
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
  await shootAll(mobile, who, pages, "390");
  await mobile.close();
}

/** A worker of the owner with the Obchodník template, as the owner's dialog would make them. */
async function makeWorker(owner: Account, person: Account) {
  const db = admin();
  const { data: worker, error } = await db
    .from("workers")
    .insert({
      owner_id: owner.id,
      user_id: person.id,
      name: "E2E Obchodník",
      email: person.email,
      status: "active",
    })
    .select("id")
    .single();
  if (error) throw error;
  const grants = templateGrants("sales");
  const rows = Object.entries(grants).flatMap(([section, actions]) =>
    (actions ?? []).map((action) => ({
      owner_id: owner.id,
      worker_id: worker.id,
      section,
      action,
      allowed: true,
    })),
  );
  const { error: grantsError } = await db.from("worker_permission_grants").insert(rows);
  if (grantsError) throw grantsError;
  await skipCompanyTutorial(person.id, owner.id);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const owner = await createAccount({ label: "shotsroz-owner", mode: "tool" });
  const person = await createAccount({ label: "shotsroz-worker", mode: "tool" });
  const browser = await chromium.launch();
  try {
    await makeWorker(owner, person);
    console.log("Owner:");
    await shootBoth(browser, owner, "owner", OWNER_PAGES);
    console.log("Worker (Obchodník):");
    await shootBoth(browser, person, "worker", WORKER_PAGES);
  } finally {
    await browser.close();
    await deleteAccount(person.id);
    await deleteAccount(owner.id);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
