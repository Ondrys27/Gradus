/**
 * Records the showcase (step 27.4) without a person: signs in with a
 * throw-away internal account (e2e-…@gradus.local, made an administrator
 * for the run; outside production such an account may present without the
 * administration's switch), starts the showcase, which plays in its own
 * stage account, and keeps the video Playwright records, with the captions
 * as .srt from the times the player measured. Both accounts are gone
 * afterwards (the stage deletes itself; this script checks).
 *
 *   bun run demo:record -- --scenar a --jazyk cs,en --velikost 1920x1080,1080x1920
 *
 * Output: marketing/videa/<scenar>-<jazyk>-<velikost>.mp4 (.webm without
 * ffmpeg) and .srt next to it. With ffmpeg on the PATH the video is
 * converted to H.264 and trimmed to the countdown … end card; without it the
 * .webm stays as recorded (convert later:
 *   ffmpeg -i in.webm -c:v libx264 -pix_fmt yuv420p -crf 18 out.mp4).
 * Needs the dev server on :3000 (or DEMO_BASE_URL) and the database keys
 * from .env / .env.local (read by code, never printed).
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser } from "@playwright/test";
import { admin, createAccount, deleteAccount, signIn } from "../tests/e2e/support/accounts";
import {
  recordingName,
  SCENARIO_IDS,
  SHOWCASE_SIZES,
  showcaseHref,
  sizeOf,
  type ScenarioChoice,
  type ShowcaseParams,
  type ShowcaseSize,
} from "../src/features/tutorial/showcase/params";
import { toSrt } from "../src/features/tutorial/showcase/srt";
import type { Locale } from "../src/i18n/locales";

const BASE_URL = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const OUT = path.join(process.cwd(), "marketing/videa");
/** The longest a scenario may take, the countdown and the cleanup included. */
const PLAY_TIMEOUT_MS = 6 * 60_000;
const ZONES: Record<Locale, string> = { cs: "Europe/Prague", en: "Europe/London" };
const BROWSER_LOCALES: Record<Locale, string> = { cs: "cs-CZ", en: "en-GB" };
const WARM_PATHS = [
  "/app/milniky",
  "/app/poznamky",
  "/app/kontakty",
  "/app/cold-calling",
  "/app/pipeline",
  "/app/ukoly-crm",
  "/app/kalendar",
  "/app/planovac",
  "/app/finance",
  "/app/firma",
  "/app/zpravy",
  "/app",
];

type Recording = {
  phase: string;
  countdownAt: number | null;
  playAt: number | null;
  outroAt: number | null;
  cues: { caption: string; start: number; end: number }[];
  error: { step: string; reason: string } | null;
};

