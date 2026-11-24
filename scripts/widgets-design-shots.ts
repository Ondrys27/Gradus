/**
 * Screenshots of the dashboard of widgets (28.5 / 28.6) at 1440, 820 and
 * 390 px into docs/widgets-design/<before|after>/. Makes a throw-away owner
 * (e2e-…@gradus.local, game mode) with contacts, deals, tasks, meetings,
 * milestones, money and a pinned note, gives them one board with every widget
 * at its default size and one board per size with every widget that has it,
 * and removes the account again (cascade). Needs the dev server on :3000
 * (or SHOT_BASE_URL).
 *
 *   bun scripts/widgets-design-shots.ts before|after [scene]
 *   bun scripts/widgets-design-shots.ts fps        # frame rate of editing with 20 widgets
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { WIDGETS, type WidgetMeta } from "../src/features/dashboard/widgets/catalog";
import { withPositions, type WidgetSize } from "../src/features/widgets/grid";
import type { Json } from "../src/types/database";
import { admin, createAccount, deleteAccount, signIn, type Account } from "../tests/e2e/support/accounts";

const ROOT = process.cwd();
const BASE_URL = process.env.SHOT_BASE_URL ?? "http://localhost:3000";
const phase = process.argv[2] === "after" ? "after" : process.argv[2] === "fps" ? "fps" : "before";
const OUT = path.join(ROOT, "docs/widgets-design", phase);
const only = process.argv[3];

const WIDTHS = [1440, 820, 390] as const;
type Width = (typeof WIDTHS)[number];

type Boards = { main: string | null; sizes: Record<WidgetSize, string> };
type Scene = { name: string; widths?: readonly Width[]; run: (page: Page, boards: Boards) => Promise<void> };

const DAY = 86_400_000;
const iso = (offsetDays: number, hour = 9, minute = 0) => {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return new Date(d.getTime() + offsetDays * DAY).toISOString();
};
const day = (offsetDays: number) => iso(offsetDays).slice(0, 10);

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1400);
}

async function openBoard(page: Page, id: string | null) {
  await page.goto(`${BASE_URL}/app${id ? `?board=${id}` : ""}`, { waitUntil: "networkidle" }).catch(() => {});
  await page.getByTestId("widget").first().waitFor({ timeout: 30_000 });
  // Widgets below the fold load when scrolled near: scroll through once.
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await settle(page);
}

const SCENES: Scene[] = [
  { name: "board", run: (page, boards) => openBoard(page, boards.main) },
  {
    name: "editing",
    run: async (page, boards) => {
      await openBoard(page, boards.main);
      await page.getByTestId("board-edit").click();
      await page.waitForTimeout(600);
    },
  },
  {
    name: "gallery",
    run: async (page, boards) => {
      await openBoard(page, boards.main);
      await page.getByTestId("board-edit").click();
      await page.getByTestId("board-add").click();
      await page.getByTestId("widget-gallery").waitFor();
      await settle(page);
    },
  },
  {
    name: "detail",
    run: async (page, boards) => {
      await openBoard(page, boards.main);
      await page
        .getByTestId("widget-grid")
        .locator('[data-widget="pipeline"]')
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
      widths: [1440, 390],
      run: (page, boards) => openBoard(page, boards.sizes[size]),
    }),
  ),
];

async function seed(owner: Account) {
  const db = admin();
  const uid = owner.id;
  const fail = (label: string, error: unknown) => {
    if (error) throw new Error(`${label}: ${JSON.stringify(error)}`);
  };

  const contacts = await db
    .from("contacts")
    .insert(
      [
        ["Novák & syn", "Petr", "Novák"],
        ["Kavárna Slunce", "Jana", "Svobodová"],
        ["Truhlářství Dřevo", "Karel", "Dvořák"],
        ["Fit studio Pohyb", "Lucie", "Horáková"],
        ["Pekárna U lípy", "Tomáš", "Král"],
      ].map(([company_name, first_name, last_name]) => ({ user_id: uid, company_name, first_name, last_name })),
    )
    .select("id");
  fail("contacts", contacts.error);
  const contactIds = (contacts.data ?? []).map((row) => row.id);

  const stages = await db.from("pipeline_stages").select("id, is_won, is_lost, position").eq("user_id", uid).order("position");
  fail("stages", stages.error);
  const open = (stages.data ?? []).filter((s) => !s.is_won && !s.is_lost);
  const won = (stages.data ?? []).find((s) => s.is_won);
  const lost = (stages.data ?? []).find((s) => s.is_lost);
  const stage = (index: number) => open[Math.min(index, open.length - 1)]?.id ?? open[0].id;

  const deals = await db
    .from("deals")
    .insert([
      { user_id: uid, title: "Web pro Nováka", value: 48000, stage_id: stage(0), contact_id: contactIds[0], expected_close_date: day(-3) },
      { user_id: uid, title: "Rebranding kavárny", value: 26000, stage_id: stage(1), contact_id: contactIds[1], expected_close_date: day(12) },
      { user_id: uid, title: "E-shop truhlářství", value: 120000, stage_id: stage(2), contact_id: contactIds[2], expected_close_date: day(20) },
      { user_id: uid, title: "Letáky fit studia", value: 9000, stage_id: stage(3), contact_id: contactIds[3], expected_close_date: day(5) },
      { user_id: uid, title: "Logo pekárny", value: 15000, stage_id: won?.id ?? stage(0), contact_id: contactIds[4], won_at: iso(-20) },
      { user_id: uid, title: "Fotky pro realitku", value: 7000, stage_id: won?.id ?? stage(0), won_at: iso(-40) },
      { user_id: uid, title: "Katalog nábytku", value: 30000, stage_id: lost?.id ?? stage(0), lost_at: iso(-30) },
    ])
    .select("id");
  fail("deals", deals.error);
  const dealIds = (deals.data ?? []).map((row) => row.id);

  fail(
    "crm_tasks",
    (
      await db.from("crm_tasks").insert([
        { user_id: uid, title: "Zavolat Novákovi kvůli nabídce", due_at: iso(-2, 10), deal_id: dealIds[0] },
        { user_id: uid, title: "Poslat návrh loga", due_at: iso(-1, 15), deal_id: dealIds[1] },
        { user_id: uid, title: "Připravit cenovou kalkulaci", due_at: iso(0, 14), deal_id: dealIds[2] },
        { user_id: uid, title: "Schůzka s Horákovou", due_at: iso(1, 9), contact_id: contactIds[3] },
      ])
    ).error,
  );

  fail(
    "calendar_events",
    (
      await db.from("calendar_events").insert([
        { user_id: uid, title: "Schůzka: Novák & syn", kind: "meeting", all_day: false, starts_at: iso(0, 13), ends_at: iso(0, 14) },
        { user_id: uid, title: "Prezentace rebrandingu", kind: "meeting", all_day: false, starts_at: iso(1, 10), ends_at: iso(1, 11) },
        { user_id: uid, title: "Káva s Dvořákem", kind: "meeting", all_day: false, starts_at: iso(3, 15), ends_at: iso(3, 16) },
        { user_id: uid, title: "Odevzdat letáky", kind: "task", all_day: false, starts_at: iso(2, 9), ends_at: iso(2, 9, 30) },
        { user_id: uid, title: "Fakturace", kind: "other", starts_at: iso(4, 8), all_day: true },
      ])
    ).error,
  );

  const milestones = await db
    .from("milestones")
    .insert([
      { user_id: uid, title: "Spustit nový web", status: "active" },
      { user_id: uid, title: "Získat 10 klientů", status: "active" },
      { user_id: uid, title: "Založit živnost", status: "active" },
    ])
    .select("id");
  fail("milestones", milestones.error);
  const [m1, m2, m3] = (milestones.data ?? []).map((row) => row.id);
  fail(
    "tasks",
    (
      await db.from("tasks").insert([
        { user_id: uid, milestone_id: m1, title: "Napsat texty na úvodní stránku", status: "done", completed_at: iso(0, 8), due_date: day(0) },
        { user_id: uid, milestone_id: m1, title: "Vybrat fotky", status: "todo", due_date: day(0) },
        { user_id: uid, milestone_id: m1, title: "Nastavit doménu", status: "todo", due_date: day(0) },
        { user_id: uid, milestone_id: m1, title: "Spustit a oznámit", status: "todo", due_date: day(7) },
        { user_id: uid, milestone_id: m2, title: "Oslovit 30 firem", status: "done", completed_at: iso(-2) },
        { user_id: uid, milestone_id: m2, title: "Domluvit 5 schůzek", status: "todo", due_date: day(-1) },
        { user_id: uid, milestone_id: m3, title: "Podat ohlášení", status: "done", completed_at: iso(-31) },
      ])
    ).error,
  );
  fail(
    "milestone done",
    (await db.from("milestones").update({ status: "completed", completed_at: iso(-30) }).eq("id", m3)).error,
  );

  const thisMonth = day(0).slice(0, 7);
  const lastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15).toISOString().slice(0, 7);
  fail(
    "transactions",
    (
      await db.from("transactions").insert([
        { user_id: uid, type: "income", amount: 15000, occurred_on: `${thisMonth}-03`, description: "Logo pekárny" },
        { user_id: uid, type: "income", amount: 22000, occurred_on: `${thisMonth}-10`, description: "Záloha web" },
        { user_id: uid, type: "expense", amount: 4200, occurred_on: `${thisMonth}-05`, description: "Software" },
        { user_id: uid, type: "expense", amount: 1800, occurred_on: `${thisMonth}-12`, description: "Doprava" },
        { user_id: uid, type: "income", amount: 28000, occurred_on: `${lastMonth}-08`, description: "Katalog" },
        { user_id: uid, type: "expense", amount: 6500, occurred_on: `${lastMonth}-14`, description: "Nájem" },
      ])
    ).error,
  );

  const invoices = await db.from("invoices").insert([
    {
      user_id: uid,
      status: "open",
      number: "2026-0007",
      customer_name: "Kavárna Slunce",
      amount: 12500,
      subtotal: 12500,
      total: 12500,
      issued_on: day(-30),
      due_on: day(-16),
      items: [{ id: "a", name: "Návrh", quantity: 1, unit: "ks", unit_price: 12500, vat_rate: 0 }],
    },
  ]);
  if (invoices.error) console.log("  (invoices skipped:", invoices.error.message, ")");

  fail(
    "prospecting_segments",
    (
      await db.from("prospecting_segments").insert([
        { user_id: uid, started_at: iso(0, 8, 5), ended_at: iso(0, 8, 47), end_reason: "pause" },
        { user_id: uid, started_at: iso(-1, 9), ended_at: iso(-1, 10, 20), end_reason: "pause" },
        { user_id: uid, started_at: iso(-2, 9), ended_at: iso(-2, 9, 35), end_reason: "pause" },
      ])
    ).error,
  );

  const note = await db.from("notes").insert({
    user_id: uid,
    space_id: uid,
    title: "Ideální zákazník",
    pinned: true,
    content: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Ideální zákazník" }] },
        { type: "paragraph", content: [{ type: "text", text: "Malá firma do 10 lidí, bez vlastního marketingu. Rozhoduje majitel, chce výsledek do měsíce." }] },
        { type: "paragraph", content: [{ type: "text", text: "Kde ho najdu: doporučení, místní síťování, Google Mapy." }] },
      ],
    },
    content_text: "Ideální zákazník\nMalá firma do 10 lidí, bez vlastního marketingu. Rozhoduje majitel, chce výsledek do měsíce.\nKde ho najdu: doporučení, místní síťování, Google Mapy.",
  });
  if (note.error) console.log("  (note skipped:", note.error.message, ")");

  const xp = await db.from("xp_events").insert([
    { user_id: uid, kind: "task_completed", idempotency_key: `shots-${uid}-1`, xp: 420 },
    { user_id: uid, kind: "deal_won", idempotency_key: `shots-${uid}-2`, xp: 230 },
  ]);
  if (xp.error) console.log("  (xp skipped:", xp.error.message, ")");

  const ownerWidgets = (WIDGETS as readonly WidgetMeta[]).filter((w) => w.requires.role !== "worker");
  const board = (entries: readonly (readonly [string, WidgetSize])[]) =>
    withPositions(
      entries.map(([widget, size], index) => ({ id: `s${index + 1}`, widget, size, x: 0, y: 0, settings: {} })),
    ) as unknown as Json;
  const rows = await db
    .from("dashboard_layouts")
    .insert([
      { user_id: uid, space_id: uid, is_default: true, position: 0, items: board(ownerWidgets.map((w) => [w.key, w.defaultSize] as const)) },
      ...(["S", "M", "L", "XL"] as const).map((size, index) => ({
        user_id: uid,
        space_id: uid,
        is_default: false,
        name: `Velikost ${size}`,
        position: index + 1,
        items: board(ownerWidgets.filter((w) => w.sizes.includes(size)).map((w) => [w.key, size] as const)),
      })),
    ])
    .select("id, is_default, name");
  fail("dashboard_layouts", rows.error);
  const boards: Boards = { main: null, sizes: { S: "", M: "", L: "", XL: "" } };
  for (const row of rows.data ?? []) {
    if (row.is_default) continue;
    const size = row.name?.slice(-2).trim() as WidgetSize;
    boards.sizes[size] = row.id;
  }
  return boards;
}

async function context(browser: Browser, width: Width, name: string) {
  return browser.newContext({
    baseURL: BASE_URL,
    viewport: { width, height: width === 390 ? 844 : width === 820 ? 1180 : 900 },
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

async function shoot(browser: Browser, owner: Account, scene: Scene, width: Width, boards: Boards) {
  const ctx = await context(browser, width, scene.name);
  const page = await ctx.newPage();
  try {
    await signIn(page, owner);
    await scene.run(page, boards);
    await page.screenshot({ path: path.join(OUT, `${scene.name}-${width}.png`), fullPage: scene.name !== "detail" });
    console.log(`  ${scene.name}-${width}.png`);
  } finally {
    await ctx.close();
  }
}

/**
 * Frames per second while the board of ~20 widgets wiggles in editing and
 * one widget is dragged across it, on the desktop viewport. Counts rAF ticks
 * over three seconds; 60 fps means the counter reaches ~180.
 */
