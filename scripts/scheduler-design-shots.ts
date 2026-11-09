/**
 * Screenshots of the public booking pages (24.4 / 24.5) at 1440 and 390 px
 * into docs/scheduler-design/<before|after>/. Makes a throw-away host
 * (e2e-…@gradus.local) with a booking profile, two meeting types and a
 * round-the-clock availability, books one meeting as a guest for the
 * confirmation screen, and removes the account again (cascade).
 * Needs the dev server on :3000 (or SHOT_BASE_URL).
 *
 *   bun scripts/scheduler-design-shots.ts before|after [scene]
 *   bun scripts/scheduler-design-shots.ts cpu     # main-thread load of the moving backdrop on a slow phone
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { admin, createAccount, deleteAccount, e2eEmail } from "../tests/e2e/support/accounts";

const ROOT = process.cwd();
const BASE_URL = process.env.SHOT_BASE_URL ?? "http://localhost:3000";
const phase = process.argv[2] === "after" ? "after" : process.argv[2] === "cpu" ? "cpu" : "before";
const OUT = path.join(ROOT, "docs/scheduler-design", phase);
const only = process.argv[3];

type Scene = {
  name: string;
  locale: "cs" | "en";
  run: (page: Page, paths: { host: string; type: string; manage: string }) => Promise<void>;
};

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(900);
}

async function openType(page: Page, href: string) {
  await page.goto(`${BASE_URL}${href}`, { waitUntil: "networkidle" }).catch(() => {});
  await page.getByTestId("booking-day").first().waitFor({ timeout: 30_000 });
  await settle(page);
}

async function pickTime(page: Page) {
  await page.getByTestId("booking-day").nth(1).click();
  await page.getByTestId("booking-time").nth(2).waitFor();
  await page.getByTestId("booking-time").nth(2).click();
  await page.getByTestId("booking-countdown").waitFor({ timeout: 20_000 });
  await settle(page);
}

const SCENES: Scene[] = [
  {
    name: "host",
    locale: "cs",
    run: async (page, paths) => {
      await page.goto(`${BASE_URL}${paths.host}`, { waitUntil: "networkidle" }).catch(() => {});
      await settle(page);
    },
  },
  {
    name: "type",
    locale: "cs",
    run: async (page, paths) => openType(page, paths.type),
  },
  {
    name: "type-en",
    locale: "en",
    run: async (page, paths) => openType(page, paths.type),
  },
  {
    name: "day",
    locale: "cs",
    run: async (page, paths) => {
      await openType(page, paths.type);
      await page.getByTestId("booking-day").nth(1).click();
      await page.getByTestId("booking-time").nth(2).waitFor();
      await settle(page);
    },
  },
  {
    name: "picked",
    locale: "cs",
    run: async (page, paths) => {
      await openType(page, paths.type);
      await pickTime(page);
    },
  },
  {
    name: "picked-en",
    locale: "en",
    run: async (page, paths) => {
      await openType(page, paths.type);
      await pickTime(page);
    },
  },
  {
    name: "result",
    locale: "cs",
    run: async (page, paths) => {
      await openType(page, paths.type);
      await pickTime(page);
      await page.getByLabel(/^Jméno/).fill("Jana Hostová");
      await page.getByLabel(/^E-mail/).fill(e2eEmail("shotguest"));
      await page.getByLabel(/^Telefon/).fill("777123456");
      await page.getByTestId("booking-submit").click();
      await page.getByTestId("booking-success").waitFor({ timeout: 30_000 });
      // Let the celebration play out before the picture.
      await page.waitForTimeout(2600);
      await settle(page);
    },
  },
  {
    name: "manage",
    locale: "cs",
    run: async (page, paths) => {
      if (!paths.manage) return;
      await page.goto(paths.manage, { waitUntil: "networkidle" }).catch(() => {});
      await settle(page);
    },
  },
];

async function shoot(
  browser: Browser,
  scene: Scene,
  width: 1440 | 390,
  paths: { host: string; type: string; manage: string },
): Promise<string> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: width === 1440 ? { width: 1440, height: 900 } : { width: 390, height: 844 },
    deviceScaleFactor: width === 1440 ? 1 : 2,
    isMobile: width === 390,
    hasTouch: width === 390,
    locale: scene.locale === "cs" ? "cs-CZ" : "en-US",
    timezoneId: "Europe/Prague",
    colorScheme: "dark",
    reducedMotion: "no-preference",
    extraHTTPHeaders: { "x-gradus-e2e-visitor": `shots-${scene.name}-${width}` },
  });
  const page = await context.newPage();
  let manage = paths.manage;
  try {
    await scene.run(page, paths);
    if (scene.name === "result") {
      manage = (await page.getByTestId("booking-manage-link").getAttribute("href")) ?? "";
    }
    await page.screenshot({ path: path.join(OUT, `${scene.name}-${width}.png`), fullPage: true });
    console.log(`  ${scene.name}-${width}.png`);
  } finally {
    await context.close();
  }
  return manage;
}

/**
 * How busy the main thread is while the page idles with its moving backdrop:
 * the phone viewport, CPU slowed 4×, ten seconds of nothing. The backdrop
 * animates transforms and opacity only, so the number should stay near zero
 * (the compositor's work is not in it, but that is what keeps it cheap).
 */
