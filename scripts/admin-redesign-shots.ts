/**
 * Screenshots of every section of the administration as the owner, at 1440
 * and 390 px, into docs/admin-redesign/<before|after>/. Makes a throw-away
 * owner account (e2e-…@gradus.local) and removes it again.
 *
 *   bun scripts/admin-redesign-shots.ts before|after
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { admin, createAccount, deleteAccount } from "../tests/e2e/support/accounts";
import { totp } from "../tests/e2e/support/totp";

const ROOT = process.cwd();
const BASE_URL = process.env.SHOT_BASE_URL ?? "http://localhost:3000";
const phase = process.argv[2] ?? "before";
const OUT = path.join(ROOT, "docs/admin-redesign", phase);
const only = process.argv[3];

const SECTIONS: [string, string][] = [
  ["overview", "/admin"],
  ["growth", "/admin/rust"],
  ["activation", "/admin/aktivace"],
  ["retention", "/admin/retence"],
  ["features", "/admin/funkce"],
  ["ai", "/admin/ai"],
  ["game", "/admin/hra"],
  ["costs", "/admin/naklady"],
  ["health", "/admin/zdravi"],
  ["feedback", "/admin/zpetna-vazba"],
  ["users", "/admin/uzivatele?internal=1"],
  ["explorer", "/admin/pruzkumnik"],
  ["audit", "/admin/audit"],
  ["admins", "/admin/administratori"],
];

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(600);
}

async function signInToAdmin(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/admin/prihlaseni`);
  await page.locator("#admin-email").fill(email);
  await page.locator("#admin-password").fill(password);
  await page.locator("form button[type=submit]").click();
  await page.locator("#admin-code").waitFor({ timeout: 60_000 });
  const secret = (await page.locator("code").first().textContent())?.trim() ?? "";
  await page.locator("#admin-code").fill(totp(secret));
  await page.locator("form button[type=submit]").click();
  await page.waitForTimeout(2500);
  // Backup device offer: skip it (ghost button) if shown.
  const skip = page.getByRole("button").filter({ hasText: /přeskočit|skip|později/i }).first();
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.waitForURL(/\/admin(\/|\?|$)(?!prihlaseni)/, { timeout: 60_000 });
  await settle(page);
}

async function shootAll(context: BrowserContext, suffix: string, userId: string) {
  const page = await context.newPage();
  for (const [name, href] of SECTIONS) {
    if (only && name !== only) continue;
    await page.goto(`${BASE_URL}${href}`, { waitUntil: "networkidle" }).catch(() => {});
    await settle(page);
    await page.screenshot({ path: path.join(OUT, `${name}-${suffix}.png`), fullPage: true });
    console.log(`  ${name}-${suffix}.png`);
  }
  if (!only || only === "user-detail") {
    await page.goto(`${BASE_URL}/admin/uzivatele/${userId}`, { waitUntil: "networkidle" }).catch(() => {});
    await settle(page);
    await page.screenshot({ path: path.join(OUT, `user-detail-${suffix}.png`), fullPage: true });
    console.log(`  user-detail-${suffix}.png`);
  }
  await page.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const owner = await createAccount({ label: "shotowner" });
  const { error } = await admin().from("user_roles").insert({ user_id: owner.id, role: "owner" });
  if (error) throw error;
  const browser = await chromium.launch();
  try {
    const desktop = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "cs-CZ",
      timezoneId: "Europe/Prague",
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    await desktop.addCookies([{ name: "locale", value: "cs", url: BASE_URL }]);
    const page = await desktop.newPage();
    await signInToAdmin(page, owner.email, owner.password);
    await page.close();
    await shootAll(desktop, "1440", owner.id);
    const state = await desktop.storageState();
    const mobile = await browser.newContext({
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
    await shootAll(mobile, "390", owner.id);
  } finally {
    await browser.close();
    await deleteAccount(owner.id);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
