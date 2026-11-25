/**
 * Screenshots of the administration's overview of widgets (29.2 / 29.3) at
 * 1440 and 390 px into docs/admin-widgets/<before|after>/. Makes a throw-away
 * full administrator (e2e-…@gradus.local), a few error groups of its own, one
 * board with every widget at its default size and one board per size with
 * every widget that has it, signs in through the admin login (password, a new
 * authenticator), and removes the account and the errors again. Needs the dev
 * server on :3000 (or SHOT_BASE_URL).
 *
 *   bun scripts/admin-widgets-shots.ts before|after [scene]
 *   bun scripts/admin-widgets-shots.ts fps        # frame rate of editing with 25 widgets
 */
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { ADMIN_WIDGETS, type AdminWidgetMeta } from "../src/features/admin/dashboard/catalog";
import { withPositions, type WidgetSize } from "../src/features/widgets/grid";
import type { Json } from "../src/types/database";
import { admin, createAccount, deleteAccount, type Account } from "../tests/e2e/support/accounts";
import { exact, text } from "../tests/e2e/support/i18n";
import { totp } from "../tests/e2e/support/totp";

const ROOT = process.cwd();
const BASE_URL = process.env.SHOT_BASE_URL ?? "http://localhost:3000";
const phase = process.argv[2] === "after" ? "after" : process.argv[2] === "fps" ? "fps" : "before";
const OUT = path.join(ROOT, "docs/admin-widgets", phase);
const only = process.argv[3];
const L = "cs" as const;

const WIDTHS = [1440, 390] as const;
type Width = (typeof WIDTHS)[number];

type Boards = { sizes: Record<WidgetSize, string>; fps: string };
type Scene = { name: string; run: (page: Page, boards: Boards) => Promise<void> };

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1400);
}

async function openBoard(page: Page, id: string | null) {
  await page.goto(`${BASE_URL}/admin${id ? `?board=${id}` : ""}`, { waitUntil: "networkidle" }).catch(() => {});
  await page.getByTestId("widget").first().waitFor({ timeout: 30_000 });
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  // Every widget loads when scrolled near; wait until none shows its skeleton (a long phone page needs a while).
  for (let round = 0; round < 6; round += 1) {
    await settle(page);
    const loading = await page.locator('[data-testid="widget"] .animate-skeleton').count();
    if (loading === 0) break;
  }
}

const SCENES: Scene[] = [
  { name: "board", run: (page) => openBoard(page, null) },
  {
    name: "editing",
    run: async (page) => {
      await openBoard(page, null);
      await page.getByTestId("board-edit").click();
      await page.waitForTimeout(600);
    },
  },
  {
    name: "gallery",
    run: async (page) => {
      await openBoard(page, null);
      await page.getByTestId("board-edit").click();
      await page.getByTestId("board-add").click();
      await page.getByTestId("widget-gallery").waitFor();
      await settle(page);
    },
  },
  {
    name: "detail",
    run: async (page) => {
      await openBoard(page, null);
      await page
        .getByTestId("widget-grid")
        .locator('[data-widget="errors"]')
        .getByRole("button")
        .first()
        .evaluate((node) => (node as HTMLElement).click());
      await page.getByTestId("widget-detail").waitFor();
      await settle(page);
    },
  },
  ...(["S", "M", "L", "XL"] as const).map(
    (size): Scene => ({
      name: `size-${size}`,
      run: (page, boards) => openBoard(page, boards.sizes[size]),
    }),
  ),
];

const SHOT_TAG = "shots-admin-widgets";

