import type { Browser } from "@playwright/test";
import { admin, signIn, skipCompanyTutorial, type Account } from "./support/accounts";
import { expect, test, watchConsole } from "./support/fixtures";
import { text } from "./support/i18n";
import { openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

test.use({ reducedMotion: "reduce" });

/** A second browser for the worker; their idle limit shortened to a few seconds (outside production only). */
async function workerBrowser(browser: Browser, person: Account, consoleErrors: string[]) {
  const context = await browser.newContext({ locale: "cs-CZ", timezoneId: "Europe/Prague" });
  // The script runs in every document, about:blank included, where localStorage is off limits.
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("gradus.e2e.presenceIdleMs", "4000");
    } catch {
      // not this document
    }
  });
  watchConsole(context, consoleErrors);
  const page = await context.newPage();
  await signIn(page, person);
  return { context, page };
}

/**
 * 30.5 in two browsers, the owner and a worker: the worker is online in the
 * owner's list of people, goes idle → away, comes back → online, closes the
 * app → "naposledy před chvílí". Then the worker turns "Ukazovat, kdy jsem
 * online" off: the owner sees nothing about them any more, and they see
 * nothing about the owner.
 */
test("76 · online status: online → away → closed → last seen; switching it off hides both ways", async ({
  page,
  browser,
  accounts,
  consoleErrors,
}) => {
  test.setTimeout(180_000);
  const owner = await accounts.create({ label: "presence-owner" });
  const person = await accounts.create({ label: "presence-worker" });
  const db = admin();
  const { data: worker, error } = await db
    .from("workers")
    .insert({ owner_id: owner.id, user_id: person.id, name: "E2E Přítomná", email: person.email, status: "active" })
    .select("id")
    .single();
  if (error) throw error;
  await skipCompanyTutorial(person.id, owner.id);

  await signIn(page, owner);
  await openApp(page, "/app/firma");
  const row = page.locator(`[data-company-row="${worker.id}"]`);
  await expect(row).toBeVisible();
  const label = row.getByTestId("presence-label");

  const first = await workerBrowser(browser, person, consoleErrors);
  try {
    await openApp(first.page, `/app/zpravy?to=${owner.id}`);
    await first.page.mouse.move(40, 40);

    // Online on both sides: the worker in the owner's list (text and dot), the owner in the conversation.
    await expect(label).toHaveAttribute("data-presence", "online", { timeout: 30_000 });
    await expect(label).toHaveText(t("presence.online"));
    await expect(row.locator('[role="img"][data-presence="online"]')).toBeVisible();
    const header = first.page.getByTestId("chat-conversation").locator("header");
    await expect(header.getByTestId("presence-label")).toHaveAttribute("data-presence", "online", {
      timeout: 30_000,
    });

    // No touch for the (shortened) idle limit: away.
    await expect(label).toHaveAttribute("data-presence", "away", { timeout: 30_000 });
    await expect(label).toHaveText(t("presence.away"));
    await expect(row.locator('[role="img"][data-presence="away"]')).toBeVisible();

    // A touch brings them back.
    await first.page.mouse.move(200, 220);
    await first.page.mouse.move(260, 300);
    await expect(label).toHaveAttribute("data-presence", "online", { timeout: 30_000 });
  } finally {
    await first.context.close();
  }

  // The app closed: offline with when they were last here, no dot.
  await expect(label).toHaveAttribute("data-presence", "offline", { timeout: 90_000 });
  await expect(label).toHaveText(t("presence.lastSeen.moment"));
  await expect(row.locator('[role="img"][data-presence]')).toHaveCount(0);
  const { data: seen } = await db
    .from("presence_last_seen")
    .select("last_seen_at")
    .eq("user_id", person.id)
    .maybeSingle();
  expect(seen?.last_seen_at).toBeTruthy();

  // The worker turns it off.
  const second = await workerBrowser(browser, person, consoleErrors);
  try {
    await openApp(second.page, "/app/nastaveni/soukromi");
    await second.page.mouse.move(40, 40);
    await expect(label).toHaveAttribute("data-presence", "online", { timeout: 30_000 });
    const toggle = second.page.getByTestId("settings-show-online");
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect
      .poll(async () => {
        const { data } = await db.from("user_settings").select("show_online").eq("user_id", person.id).single();
        return data?.show_online;
      })
      .toBe(false);

    // Nobody sees them, the owner neither, and the stored moment is gone.
    await expect(row.getByTestId("presence-label")).toHaveCount(0, { timeout: 30_000 });
    await expect(row.locator("[data-presence]")).toHaveCount(0);
    const { data: forgotten } = await db
      .from("presence_last_seen")
      .select("user_id")
      .eq("user_id", person.id)
      .maybeSingle();
    expect(forgotten).toBeNull();

    // And they see nobody: the owner still has the app open, yet the conversation shows no status.
    await openApp(second.page, `/app/zpravy?to=${owner.id}`);
    const header = second.page.getByTestId("chat-conversation").locator("header");
    await expect(header).toBeVisible();
    await second.page.waitForTimeout(3_000);
    await expect(header.getByTestId("presence-label")).toHaveCount(0);
    await expect(header.locator("[data-presence]")).toHaveCount(0);
  } finally {
    await second.context.close();
  }
});
