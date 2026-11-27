/**
 * Screenshots of the appearance work (30.6 / 30.7) as an owner, at 1440 and
 * 390 px, into docs/vzhledy/<before|after>/: the theme picker with the
 * schedule and its timeline, the custom theme editor, and the transition
 * caught mid-flight. On the phone-sized context the transition is also
 * measured: frames are counted while it plays and the longest gap between
 * two frames is printed, so a choppy choreography shows as a number.
 *
 * Makes a throw-away account (e2e-…@gradus.local, tool mode so every built-in
 * theme is open and the transition into "Večer" wears Sunset) and removes it
 * again. Needs the dev server on :3000 (or
 * SHOT_BASE_URL).
 *
 *   bun scripts/appearance-shots.ts before|after
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { admin, createAccount, deleteAccount, signIn } from "../tests/e2e/support/accounts";

const ROOT = process.cwd();
const BASE_URL = process.env.SHOT_BASE_URL ?? "http://localhost:3000";
const phase = process.argv[2] === "after" ? "after" : "before";
const OUT = path.join(ROOT, "docs/vzhledy", phase);
const ZONE = "Europe/Prague";

const SCHEDULE = {
  v: 1,
  enabled: true,
  mode: "same",
  days: {
    all: [
      { id: "m", name: "Ráno", start: 6 * 60, theme: "gradus", caption: "Káva a plán dne" },
      { id: "a", name: "Odpoledne", start: 12 * 60 + 30, theme: "midnight", caption: null },
      { id: "e", name: "Večer", start: 18 * 60, theme: "sunset", caption: "Uzavřít den" },
    ],
  },
};

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function shoot(page: Page, name: string, fullPage = true) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
  console.log(`  ${name}.png`);
}

/** The settings page, the schedule with the timeline and the editor. */
async function shootPages(page: Page, suffix: string) {
  await page.goto(`${BASE_URL}/app/nastaveni/vzhled`, { waitUntil: "networkidle" }).catch(() => {});
  await settle(page);
  await shoot(page, `appearance-${suffix}`);
  const timeline = page.getByTestId("schedule-timeline");
  if (await timeline.count()) {
    await timeline.scrollIntoViewIfNeeded();
    await timeline.screenshot({ path: path.join(OUT, `timeline-${suffix}.png`) });
    console.log(`  timeline-${suffix}.png`);
  }
  await page.goto(`${BASE_URL}/app/nastaveni/vzhled/vlastni`, { waitUntil: "networkidle" }).catch(() => {});
  await settle(page);
  await shoot(page, `editor-${suffix}`, false);
}

/**
 * The transition, caught at a few moments of the preview of the selected
 * block ("Večer"); the frame timing is measured on the phone-sized context.
 */
async function shootTransition(page: Page, suffix: string, measure: boolean) {
  await page.goto(`${BASE_URL}/app/nastaveni/vzhled`, { waitUntil: "networkidle" }).catch(() => {});
  await settle(page);
  const previews = page.getByTestId("schedule-preview");
  if ((await previews.count()) === 0) return;
  const moments = [350, 900, 1500, 2200];
  for (const at of moments) {
    await previews.last().scrollIntoViewIfNeeded();
    await previews.last().click();
    await page.waitForTimeout(at);
    await shoot(page, `transition-${suffix}-${at}ms`, false);
    await page.locator("[data-theme-transition]").waitFor({ state: "detached", timeout: 6_000 }).catch(() => {});
    await page.waitForTimeout(1_800);
  }
  if (!measure) return;
  await previews.last().click();
  const stats = await page.evaluate(
    () =>
      new Promise<{ frames: number; longest: number; over32: number; ms: number }>((resolve) => {
        const started = performance.now();
        let last = started;
        let frames = 0;
        let longest = 0;
        let over32 = 0;
        const tick = (now: number) => {
          frames += 1;
          const gap = now - last;
          if (gap > longest) longest = gap;
          if (gap > 32) over32 += 1;
          last = now;
          if (now - started < 2_800) requestAnimationFrame(tick);
          else resolve({ frames, longest: Math.round(longest), over32, ms: Math.round(now - started) });
        };
        requestAnimationFrame(tick);
      }),
  );
  console.log(
    `  transition frames (${suffix}): ${stats.frames} in ${stats.ms} ms, longest gap ${stats.longest} ms, ${stats.over32} gaps over 32 ms`,
  );
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const owner = await createAccount({ label: "shotappearance", mode: "tool" });
  const { error } = await admin()
    .from("user_settings")
    .update({ theme_schedule: SCHEDULE, theme_override_until: null })
    .eq("user_id", owner.id);
  if (error) throw error;
  const browser = await chromium.launch();
  try {
    const desktop = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1440, height: 900 },
      locale: "cs-CZ",
      timezoneId: ZONE,
      colorScheme: "dark",
    });
    const first = await desktop.newPage();
    await signIn(first, owner);
    await first.close();
    const page = await desktop.newPage();
    await shootPages(page, "1440");
    await shootTransition(page, "1440", false);
    await page.close();
    const state = await desktop.storageState();
    const mobile = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: "cs-CZ",
      timezoneId: ZONE,
      colorScheme: "dark",
      storageState: state,
    });
    const small = await mobile.newPage();
    await shootPages(small, "390");
    await shootTransition(small, "390", true);
    await small.close();
  } finally {
    await browser.close();
    await deleteAccount(owner.id);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
