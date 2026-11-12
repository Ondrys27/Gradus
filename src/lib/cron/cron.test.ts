// @vitest-environment node
//
// Scheduled jobs (docs/cron.md): every cron route answers only Vercel Cron
// with CRON_SECRET, every one is scheduled in vercel.json, and every schedule
// runs at most once a day (Vercel Hobby refuses a deployment otherwise).

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const track = vi.fn(async () => undefined);
vi.mock("@/lib/analytics/track", () => ({ track, trackLater: vi.fn() }));
vi.mock("@/features/errors/alerts/server/capture", () => ({ captureServerError: vi.fn() }));

const { isCronRequest } = await import("./verify");
const { runCron } = await import("@/lib/analytics/instrument");

const ROOT = path.resolve(__dirname, "../../..");
const CRON_DIR = path.join(ROOT, "src/app/api/cron");
const GRADY_ROUTE = path.join(ROOT, "src/app/api/grady/route.ts");

type CronEntry = { path: string; schedule: string };
const crons: CronEntry[] = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8")).crons;
const cronDirs = readdirSync(CRON_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

function request(authorization?: string) {
  return new Request("https://example.com/api/cron/x", {
    headers: authorization ? { authorization } : {},
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("isCronRequest", () => {
  it("refuses everything while CRON_SECRET is not set", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(isCronRequest(request("Bearer "))).toBe(false);
    expect(isCronRequest(request())).toBe(false);
  });

  it("accepts only the exact bearer secret", () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect(isCronRequest(request("Bearer s3cret-value"))).toBe(true);
    expect(isCronRequest(request("Bearer s3cret-valuf"))).toBe(false);
    expect(isCronRequest(request("s3cret-value"))).toBe(false);
    expect(isCronRequest(request())).toBe(false);
  });
});

describe("runCron", () => {
  it("answers 401 and does not run the job without the secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    const work = vi.fn(async () => ({}));
    const response = await runCron("notes_trash", request("Bearer wrong"), work);
    expect(response.status).toBe(401);
    expect(work).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it("runs the job with the secret and records the run", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    const work = vi.fn(async () => ({ processed: 3, body: { removed: 3 } }));
    const response = await runCron("notes_trash", request("Bearer s3cret-value"), work);
    expect(response.status).toBe(200);
    expect(work).toHaveBeenCalledOnce();
    expect(track).toHaveBeenCalledWith(
      "cron_run",
      expect.objectContaining({ job: "notes_trash", ok: true, processed: 3 }),
      expect.anything(),
    );
  });
});

describe("cron routes", () => {
  it.each(cronDirs)("/api/cron/%s goes through runCron (CRON_SECRET)", (dir) => {
    const source = readFileSync(path.join(CRON_DIR, dir, "route.ts"), "utf8");
    expect(source).toMatch(/return runCron\(/);
    // Only GET, which Vercel Cron calls; nothing else that could skip the check.
    expect(source.match(/export (async )?function (\w+)/g)).toEqual(["export function GET"]);
  });

  it("the Grady jobs in /api/grady go through runCron too", () => {
    const source = readFileSync(GRADY_ROUTE, "utf8");
    expect(source).toMatch(/function watch\(request: Request\) \{\s+return runCron\("jarvis_watch"/);
    expect(source).toMatch(
      /function briefing\(request: Request\) \{\s+return runCron\("jarvis_briefing"/,
    );
  });
});

describe("vercel.json", () => {
  it("schedules every cron route exactly once", () => {
    const paths = crons.map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const dir of cronDirs) expect(paths).toContain(`/api/cron/${dir}`);
    expect(paths).toContain("/api/grady?task=watch");
    expect(paths).toContain("/api/grady?task=briefing");
  });

  it("lists only routes that exist", () => {
    for (const { path: route } of crons) {
      if (route.startsWith("/api/grady?task=")) continue;
      expect(cronDirs).toContain(route.replace("/api/cron/", ""));
    }
  });

  it.each(crons)("$path runs at most once a day ($schedule)", ({ schedule }) => {
    const [minute, hour, day, month, weekday] = schedule.split(" ");
    expect(minute).toMatch(/^\d{1,2}$/);
    expect(hour).toMatch(/^\d{1,2}$/);
    expect(Number(minute)).toBeLessThan(60);
    expect(Number(hour)).toBeLessThan(24);
    expect([day, month, weekday]).toEqual(["*", "*", "*"]);
  });

  it("is described in docs/cron.md", () => {
    const doc = readFileSync(path.join(ROOT, "docs/cron.md"), "utf8");
    for (const { path: route, schedule } of crons) {
      expect(doc).toContain(route);
      expect(doc).toContain(schedule);
    }
  });
});