async function measureFps(browser: Browser, owner: Account, boards: Boards) {
  for (const throttle of [1, 4]) {
    const ctx = await context(browser, 1440, `fps-${throttle}`);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    await signIn(page, owner);
    await openBoard(page, boards.main);
    await page.getByTestId("board-edit").click();
    await page.waitForTimeout(800);
    const idle = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let frames = 0;
          const start = performance.now();
          const tick = () => {
            frames += 1;
            if (performance.now() - start < 3000) requestAnimationFrame(tick);
            else resolve(frames / 3);
          };
          requestAnimationFrame(tick);
        }),
    );
    const first = await page.getByTestId("widget").first().boundingBox();
    const framesPromise = page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let frames = 0;
          const start = performance.now();
          const tick = () => {
            frames += 1;
            if (performance.now() - start < 2000) requestAnimationFrame(tick);
            else resolve(frames / 2);
          };
          requestAnimationFrame(tick);
        }),
    );
    if (first) {
      await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 40; i += 1) {
        await page.mouse.move(first.x + first.width / 2 + i * 14, first.y + first.height / 2 + i * 6);
        await page.waitForTimeout(40);
      }
      await page.mouse.up();
    }
    const dragging = await framesPromise;
    console.log(`  cpu ×${throttle}: wiggle ${idle.toFixed(0)} fps, drag ${dragging.toFixed(0)} fps`);
    await ctx.close();
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const owner = await createAccount({ label: "shotwidgets", mode: "game" });
  const browser = await chromium.launch();
  try {
    console.log("Seeding…");
    const boards = await seed(owner);
    if (phase === "fps") {
      await measureFps(browser, owner, boards);
      return;
    }
    for (const scene of SCENES) {
      if (only && scene.name !== only) continue;
      for (const width of scene.widths ?? WIDTHS) {
        await shoot(browser, owner, scene, width, boards);
      }
    }
  } finally {
    await browser.close();
    await deleteAccount(owner.id);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
