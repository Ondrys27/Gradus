import type { Page } from "@playwright/test";
import { signIn, userClient, type Account } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { dismissCelebrationsAutomatically, mainNav } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

/** What could still be holding the page: inline locks on <html> and <body>. */
async function lockState(page: Page) {
  return page.evaluate(() => ({
    html: document.documentElement.getAttribute("style") ?? "",
    body: document.body.getAttribute("style") ?? "",
    htmlAttrs: [...document.documentElement.attributes].map((a) => a.name).join(","),
    overflowY: getComputedStyle(document.body).overflowY,
    pointerEvents: getComputedStyle(document.body).pointerEvents,
  }));
}

/** Scrolls with the mouse wheel over the page heading and expects the page to move. */
async function expectPageScrolls(page: Page, label: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const heading = page.locator("h1.page-title");
  await expect(heading).toBeVisible();
  const box = (await heading.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  const state = await lockState(page);
  for (let i = 0; i < 4; i += 1) await page.mouse.wheel(0, 300);
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { message: `${label}: ${JSON.stringify(state)}` })
    .toBeGreaterThan(100);
}

/** Enough milestones that the list is taller than the window. */
async function seedMilestones(account: Account, count: number) {
  const client = await userClient(account.email, account.password);
  const { error } = await client.from("milestones").insert(
    Array.from({ length: count }, (_, index) => ({
      user_id: account.id,
      title: `E2E Scroll ${index + 1}`,
      category: "work" as const,
    })),
  );
  if (error) throw error;
}

test("17 · milestones scroll after an in-app move, a dialog and the map", async ({ page, accounts }) => {
  const account = await accounts.create({ label: "scroll", mode: "tool" });
  await seedMilestones(account, 14);
  await signIn(page, account);
  await dismissCelebrationsAutomatically(page, L);
  const nav = mainNav(page, L);

  // From the dashboard through the menu, no reload.
  await nav.getByRole("link", { name: t("nav.milestones") }).click();
  await expect(page).toHaveURL(/\/app\/milniky$/);
  await expect(page.getByText("E2E Scroll 14")).toBeVisible();
  await expectPageScrolls(page, "menu");

  // After the "new milestone" dialog is opened and closed.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: exact(L, "milestones.actions.new") }).first().click();
  const form = page.getByRole("dialog", { name: t("milestones.form.createTitle") });
  await expect(form).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();
  await expectPageScrolls(page, "after dialog");

  // A milestone's detail with tasks: list, then map, then list again.
  await page.getByText("E2E Scroll 1", { exact: true }).click();
  await expect(page).toHaveURL(/\/app\/milniky\/[0-9a-f-]{36}$/);
  const quickAdd = page.getByRole("textbox", { name: exact(L, "milestones.tasks.addLabel") });
  for (const title of ["Úkol 1", "Úkol 2", "Úkol 3", "Úkol 4", "Úkol 5", "Úkol 6"]) {
    await quickAdd.fill(title);
    await quickAdd.press("Enter");
    await expect(page.getByRole("checkbox", { name: t("milestones.tasks.checkDone", { title }) })).toBeVisible();
  }
  await expectPageScrolls(page, "detail list");
  await page.getByRole("button", { name: exact(L, "milestones.tasks.view.map") }).click();
  const map = page.getByRole("region", { name: t("milestones.map.label") });
  await expect(map).toBeVisible();
  await expectPageScrolls(page, "detail map");

  // The wheel over the map scrolls the page; only Ctrl + wheel zooms the map.
  await page.evaluate(() => window.scrollTo(0, 0));
  const mapBox = (await map.boundingBox())!;
  await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + 40);
  const transformOf = () =>
    map.locator(".react-transform-component").evaluate((element) => getComputedStyle(element).transform);
  const before = await transformOf();
  for (let i = 0; i < 4; i += 1) await page.mouse.wheel(0, 200);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  expect(await transformOf()).toBe(before);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  await expect.poll(transformOf).not.toBe(before);

  await page.getByRole("button", { name: exact(L, "milestones.tasks.view.list") }).click();
  await expectPageScrolls(page, "detail list again");

  // Back to the overview through the menu.
  await nav.getByRole("link", { name: t("nav.milestones") }).click();
  await expect(page).toHaveURL(/\/app\/milniky$/);
  await expectPageScrolls(page, "menu again");
});

