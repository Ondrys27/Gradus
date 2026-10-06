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

export function screenshotPath(name: ScreenshotName): string {
  return `/screenshots/${name}.webp`;
}

/** The public path of a screenshot when the file is there; checked at build time. */
export function screenshotSrc(name: ScreenshotName, root: string = process.cwd()): string | null {
  const file = path.join(root, "public", "screenshots", `${name}.webp`);
  return existsSync(file) ? screenshotPath(name) : null;
}
