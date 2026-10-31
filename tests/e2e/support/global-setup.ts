import { chromium, type FullConfig } from "@playwright/test";
import "./env";
import { createAccount, deleteAccount, deleteLeftoverAccounts } from "./accounts";

/** Every page the journeys open; the dev server compiles each one on its first visit. */
const WARM_ROUTES = [
  "/app",
  "/app/milniky",
  "/app/ukoly-crm",
  "/app/kontakty",
  "/app/pipeline",
  "/app/cold-calling",
  "/app/kalendar",
  "/app/finance",
  "/app/pracovnici",
  "/app/nastaveni",
];

/**
 * Removes test accounts an interrupted run left behind, then opens every app
 * page once with a throw-away account, so the dev server has compiled them
 * before the first journey starts timing anything.
 */
export default async function globalSetup(config: FullConfig) {
  const removed = await deleteLeftoverAccounts();
  if (removed > 0) console.log(`Removed ${removed} leftover e2e account(s).`);

  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3000";
  const account = await createAccount({ label: "warmup" });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL });
    await page.goto("/prihlaseni", { timeout: 180_000 });
    await page.locator("#login-email").fill(account.email);
    await page.locator("#login-password").fill(account.password);
    await page.locator("form button[type=submit]").click();
    await page.waitForURL(/\/app/, { timeout: 180_000 });
    for (const route of WARM_ROUTES) {
      await page.goto(route, { timeout: 180_000 });
      await page.locator("main").first().waitFor({ timeout: 180_000 });
    }
  } finally {
    await browser.close();
    await deleteAccount(account.id);
  }
}
