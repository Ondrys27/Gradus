import { defineConfig, devices } from "@playwright/test";
import "./tests/e2e/support/env";

/**
 * End-to-end tests of the main journeys: `bun run e2e`.
 * They run against the local dev server (started if it is not running) and
 * the database from .env / .env.local, with throw-away internal accounts
 * (e2e-…@gradus.local) that are removed again.
 */
const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["support/**"],
  globalSetup: "./tests/e2e/support/global-setup.ts",
  globalTeardown: "./tests/e2e/support/global-cleanup.ts",
  // The dev server compiles pages on first visit; a cold route can take a while.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 2,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: baseURL,
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 60_000,
    actionTimeout: 20_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  // E2E_BASE_URL points the run at another server: a dev server already
  // running on another port (never start a second `next dev` in this folder,
  // two dev servers share .next and answer 500), or a production build:
  //   NEXT_DIST_DIR=.next-e2e bun run build
  //   NEXT_DIST_DIR=.next-e2e bunx next start -p 3100
  //   E2E_BUILD=1 E2E_BASE_URL=http://localhost:3100 bun run e2e
  // Without it the dev server on :3000 is used and started when not running.
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "bun run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
