/**
 * Real screenshots of the app for the marketing website, taken from the demo
 * account (`bun run demo:seed` first). Writes WebP files at 2× resolution to
 * /public/screenshots, which Screenshot (src/features/marketing/home/screenshot.tsx)
 * then shows instead of the drawn stand-in.
 *
 *   bun run screenshots
 *
 * Runs against a production build (`bun run build` + `bun run start`) on
 * its own port, never the dev server — dev mode is slower and shows its own
 * overlay, neither of which belongs in a marketing screenshot. Reuses a
 * server already answering at SCREENSHOT_BASE_URL (handy while iterating)
 * and otherwise builds and starts one, stopping it again at the end. Needs
 * the demo account to already exist.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import sharp from "sharp";

const PORT = process.env.SCREENSHOT_PORT ?? "4487";
const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? `http://localhost:${PORT}`;
const DEMO_EMAIL = "demo@gradus.local";
const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD ?? "GradusDemo#2026";
const OUT_DIR = path.join(process.cwd(), "public", "screenshots");

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const SCALE = 2;

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`)),
    );
  });
}

async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function ensureServer(): Promise<ChildProcess | null> {
  if (await waitForServer(BASE_URL, 2000)) {
    console.log(`Using the production server already running at ${BASE_URL}.`);
    return null;
  }
  console.log("Building the app…");
  await run("bun", ["run", "build"]);
  console.log(`Starting the production server on port ${PORT}…`);
  const child = spawn("bun", ["run", "start", "--", "-p", PORT], { stdio: "inherit" });
  const up = await waitForServer(BASE_URL, 60_000);
  if (!up) {
    child.kill();
    throw new Error(`The production server never answered at ${BASE_URL}.`);
  }
  return child;
}

async function waitSettled(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  // React Query settling, confetti/entry animations finishing (reduced motion
  // shortens them, but a couple of frames are still safer than zero).
  await page.waitForTimeout(500);
}

async function saveWebp(buffer: Buffer, name: string) {
  const file = path.join(OUT_DIR, `${name}.webp`);
  await sharp(buffer).webp({ quality: 82 }).toFile(file);
  console.log(`  wrote ${path.relative(process.cwd(), file)}`);
}

async function login(page: Page) {
  await page.goto(`${BASE_URL}/prihlaseni`, { waitUntil: "networkidle" });
  await page.locator('input[name="email"]').fill(DEMO_EMAIL);
  await page.locator('input[name="password"]').fill(DEMO_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/app", { timeout: 20_000 });
  await waitSettled(page);
}

async function goto(page: Page, pathname: string) {
  await page.goto(`${BASE_URL}${pathname}`, { waitUntil: "networkidle" });
  await waitSettled(page);
}

async function shoot(page: Page, pathname: string, name: string, after?: (page: Page) => Promise<void>) {
  await goto(page, pathname);
  if (after) {
    await after(page);
    await waitSettled(page);
  }
  const buffer = await page.screenshot({ type: "png" });
  await saveWebp(buffer, name);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const devServer = await ensureServer();

  const browser = await chromium.launch();
  try {
    // ---- Desktop, 1440×900, dark theme, 2× ------------------------------
    const desktopContext = await browser.newContext({
      viewport: DESKTOP,
      deviceScaleFactor: SCALE,
      colorScheme: "dark",
      reducedMotion: "reduce",
      locale: "cs-CZ",
    });
    const desktop = await desktopContext.newPage();
    await login(desktop);

    await shoot(desktop, "/app", "dashboard");
    await shoot(desktop, "/app/milniky?view=path", "milestones");

    // The milestone detail page, with its task map switched on.
    await goto(desktop, "/app/milniky");
    await desktop.locator('a[href^="/app/milniky/"]').first().click();
    await desktop.waitForURL(/\/app\/milniky\/[^/?]+$/, { timeout: 10_000 });
    await desktop.evaluate(() => localStorage.setItem("gradus.milestones.taskView", "map"));
    await desktop.reload({ waitUntil: "networkidle" });
    await waitSettled(desktop);
    await saveWebp(await desktop.screenshot({ type: "png" }), "milestone-detail");

    await shoot(desktop, "/app/pipeline", "pipeline");
    await shoot(desktop, "/app/kontakty", "contacts");
    await shoot(desktop, "/app/cold-calling", "cold-calling");
    await shoot(desktop, "/app/kalendar", "calendar");
    await shoot(desktop, "/app/finance", "finance");
    await shoot(desktop, "/app", "jarvis", async (page) => {
      await page.locator('[data-tour="jarvis"]').click();
      await page.waitForTimeout(600);
    });

    await desktopContext.close();

    // ---- Mobile, 390×844, dark theme, 2× --------------------------------
    const mobileContext = await browser.newContext({
      viewport: MOBILE,
      deviceScaleFactor: SCALE,
      colorScheme: "dark",
      reducedMotion: "reduce",
      locale: "cs-CZ",
      isMobile: true,
      hasTouch: true,
    });
    const mobile = await mobileContext.newPage();
    await login(mobile);

    await shoot(mobile, "/app", "dashboard-mobile");
    await shoot(mobile, "/app/pipeline", "pipeline-mobile");
    await shoot(mobile, "/app/cold-calling", "cold-calling-mobile");

    await mobileContext.close();
  } finally {
    await browser.close();
    devServer?.kill();
  }

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
