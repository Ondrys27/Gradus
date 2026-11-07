import { expect, type Page } from "@playwright/test";
import { exact, text, type Locale } from "./i18n";

/** Picks a tutorial on Jarvis's "How do you want to start?" (after onboarding or on request). */
export async function chooseTutorial(page: Page, mode: "none" | "quick" | "full") {
  const choice = page.getByTestId("tutorial-choice");
  await expect(choice).toBeVisible({ timeout: 30_000 });
  await choice.locator(`[data-tutorial-choice="${mode}"]`).click();
  await expect(choice).toBeHidden({ timeout: 30_000 });
}

/**
 * Takes the quick look (the former guided tour): picks it, walks every step
 * with Next and closes the last one with Done. Returns the keys of the steps
 * seen, by their titles' order.
 */
export async function finishTour(page: Page, locale: Locale) {
  await chooseTutorial(page, "quick");
  const tour = page.locator("[data-tutorial-overlay] [role=dialog]");
  await expect(tour).toBeVisible({ timeout: 30_000 });
  const next = tour.getByRole("button", { name: exact(locale, "tutorial.next") });
  const done = tour.getByRole("button", { name: exact(locale, "tutorial.done") });
  let steps = 1;
  for (; steps < 30; steps += 1) {
    await expect(next.or(done)).toBeVisible();
    if (await done.isVisible()) break;
    await next.click();
  }
  await done.click();
  await expect(page.locator("[data-tutorial-overlay]")).toHaveCount(0);
  return steps;
}

/** Confirms the full-screen celebration with this title and closes it. */
export async function closeCelebration(page: Page, locale: Locale, title: string | RegExp) {
  const celebration = page.getByRole("dialog", { name: title });
  await expect(celebration).toBeVisible();
  await celebration.getByRole("button", { name: exact(locale, "celebration.continue") }).click();
  await expect(celebration).toBeHidden();
}

export function t(locale: Locale) {
  return (key: string, values?: Record<string, string | number>) => text(locale, key, values);
}

/** Closes every queued celebration (a milestone can be followed by a new level), returns their titles. */
export async function closeAllCelebrations(page: Page, locale: Locale) {
  const titles: string[] = [];
  const continueButton = page
    .getByRole("dialog")
    .getByRole("button", { name: exact(locale, "celebration.continue") });
  // Give a queued one a moment to appear after the previous closes.
  for (let round = 0; round < 5; round += 1) {
    try {
      await continueButton.first().waitFor({ state: "visible", timeout: round === 0 ? 20_000 : 2_500 });
    } catch {
      break;
    }
    const dialog = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("button", { name: exact(locale, "celebration.continue") }) })
      .first();
    const title = (await dialog.getByRole("heading").first().textContent())?.trim() ?? "";
    titles.push(title);
    await continueButton.first().click();
    await expect(page.getByRole("dialog", { name: title, exact: true })).toHaveCount(0);
  }
  return titles;
}

/** The visible main navigation (the sidebar on wide screens, the bottom bar on phones). */
export function mainNav(page: Page, locale: Locale) {
  return page.getByRole("navigation", { name: text(locale, "nav.label") }).filter({ visible: true });
}

/**
 * Small wins (a first badge, a streak) can open a celebration in the middle of
 * a journey. While this is on, any celebration that covers the page is
 * confirmed with Continue so the journey goes on; the titles are collected.
 * Turn it off before asserting a celebration the journey expects.
 */
export async function dismissCelebrationsAutomatically(page: Page, locale: Locale) {
  const seen: string[] = [];
  const continueButton = page
    .getByRole("dialog")
    .getByRole("button", { name: exact(locale, "celebration.continue") });
  await page.addLocatorHandler(continueButton.first(), async (button) => {
    const name = await page
      .getByRole("dialog")
      .filter({ has: page.getByRole("button", { name: exact(locale, "celebration.continue") }) })
      .first()
      .getByRole("heading")
      .first()
      .textContent({ timeout: 1_000 })
      .catch(() => null);
    seen.push(name?.trim() || "?");
    await button.click();
  });
  return {
    seen,
    stop: () => page.removeLocatorHandler(continueButton.first()),
  };
}

/**
 * Waits until React has hydrated the app shell, so a click right after a full
 * page load is not lost on server-rendered markup.
 */
export async function waitForApp(page: Page) {
  await page.waitForFunction(() => {
    const menu = document.querySelector('[data-tour="account"]');
    return Boolean(menu && Object.keys(menu).some((key) => key.startsWith("__reactProps$")));
  });
}

/** Opens an app page with a full load and waits until it is interactive. */
export async function openApp(page: Page, path: string) {
  await page.goto(path);
  await waitForApp(page);
}