/** A handful of error groups, so the Errors widget has something to triage. */
async function seedErrors(owner: Account): Promise<string[]> {
  const db = admin();
  const fingerprints: string[] = [];
  const groups = [
    { message: "TypeError: Cannot read properties of undefined (reading 'stage_id')", page: "/app/pipeline", source: "boundary", n: 14, users: 5, hoursAgo: 0.3 },
    { message: "Failed to fetch /api/grady: 503", page: "/app", source: "onerror", n: 6, users: 3, hoursAgo: 2 },
    { message: "Hydration failed because the server rendered HTML didn't match the client", page: "/app/kalendar", source: "render", n: 3, users: 2, hoursAgo: 5, returned: true },
    { message: "ResizeObserver loop completed with undelivered notifications", page: "/app/milniky", source: "onerror", n: 2, users: 1, hoursAgo: 20 },
  ];
  let serial = 0;
  for (const group of groups) {
    const fingerprint = createHash("sha256").update(`${SHOT_TAG}:${owner.id}:${group.message}`).digest("hex").slice(0, 32);
    fingerprints.push(fingerprint);
    const rows = Array.from({ length: group.n }, (_, index) => {
      serial += 1;
      return {
        code: `GR-${(serial + 100).toString(36).toUpperCase().padStart(6, "Z")}`,
        fingerprint,
        message: group.message,
        page: group.page,
        source: group.source,
        app_version: "shots",
        alert: "off",
        browser: "chrome",
        device: index % 3 === 0 ? "mobile" : "desktop",
        created_at: new Date(Date.now() - (group.hoursAgo + index * 0.4) * 3_600_000).toISOString(),
        user_id: index < group.users ? owner.id : null,
      };
    });
    const inserted = await db.from("error_events").insert(rows);
    if (inserted.error) throw new Error(`error_events: ${inserted.error.message}`);
    if (group.returned) {
      const marked = await db.from("error_groups").upsert({
        fingerprint,
        status: "new",
        returned_at: new Date(Date.now() - 3_600_000).toISOString(),
      });
      if (marked.error) throw new Error(`error_groups: ${marked.error.message}`);
    }
  }
  return fingerprints;
}

async function cleanErrors(fingerprints: string[]) {
  const db = admin();
  await db.from("error_events").delete().in("fingerprint", fingerprints);
  await db.from("error_groups").delete().in("fingerprint", fingerprints);
}

async function seedBoards(owner: Account): Promise<Boards> {
  const db = admin();
  const widgets = ADMIN_WIDGETS as readonly AdminWidgetMeta[];
  const board = (entries: readonly (readonly [string, WidgetSize])[]) =>
    withPositions(
      entries.map(([widget, size], index) => ({ id: `s${index + 1}`, widget, size, x: 0, y: 0, settings: {} })),
    ) as unknown as Json;
  // 25 widgets for the frame-rate run: every widget once, the first few twice.
  const fpsEntries = [...widgets, ...widgets.slice(0, Math.max(0, 25 - widgets.length))]
    .slice(0, 25)
    .map((w) => [w.key, w.defaultSize] as const);
  const rows = await db
    .from("admin_dashboard_layouts")
    .insert([
      { user_id: owner.id, is_default: true, position: 0, items: board(widgets.map((w) => [w.key, w.defaultSize] as const)) },
      ...(["S", "M", "L", "XL"] as const).map((size, index) => ({
        user_id: owner.id,
        is_default: false,
        name: `Velikost ${size}`,
        position: index + 1,
        items: board(widgets.filter((w) => w.sizes.includes(size)).map((w) => [w.key, size] as const)),
      })),
      { user_id: owner.id, is_default: false, name: "FPS", position: 5, items: board(fpsEntries) },
    ])
    .select("id, is_default, name");
  if (rows.error) throw new Error(`admin_dashboard_layouts: ${rows.error.message}`);
  const boards: Boards = { sizes: { S: "", M: "", L: "", XL: "" }, fps: "" };
  for (const row of rows.data ?? []) {
    if (row.is_default) continue;
    if (row.name === "FPS") boards.fps = row.id;
    else boards.sizes[row.name?.slice(-2).trim() as WidgetSize] = row.id;
  }
  return boards;
}

/** Password, a new authenticator, skip the backup (the admin login of the e2e). */
async function signInToAdmin(page: Page, account: Account) {
  await page.context().addCookies([{ name: "locale", value: L, url: BASE_URL }]);
  await page.goto(`${BASE_URL}/admin/prihlaseni`);
  await page.locator("#admin-email").fill(account.email);
  await page.locator("#admin-password").fill(account.password);
  await page.getByRole("button", { name: exact(L, "admin.login.submit") }).click();
  const verify = page.getByRole("heading", { name: exact(L, "admin.login.verifyTitle") });
  const enroll = page.getByText(text(L, "admin.login.secretLabel"));
  await Promise.race([verify.waitFor({ timeout: 30_000 }), enroll.waitFor({ timeout: 30_000 })]);
  if (await enroll.isVisible()) {
    const secret = (await page.locator("code").first().textContent())?.trim() ?? "";
    await page.locator("#admin-code").fill(totp(secret));
    await page.getByRole("button", { name: exact(L, "admin.login.enrollSubmit") }).click();
    await page.getByRole("button", { name: exact(L, "admin.login.backupSkip") }).click();
    return secret;
  }
  throw new Error("The account already has an authenticator");
}