function argList(name: string): string[] {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return [];
  return (process.argv[index + 1] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function choices(): ShowcaseParams[] {
  const scenarios = (argList("scenar").length ? argList("scenar") : ["f"]).map((value) =>
    value === "vse" || value === "all" ? "all" : value,
  );
  const languages = argList("jazyk").length ? argList("jazyk") : ["cs"];
  const sizes = argList("velikost").length ? argList("velikost") : ["1920x1080"];
  const list: ShowcaseParams[] = [];
  for (const scenario of scenarios) {
    if (scenario !== "all" && !(SCENARIO_IDS as readonly string[]).includes(scenario)) {
      throw new Error(`Unknown scenario ${scenario} (a–f or vse)`);
    }
    for (const locale of languages) {
      if (locale !== "cs" && locale !== "en") throw new Error(`Unknown language ${locale} (cs, en)`);
      for (const size of sizes) {
        if (!(SHOWCASE_SIZES as readonly string[]).includes(size)) {
          throw new Error(`Unknown size ${size} (${SHOWCASE_SIZES.join(", ")})`);
        }
        list.push({ scenario: scenario as ScenarioChoice, locale, size: size as ShowcaseSize });
      }
    }
  }
  return list;
}

function hasFfmpeg(): boolean {
  return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
}

function seconds(ms: number) {
  return (ms / 1000).toFixed(1);
}

async function recordOne(browser: Browser, params: ShowcaseParams, ffmpeg: boolean) {
  const name = recordingName(params);
  const { width, height } = sizeOf(params.size);
  const presenter = await createAccount({ label: "demo-record", locale: params.locale });
  let stageId: string | null = null;
  const work = mkdtempSync(path.join(tmpdir(), "gradus-demo-"));
  try {
    const role = await admin()
      .from("user_roles")
      .insert({ user_id: presenter.id, role: "admin", level: "full" });
    if (role.error) throw role.error;

    // Signed in and on the stage in a context without video: the video starts on the stage.
    const setup = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1440, height: 900 } });
    const setupPage = await setup.newPage();
    await signIn(setupPage, presenter);
    // The dev server compiles a page on its first visit; done here, the video never waits for it.
    for (const warm of WARM_PATHS) {
      await setupPage.goto(warm, { waitUntil: "domcontentloaded", timeout: 120_000 }).catch(() => undefined);
    }
    const started = await setupPage.request.post("/api/showcase/stage", {
      data: { scenar: params.scenario === "all" ? "vse" : params.scenario, jazyk: params.locale, velikost: params.size },
      timeout: 120_000,
    });
    if (!started.ok()) throw new Error(`The stage was not made: ${started.status()}`);
    stageId = ((await started.json()) as { stage?: string }).stage ?? null;
    const storageState = await setup.storageState();
    await setup.close();

    const context = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width, height },
      deviceScaleFactor: 1,
      locale: BROWSER_LOCALES[params.locale],
      timezoneId: ZONES[params.locale],
      colorScheme: "dark",
      storageState,
      recordVideo: { dir: work, size: { width, height } },
    });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
    const page = await context.newPage();
    const videoStart = Date.now();
    page.on("pageerror", (error) => console.log(`  page error: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        console.log(`  console ${message.type()}: ${message.text().slice(0, 300)}`);
      }
    });
    await page.goto(showcaseHref(params), { waitUntil: "domcontentloaded", timeout: 120_000 });
    // DEMO_SHOTS=<dir>: a screenshot every 2 s while it plays, to see where a step went wrong.
    const shots = process.env.DEMO_SHOTS;
    let shot = 0;
    const timer = shots
      ? setInterval(() => {
          shot += 1;
          void page
            .screenshot({ path: path.join(shots, `${name}-${String(shot).padStart(3, "0")}.png`) })
            .catch(() => undefined);
        }, 2000)
      : null;
    await page.waitForFunction(
      () => ["outro", "failed", "ended"].includes(document.documentElement.dataset.showcaseState ?? ""),
      undefined,
      { timeout: PLAY_TIMEOUT_MS, polling: 500 },
    );
    const recording = (await page.evaluate(() => window.__gradusShowcase ?? null)) as Recording | null;
    if (timer) clearInterval(timer);
    await page.waitForFunction(() => document.documentElement.dataset.showcaseState === "ended", undefined, {
      timeout: 60_000,
      polling: 250,
    });
    const endedAt = Date.now();
    const video = page.video();
    await context.close();
    const recorded = video ? await video.path() : null;
    if (!recorded) throw new Error("No video was recorded");

    mkdirSync(OUT, { recursive: true });
    const countdownOffset = recording?.countdownAt ? recording.countdownAt - videoStart : 0;
    const playOffset = recording?.playAt ? recording.playAt - videoStart : 0;
    const endOffset = recording?.outroAt ? recording.outroAt - videoStart + 3500 : endedAt - videoStart;
    let file: string;
    let start = 0;
    if (ffmpeg) {
      start = Math.max(0, countdownOffset - 300);
      file = path.join(OUT, `${name}.mp4`);
      const result = spawnSync(
        "ffmpeg",
        [
          "-y",
          "-ss", seconds(start),
          "-i", recorded,
          "-t", seconds(endOffset - start),
          "-c:v", "libx264",
          "-pix_fmt", "yuv420p",
          "-crf", "18",
          "-movflags", "+faststart",
          "-an",
          file,
        ],
        { stdio: "ignore" },
      );
      if (result.status !== 0) throw new Error("ffmpeg could not convert the video");
    } else {
      file = path.join(OUT, `${name}.webm`);
      copyFileSync(recorded, file);
    }
    writeFileSync(path.join(OUT, `${name}.srt`), toSrt(recording?.cues ?? [], playOffset - start));
    const length = (ffmpeg ? endOffset - start : endedAt - videoStart) / 1000;
    const size = statSync(file).size;
    const failed = recording?.error ? ` · FAILED at ${recording.error.step}: ${recording.error.reason}` : "";
    console.log(
      `${path.relative(process.cwd(), file)} · ${width}×${height} · ${length.toFixed(1)} s` +
        ` (playing ${((endOffset - playOffset) / 1000).toFixed(1)} s) · ${(size / 1024 / 1024).toFixed(1)} MB${failed}`,
    );
    return { file, length, size, failed: Boolean(recording?.error) };
  } finally {
    rmSync(work, { recursive: true, force: true });
    await deleteAccount(presenter.id).catch(() => undefined);
    // The stage deletes itself at the end; a run cut short leaves it to this.
    if (stageId) await deleteStageLeftover(stageId).catch(() => undefined);
  }
}

/** A stage left by a run cut short, with its colleague (…-team@gradus.local). */
async function deleteStageLeftover(stageId: string) {
  const { data: workers } = await admin()
    .from("workers")
    .select("user_id")
    .eq("owner_id", stageId)
    .not("user_id", "is", null)
    .limit(20);
  for (const worker of workers ?? []) {
    if (!worker.user_id) continue;
    const { data } = await admin().auth.admin.getUserById(worker.user_id);
    const email = data?.user?.email ?? "";
    if (/^showcase-[a-z0-9-]+@gradus\.local$/i.test(email)) await deleteAccount(worker.user_id);
  }
  await deleteAccount(stageId);
}

async function main() {
  const list = choices();
  const ffmpeg = hasFfmpeg();
  if (!ffmpeg) {
    console.log("ffmpeg is not on the PATH: the videos stay .webm (convert with");
    console.log("  ffmpeg -i in.webm -c:v libx264 -pix_fmt yuv420p -crf 18 out.mp4)");
  }
  const browser = await chromium.launch();
  let failures = 0;
  try {
    for (const params of list) {
      console.log(`Recording ${recordingName(params)} …`);
      const result = await recordOne(browser, params, ffmpeg);
      if (result.failed) failures += 1;
    }
  } finally {
    await browser.close();
  }
  if (failures) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
