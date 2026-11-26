import type { Page } from "@playwright/test";
import { admin, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { waitForApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string) => text(L, key);

/** 240 px with labels, 76 px (--spacing(19)) as an icon rail; the test runs at 1440 px. */
const EXPANDED = 240;
const COLLAPSED = 76;

function sidebar(page: Page) {
  return page.locator("aside:has(nav)");
}

async function sidebarWidth(page: Page) {
  return Math.round((await sidebar(page).boundingBox())?.width ?? 0);
}

/** The logo's box and where its bars start: the name folds, the bars never move. */
async function logoBox(page: Page) {
  const logo = sidebar(page).getByTestId("folding-logo");
  const box = await logo.boundingBox();
  const bars = await logo.locator("rect").first().boundingBox();
  return { width: Math.round(box?.width ?? 0), barsX: Math.round(bars?.x ?? 0) };
}

async function savedCollapsed(userId: string) {
  const { data } = await admin()
    .from("user_settings")
    .select("sidebar_collapsed")
    .eq("user_id", userId)
    .single();
  return data?.sidebar_collapsed;
}

test("39 · sidebar: collapse, survives a reload, ⌘B expands", async ({ page, accounts }) => {
  const account = await accounts.create({ label: "sidebar" });
  await signIn(page, account);

  // Expanded by default: labels next to the icons.
  await expect.poll(() => sidebarWidth(page)).toBe(EXPANDED);
  const collapse = sidebar(page).getByRole("button", { name: exact(L, "nav.sidebar.collapse") });
  await expect(collapse).toBeVisible();
  await expect(sidebar(page).getByText(t("nav.pipeline"), { exact: true })).toBeVisible();

  const open = await logoBox(page);
  expect(open.width).toBeGreaterThan(90);

  await collapse.click();
  await expect.poll(() => sidebarWidth(page)).toBe(COLLAPSED);
  // The name slid into the bars: the box is the bars alone, at the same place.
  await expect.poll(async () => (await logoBox(page)).width).toBeLessThan(50);
  expect((await logoBox(page)).barsX).toBe(open.barsX);
  await expect(sidebar(page).getByText(t("nav.pipeline"), { exact: true })).toBeHidden();
  await expect.poll(() => savedCollapsed(account.id)).toBe(true);

  // The server already sends the collapsed menu: no flash of the wide one.
  const html = await (await page.request.get("/app")).text();
  expect(html).toContain('data-sidebar="collapsed"');

  await page.reload();
  await waitForApp(page);
  expect(await sidebarWidth(page)).toBe(COLLAPSED);
  await expect(
    sidebar(page).getByRole("button", { name: exact(L, "nav.sidebar.expand") }),
  ).toBeVisible();

  // Only icons now: the name comes as a tooltip on hover.
  await sidebar(page).getByRole("link", { name: t("nav.pipeline"), exact: true }).hover();
  await expect(page.locator("[data-sidebar-tooltip]")).toHaveText(t("nav.pipeline"));

  // ⌘B / Ctrl+B expands it again, and that is saved too.
  await page.mouse.move(800, 400);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("ControlOrMeta+B");
  await expect.poll(() => sidebarWidth(page)).toBe(EXPANDED);
  await expect(sidebar(page).getByText(t("nav.pipeline"), { exact: true })).toBeVisible();
  await expect.poll(() => savedCollapsed(account.id)).toBe(false);
});