async function measureCpu(browser: Browser, typePath: string) {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      reducedMotion,
      extraHTTPHeaders: { "x-gradus-e2e-visitor": `shots-cpu-${reducedMotion}` },
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Performance.enable");
    await openType(page, typePath);
    await page.waitForTimeout(2000);
    const read = async () => {
      const { metrics } = await cdp.send("Performance.getMetrics");
      const value = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
      return { task: value("TaskDuration"), script: value("ScriptDuration"), layout: value("LayoutDuration") };
    };
    const before = await read();
    const seconds = 10;
    await page.waitForTimeout(seconds * 1000);
    const after = await read();
    const busy = ((after.task - before.task) / seconds) * 100;
    console.log(
      `  motion=${reducedMotion}: main thread ${busy.toFixed(2)} % busy over ${seconds} s ` +
        `(script ${((after.script - before.script) * 1000).toFixed(0)} ms, layout ${((after.layout - before.layout) * 1000).toFixed(0)} ms)`,
    );
    await context.close();
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const host = await createAccount({ label: "shotbooking", mode: "tool" });
  const db = admin();
  const browser = await chromium.launch();
  try {
    const handle = `shots-${Date.now().toString(36)}`;
    const profile = await db
      .from("scheduler_profiles")
      .insert({
        user_id: host.id,
        space_id: host.id,
        handle,
        display_name: "Ondřej Novák",
        headline: "Pomáhám řemeslníkům získat zakázky, které chtějí",
        bio: "Deset let v obchodu, posledních pět s živnostníky a malými firmami. Na úvodním hovoru si řekneme, kde vám utíkají zákazníci, a odejdete se třemi konkrétními kroky.",
        time_zone: "Europe/Prague",
        video_link: "https://meet.jit.si/gradus-shots",
        setup_done_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (profile.error) throw profile.error;
    await db.from("profiles").update({ company_name: "Novák Consulting" }).eq("id", host.id);
    const types = await db
      .from("event_types")
      .insert([
        {
          profile_id: profile.data.id,
          user_id: host.id,
          space_id: host.id,
          slug: "konzultace",
          name: "Konzultace",
          description:
            "Třicet minut nad vaším podnikáním. Projdeme, co vám teď nejvíc brzdí zakázky, a odnesete si tři kroky, které zvládnete do příštího týdne.",
          duration_min: 30,
          location_kind: "video",
          active: true,
          position: 0,
          min_notice_hours: 0,
          slot_step_min: 30,
          max_days_ahead: 30,
        },
        {
          profile_id: profile.data.id,
          user_id: host.id,
          space_id: host.id,
          slug: "schuzka",
          name: "Schůzka v kanceláři",
          description: "Hodina osobně. Projdeme nabídku, ceník a prodejní skript.",
          duration_min: 60,
          location_kind: "in_person",
          location_text: "Vodičkova 12, Praha 1",
          active: true,
          position: 1,
          min_notice_hours: 0,
          slot_step_min: 60,
          max_days_ahead: 30,
        },
      ])
      .select("slug");
    if (types.error) throw types.error;
    const rules = await db.from("availability_rules").insert(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        profile_id: profile.data.id,
        user_id: host.id,
        space_id: host.id,
        weekday,
        start_time: "00:00",
        end_time: "24:00",
      })),
    );
    if (rules.error) throw rules.error;

    const paths = { host: `/s/${handle}`, type: `/s/${handle}/konzultace`, manage: "" };
    if (phase === "cpu") {
      await measureCpu(browser, paths.type);
      return;
    }
    for (const scene of SCENES) {
      if (only && scene.name !== only) continue;
      for (const width of [1440, 390] as const) {
        const manage = await shoot(browser, scene, width, paths);
        if (manage) paths.manage = manage;
      }
    }
  } finally {
    await browser.close();
    await deleteAccount(host.id);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
