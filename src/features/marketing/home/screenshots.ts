import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Screenshots of the app on the website. `bun run screenshots` (prompt 10.3)
 * writes them to /public/screenshots as WebP at 2× of a 1440×900 viewport.
 * Until a file exists the page shows a drawn stand-in of the same size.
 */
export const SCREENSHOT_NAMES = [
  "dashboard",
  "milestones",
  "pipeline",
  "cold-calling",
  "calendar",
  "finance",
  "jarvis",
] as const;
export type ScreenshotName = (typeof SCREENSHOT_NAMES)[number];

export const SCREENSHOT_WIDTH = 2880;
export const SCREENSHOT_HEIGHT = 1800;

/** The phone shots (390×844 at 2×), for the hero and the Cold Calling feature. */
export const MOBILE_SCREENSHOT_NAMES = ["dashboard-mobile", "pipeline-mobile", "cold-calling-mobile"] as const;
export type MobileScreenshotName = (typeof MOBILE_SCREENSHOT_NAMES)[number];

export const MOBILE_SCREENSHOT_WIDTH = 780;
export const MOBILE_SCREENSHOT_HEIGHT = 1688;

function screenshotPath(name: string): string {
  return `/screenshots/${name}.webp`;
}

/** The public path of a screenshot when the file is there; checked at build time. */
export function screenshotSrc(name: ScreenshotName, root: string = process.cwd()): string | null {
  const file = path.join(root, "public", "screenshots", `${name}.webp`);
  return existsSync(file) ? screenshotPath(name) : null;
}

/** Same, for a phone-sized shot. */
export function mobileScreenshotSrc(
  name: MobileScreenshotName,
  root: string = process.cwd(),
): string | null {
  const file = path.join(root, "public", "screenshots", `${name}.webp`);
  return existsSync(file) ? screenshotPath(name) : null;
}
