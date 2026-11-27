import type { Page } from "@playwright/test";
import { admin, signIn, skipCompanyTutorial } from "./support/accounts";
import { expect, test, watchConsole } from "./support/fixtures";
import { text } from "./support/i18n";
import { openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);
const ZONE = "Europe/Prague";

test.use({ reducedMotion: "reduce", timezoneId: ZONE });

/** Minute of the day in Prague, and the instant a later minute of today (or tomorrow) begins. */
function pragueMinute(now: number) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(now));
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return hour * 60 + minute;
}
/** Milliseconds from `now` until the wall clock in Prague next shows `minute`. */
function msUntil(now: number, minute: number) {
  const date = new Date(now);
  const seconds = date.getUTCSeconds() * 1000 + date.getUTCMilliseconds();
  const ahead = (minute - pragueMinute(now) + 1440) % 1440;
  return ahead * 60_000 - seconds;
}

const block = (id: string, name: string, start: number, theme: string, caption: string | null = null) => ({
  id,
  name,
  start: ((start % 1440) + 1440) % 1440,
  theme,
  caption,
});

async function htmlTheme(page: Page) {
  return page.evaluate(() => document.documentElement.dataset.theme);
}

/**
 * 30.6, the schedule: two blocks around now (plus a third a little later).
 * The clock runs to the next block with the app open → the transition plays
 * with its name and caption and the theme changes under it. Then, typing in
 * a field across the next boundary holds the transition back; it plays once
 * the typing stops.
 */
test("77 · theme schedule: the next block plays its transition, typing holds it back", async ({ page, accounts }) => {
  test.setTimeout(180_000);
  const owner = await accounts.create({ label: "theme-schedule", mode: "tool" });
  const db = admin();

  await signIn(page, owner);
  await page.clock.install();
  const now = await page.evaluate(() => Date.now());
  const m = pragueMinute(now);
  const next = m + 2;
  const later = m + 6;
  const blocks = [
    block("a", "E2E Ráno", m - 120, "gradus"),
    block("b", "E2E Dopoledne", next, "forest", "Káva a plán"),
    block("c", "E2E Poledne", later, "midnight"),
  ].sort((x, y) => x.start - y.start);
  const { error } = await db
    .from("user_settings")
    .update({ theme_schedule: { v: 1, enabled: true, mode: "same", days: { all: blocks } }, theme_override_until: null })
    .eq("user_id", owner.id);
  if (error) throw error;

  await openApp(page, "/app");
  await expect.poll(() => htmlTheme(page)).toBe("gradus");

  // The clock runs to just before the next block, then on its own over it, with the app open.
  const start = await page.evaluate(() => Date.now());
  await page.clock.runFor(Math.max(0, msUntil(start, next % 1440) - 2_000));
  const overlay = page.locator("[data-theme-transition]");
  await expect(overlay).toBeVisible({ timeout: 15_000 });
  await expect(overlay).toContainText("E2E Dopoledne");
  await expect(overlay).toContainText("Káva a plán");
  await expect(overlay).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(() => htmlTheme(page)).toBe("forest");

  // Typing across the next boundary: the transition waits.
  const search = page.locator("#settings-search");
  await openApp(page, "/app/nastaveni/vzhled");
  await expect.poll(() => htmlTheme(page)).toBe("forest");
  await search.click();
  const typingFrom = await page.evaluate(() => Date.now());
  const untilLater = msUntil(typingFrom, later % 1440);
  for (let elapsed = 0; elapsed < untilLater + 6_000; elapsed += 2_000) {
    await search.press("a");
    await page.clock.runFor(2_000);
  }
  await expect(overlay).toHaveCount(0);
  expect(await htmlTheme(page)).toBe("forest");

  // The typing stops: 5 seconds later the transition plays.
  await expect(overlay).toBeVisible({ timeout: 15_000 });
  await expect(overlay).toContainText("E2E Poledne");
  await expect(overlay).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(() => htmlTheme(page)).toBe("midnight");
});