/** Signs in once more with the known authenticator (a second browser context). */
async function signInAgain(page: Page, account: Account, secret: string) {
  await page.context().addCookies([{ name: "locale", value: L, url: BASE_URL }]);
  await page.goto(`${BASE_URL}/admin/prihlaseni`);
  await page.locator("#admin-email").fill(account.email);
  await page.locator("#admin-password").fill(account.password);
  await page.getByRole("button", { name: exact(L, "admin.login.submit") }).click();
  await page.getByRole("heading", { name: exact(L, "admin.login.verifyTitle") }).waitFor({ timeout: 30_000 });
  await page.locator("#admin-code").fill(totp(secret));
  await page.getByRole("button", { name: exact(L, "admin.login.verifySubmit") }).click();
  await page.getByTestId("admin-dashboard").waitFor({ timeout: 30_000 });
}

async function context(browser: Browser, width: Width, name: string) {
  return browser.newContext({
    baseURL: BASE_URL,
    viewport: { width, height: width === 390 ? 844 : 900 },
    deviceScaleFactor: width === 1440 ? 1 : 2,
    isMobile: width !== 1440,
    hasTouch: width !== 1440,
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    colorScheme: "dark",
    reducedMotion: "no-preference",
    extraHTTPHeaders: { "x-gradus-e2e-visitor": `shots-${name}-${width}` },
  });
}

/** The next 30-second window, so a TOTP code is never the one just used. */
async function nextCodeWindow() {
  await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 500));
}

/** The session cookies of one signed-in context, reused by every scene (one authenticator, one sign-in per window). */
async function freshSession(browser: Browser, owner: Account, secret: string | null, width: Width, name: string) {
  const ctx = await context(browser, width, name);
  const page = await ctx.newPage();
  if (secret === null) {
    secret = await signInToAdmin(page, owner);
  } else {
    await nextCodeWindow();
    await signInAgain(page, owner, secret);
  }
  return { ctx, page, secret };
}

async function measureFps(page: Page, boards: Boards) {
  const cdp = await page.context().newCDPSession(page);
  for (const throttle of [1, 4]) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    await openBoard(page, boards.fps);
    await page.getByTestId("board-edit").click();
    await page.waitForTimeout(800);
    const count = (ms: number) =>
      page.evaluate(
        (duration) =>
          new Promise<number>((resolve) => {
            let frames = 0;
            const start = performance.now();
            const tick = () => {
              frames += 1;
              if (performance.now() - start < duration) requestAnimationFrame(tick);
              else resolve(frames / (duration / 1000));
            };
            requestAnimationFrame(tick);
          }),
        ms,
      );
    const idle = await count(3000);
    const first = await page.getByTestId("widget").first().boundingBox();
    const dragging = count(2000);
    if (first) {
      await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 40; i += 1) {
        await page.mouse.move(first.x + first.width / 2 + i * 14, first.y + first.height / 2 + i * 6);
        await page.waitForTimeout(40);
      }
      await page.mouse.up();
    }
    console.log(`  cpu ×${throttle}: wiggle ${idle.toFixed(0)} fps, drag ${(await dragging).toFixed(0)} fps`);
    await page.getByTestId("board-edit").click();
    await page.waitForTimeout(300);
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const owner = await createAccount({ label: "shotadmin", mode: "tool" });
  const role = await admin().from("user_roles").insert({ user_id: owner.id, role: "admin", level: "full" });
  if (role.error) throw new Error(`user_roles: ${role.error.message}`);
  const browser = await chromium.launch();
  let fingerprints: string[] = [];
  try {
    console.log("Seeding…");
    fingerprints = await seedErrors(owner);
    const boards = await seedBoards(owner);
    let secret: string | null = null;
    for (const width of WIDTHS) {
      if (phase === "fps" && width !== 1440) continue;
      const session = await freshSession(browser, owner, secret, width, `w${width}`);
      secret = session.secret;
      try {
        if (phase === "fps") {
          await measureFps(session.page, boards);
          break;
        }
        for (const scene of SCENES) {
          if (only && scene.name !== only) continue;
          await scene.run(session.page, boards);
          await session.page.screenshot({
            path: path.join(OUT, `${scene.name}-${width}.png`),
            fullPage: scene.name !== "detail",
          });
          console.log(`  ${scene.name}-${width}.png`);
          await session.page.keyboard.press("Escape").catch(() => {});
        }
      } finally {
        await session.ctx.close();
      }
    }
  } finally {
    await browser.close();
    await cleanErrors(fingerprints);
    await deleteAccount(owner.id);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