test("17 · milestones scroll right after onboarding and Jarvis's tour", async ({ page, accounts }) => {
  const account = await accounts.create({ label: "scroll-tour", mode: "game", onboarded: false });
  await signIn(page, account);

  const wizard = page.getByRole("dialog", { name: t("onboarding.title") });
  const next = wizard.getByRole("button", { name: exact(L, "onboarding.actions.next") });
  await wizard.getByRole("button", { name: exact(L, "onboarding.actions.start") }).click();
  await wizard.getByRole("radio", { name: new RegExp(t("onboarding.mode.game.title")) }).click();
  await wizard.getByRole("radio", { name: t("onboarding.industry.industries.coaching.label") }).click();
  await next.click();
  await expect(wizard.getByRole("radio", { checked: true })).toBeVisible();
  await next.click();
  await expect(wizard.locator("#onboarding-country")).toBeVisible();
  await next.click();
  await wizard.locator("#onboarding-contact-company").fill("E2E Scroll kontakt");
  await wizard.getByRole("button", { name: exact(L, "onboarding.actions.addContact") }).click();
  await wizard.getByRole("button", { name: exact(L, "onboarding.actions.finish") }).click();
  await expect(wizard).toBeHidden();

  // The celebration (a Base UI dialog with its own scroll lock) and the tour
  // arrive together. The celebration is closed while the tour is on: the order
  // that used to leave the page locked.
  const celebration = page.getByRole("dialog", { name: t("game.celebration.onboardingCompleted.title") });
  await expect(celebration).toBeVisible();
  const tour = page.locator("[data-jarvis-tour] [role=dialog]");
  await expect(tour).toBeVisible({ timeout: 30_000 });
  await celebration.getByRole("button", { name: exact(L, "celebration.continue") }).dispatchEvent("click");
  await expect(celebration).toBeHidden();
  const nextStep = tour.getByRole("button", { name: exact(L, "jarvis.tour.next") });
  for (let step = 0; step < 20; step += 1) {
    if (!(await nextStep.isVisible())) break;
    await nextStep.click();
  }
  // The last step's action goes straight to the milestones.
  await tour.getByRole("button", { name: exact(L, "jarvis.tour.action.openFirstTask") }).click();
  await expect(page.locator("[data-jarvis-tour]")).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/milniky/);
  await dismissCelebrationsAutomatically(page, L);
  await expectPageScrolls(page, "after tour");

  await mainNav(page, L).getByRole("link", { name: t("nav.milestones") }).click();
  await expect(page).toHaveURL(/\/app\/milniky$/);
  await expectPageScrolls(page, "after tour, via the menu");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("17 · one finger over the task map scrolls the page; Adjust view moves the map", async ({
    page,
    accounts,
  }) => {
    const account = await accounts.create({ label: "scroll-touch", mode: "tool" });
    await seedMilestones(account, 1);
    await signIn(page, account);
    await dismissCelebrationsAutomatically(page, L);
    await mainNav(page, L).getByRole("link", { name: t("nav.milestones") }).click();
    await page.getByText("E2E Scroll 1", { exact: true }).click();
    await expect(page).toHaveURL(/\/app\/milniky\/[0-9a-f-]{36}$/);
    const quickAdd = page.getByRole("textbox", { name: exact(L, "milestones.tasks.addLabel") });
    for (const title of ["Úkol 1", "Úkol 2", "Úkol 3"]) {
      await quickAdd.fill(title);
      await quickAdd.press("Enter");
      await expect(page.getByRole("checkbox", { name: t("milestones.tasks.checkDone", { title }) })).toBeVisible();
    }
    await page.getByRole("button", { name: exact(L, "milestones.tasks.view.map") }).click();
    const map = page.getByRole("region", { name: t("milestones.map.label") });
    await expect(map).toBeVisible();
    await map.scrollIntoViewIfNeeded();
    const transformOf = () =>
      map.locator(".react-transform-component").evaluate((element) => getComputedStyle(element).transform);
    // Let the first centring settle.
    await page.waitForTimeout(500);
    const before = await transformOf();

    const cdp = await page.context().newCDPSession(page);
    const swipeUp = async () => {
      const box = (await map.boundingBox())!;
      await cdp.send("Input.synthesizeScrollGesture", {
        x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + box.height * 0.7),
        yDistance: -250,
        gestureSourceType: "touch",
        speed: 800,
      });
    };

    const startY = await page.evaluate(() => window.scrollY);
    await swipeUp();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(startY + 50);
    expect(await transformOf()).toBe(before);

    // Adjust view: the same swipe moves the map, not the page.
    await map.getByRole("button", { name: exact(L, "treeMap.editView") }).click();
    await map.scrollIntoViewIfNeeded();
    const pageY = await page.evaluate(() => window.scrollY);
    await swipeUp();
    await expect.poll(transformOf).not.toBe(before);
    expect(await page.evaluate(() => window.scrollY)).toBe(pageY);
  });
});