/**
 * 30.6, a custom theme: the owner makes one in the editor (unreadable text
 * cannot be saved until fixed), it is put on at once; shares its code; a
 * worker of the company imports a copy through the link and wears it too.
 */
test("77 · custom theme: create with the contrast check, use it, share it with a colleague", async ({
  page,
  browser,
  accounts,
  consoleErrors,
}) => {
  test.setTimeout(180_000);
  const owner = await accounts.create({ label: "theme-owner", mode: "tool" });
  const person = await accounts.create({ label: "theme-colleague", mode: "tool" });
  const db = admin();
  const { error } = await db
    .from("workers")
    .insert({ owner_id: owner.id, user_id: person.id, name: "E2E Kolegyně", email: person.email, status: "active" });
  if (error) throw error;
  await skipCompanyTutorial(person.id, owner.id);

  await signIn(page, owner);
  await openApp(page, "/app/nastaveni/vzhled");
  await page.getByTestId("create-custom-theme").click();
  const editor = page.getByTestId("theme-editor");
  await expect(editor).toBeVisible();

  await editor.locator("#theme-editor-name").fill("E2E Oranžová");
  // The colour fields sit in a folded section (30.7); the one-colour hero is open.
  await editor.locator('[data-editor-section="colors"] > summary').click();
  await editor.locator("#theme-color-accent-hex").fill("#ff8a3d");
  // Dark text on a dark background: flagged, not savable.
  await editor.locator("#theme-color-ink-hex").fill("#20263f");
  const save = page.getByTestId("theme-editor-save");
  await expect(page.getByTestId("theme-contrast")).toContainText(t("settings.appearance.editor.contrast.fix"));
  await expect(save).toBeDisabled();
  await page.getByTestId("theme-contrast").getByRole("button", { name: t("settings.appearance.editor.contrast.fix") }).first().click();
  await expect(page.getByTestId("theme-contrast")).toContainText(t("settings.appearance.editor.contrast.ok"));
  await expect(save).toBeEnabled();
  await save.click();

  // Back in the settings, worn at once.
  await expect(page).toHaveURL(/\/app\/nastaveni\/vzhled$/);
  const option = page.locator('[data-theme-option^="custom:"]');
  await expect(option).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--color-violet")))
    .toBe("#ff8a3d");
  await expect(page.locator("html")).toHaveAttribute("data-custom-theme", "");
  const { data: stored } = await db.from("custom_themes").select("id, share_code").eq("user_id", owner.id).single();
  expect(stored?.share_code).toMatch(/^[2-9A-HJKMNP-TV-Z]{10}$/);

  // The first paint of a fresh load already wears it.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-custom-theme", "");

  // Share: the code in the dialog is the stored one.
  await page.getByTestId("custom-theme-menu").click();
  await page.getByRole("menuitem", { name: t("settings.appearance.shareAction") }).click();
  const code = await page.locator("#share-theme-code").inputValue();
  expect(code.replace("-", "")).toBe(stored?.share_code);
  await page.keyboard.press("Escape");

  // The colleague imports it through the link.
  const context = await browser.newContext({ locale: "cs-CZ", timezoneId: ZONE, reducedMotion: "reduce" });
  watchConsole(context, consoleErrors);
  try {
    const other = await context.newPage();
    await signIn(other, person);
    await openApp(other, `/app/nastaveni/vzhled?vzhled=${stored?.share_code}`);
    const dialog = other.getByTestId("import-theme-dialog");
    await expect(dialog.getByTestId("import-theme-name")).toHaveText("E2E Oranžová");
    await dialog.getByRole("button", { name: t("settings.appearance.import.add") }).click();
    await expect(other.locator("html")).toHaveAttribute("data-custom-theme", "");
    await expect
      .poll(() => other.evaluate(() => document.documentElement.style.getPropertyValue("--color-violet")))
      .toBe("#ff8a3d");
    const { data: copy } = await db.from("custom_themes").select("name").eq("user_id", person.id);
    expect(copy?.map((row) => row.name)).toEqual(["E2E Oranžová"]);
  } finally {
    await context.close();
  }
});
