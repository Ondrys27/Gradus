import type { Page } from "@playwright/test";
import { admin, signIn, userClient } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { chooseTutorial, openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

// Jarvis flies between the steps; with reduced motion he is just there.
test.use({ reducedMotion: "reduce" });

const SAMPLE_TABLES = [
  "contacts",
  "deals",
  "milestones",
  "tasks",
  "crm_tasks",
  "calendar_events",
  "notes",
] as const;

const overlay = (page: Page) => page.locator("[data-tutorial-overlay]");
const stepTitle = (page: Page, key: string) =>
  overlay(page).getByRole("heading", { name: t(`tutorial.steps.${key}.title`), exact: true });
const nextButton = (page: Page) =>
  overlay(page).getByRole("button", { name: exact(L, "tutorial.next") });
const skipButton = (page: Page) =>
  overlay(page).getByRole("button", { name: exact(L, "tutorial.skipStep") });

async function startFromSettings(page: Page) {
  await openApp(page, "/app/nastaveni/jarvis");
  await page.getByRole("button", { name: exact(L, "settings.help.start") }).click();
}

async function sampleCounts(userId: string) {
  const db = admin();
  const counts: Record<string, number> = {};
  for (const table of SAMPLE_TABLES) {
    const { count, error } = await db
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_demo", true);
    if (error) throw error;
    counts[table] = count ?? 0;
  }
  return counts;
}

async function tutorialOf(userId: string) {
  const { data } = await admin()
    .from("profiles")
    .select("tutorial, tour_completed_at")
    .eq("id", userId)
    .single();
  return data;
}

/**
 * 20.4: the quick look walks every section with Next only and is stored as
 * finished; the stored progress is what Jarvis picks up after a reload.
 */
test("45 · quick look: every section with Next, stored as finished", async ({ page, accounts }) => {
  const account = await accounts.create({ label: "tutorial-quick" });
  await signIn(page, account);
  await startFromSettings(page);
  await chooseTutorial(page, "quick");

  const keys = [
    "dashboard",
    "milestones",
    "notes",
    "contacts",
    "pipeline",
    "tasks",
    "calendar",
    "finance",
    "company",
    "messages",
    "jarvis",
    "settings",
    "finish",
  ];
  const where: Record<string, RegExp> = {
    milestones: /\/app\/milniky$/,
    notes: /\/app\/poznamky/,
    pipeline: /\/app\/pipeline/,
    calendar: /\/app\/kalendar/,
    messages: /\/app\/zpravy/,
  };
  for (const [index, key] of keys.entries()) {
    await expect(stepTitle(page, key)).toBeVisible({ timeout: 15_000 });
    await expect(overlay(page)).toHaveAttribute("data-tutorial-step", key);
    await expect(overlay(page).locator("[data-tutorial-rail]")).toHaveAttribute(
      "aria-valuenow",
      /^\d+$/,
    );
    if (where[key]) await expect(page).toHaveURL(where[key]);
    if (key === "pipeline") {
      // Reloaded in the middle: it goes straight on at the same step.
      await expect
        .poll(async () => (await tutorialOf(account.id))?.tutorial)
        .toMatchObject({ step: "pipeline" });
      await page.reload();
      await expect(stepTitle(page, "pipeline")).toBeVisible({ timeout: 30_000 });
    }
    if (index < keys.length - 1) await nextButton(page).click();
  }
  await overlay(page)
    .getByRole("button", { name: exact(L, "tutorial.done") })
    .click();
  await expect(overlay(page)).toHaveCount(0);

  await expect
    .poll(async () => (await tutorialOf(account.id))?.tutorial)
    .toMatchObject({ mode: "quick", outcome: "finished" });
  expect((await tutorialOf(account.id))?.tour_completed_at).not.toBeNull();
});

/**
 * 20.4: the full tutorial puts labelled sample data into the space, its
 * hands-on steps unlock Next only once done (made in the app or through the
 * user's own client), and ending it with "delete the data" leaves nothing
 * marked as a sample while the user's own rows stay.
 */
test("45 · full tutorial up to the deal; deleting the samples leaves nothing marked", async ({
  page,
  accounts,
}) => {
  test.setTimeout(180_000);
  const account = await accounts.create({ label: "tutorial-full" });
  await signIn(page, account);
  await startFromSettings(page);
  await chooseTutorial(page, "full");

  await expect
    .poll(() => sampleCounts(account.id), { timeout: 20_000 })
    .toEqual({
      contacts: 3,
      deals: 1,
      milestones: 1,
      tasks: 5,
      crm_tasks: 2,
      calendar_events: 1,
      notes: 1,
    });

  await expect(stepTitle(page, "welcome")).toBeVisible({ timeout: 15_000 });
  await nextButton(page).click();
  await expect(stepTitle(page, "dashboard")).toBeVisible();
  await nextButton(page).click();
  await expect(stepTitle(page, "milestonesLook")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/milniky$/);
  await expect(page.locator("[data-demo-badge]").first()).toBeVisible();
  await nextButton(page).click();

  // Hands-on: Next stays locked until the milestone exists.
  await expect(stepTitle(page, "milestoneCreate")).toBeVisible();
  await expect(nextButton(page)).toBeDisabled();
  await page
    .getByRole("button", { name: exact(L, "milestones.actions.new") })
    .first()
    .click();
  const form = page.getByRole("dialog", { name: t("milestones.form.createTitle") });
  await form.locator("#milestone-title").fill("E2E Moje první zakázka");
  await form.getByRole("button", { name: exact(L, "milestones.form.create") }).click();
  await expect(page).toHaveURL(/\/app\/milniky\/[0-9a-f-]{36}$/);
  await expect(nextButton(page)).toBeEnabled({ timeout: 15_000 });
  await nextButton(page).click();

  await expect(stepTitle(page, "taskAdd")).toBeVisible();
  const quickAdd = page.getByRole("textbox", { name: exact(L, "milestones.tasks.addLabel") });
  await quickAdd.fill("E2E Zavolat dodavateli");
  await quickAdd.press("Enter");
  await expect(nextButton(page)).toBeEnabled({ timeout: 15_000 });
  await nextButton(page).click();

  // Any hands-on step can be skipped.
  await expect(stepTitle(page, "taskMove")).toBeVisible();
  await skipButton(page).click();
  await expect(stepTitle(page, "noteWrite")).toBeVisible();
  await skipButton(page).click();
  await expect(stepTitle(page, "contactsLook")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/kontakty/);
  await nextButton(page).click();

  // A contact of the user's own (the flag the client sends is ignored).
  await expect(stepTitle(page, "contactCreate")).toBeVisible();
  await expect(nextButton(page)).toBeDisabled();
  const client = await userClient(account.email, account.password);
  const contact = await client
    .from("contacts")
    .insert({ user_id: account.id, company_name: "E2E Vlastní kontakt", is_demo: true })
    .select("id, is_demo")
    .single();
  expect(contact.error).toBeNull();
  expect(contact.data?.is_demo).toBe(false);
  await expect(nextButton(page)).toBeEnabled({ timeout: 15_000 });
  await nextButton(page).click();

  await expect(stepTitle(page, "coldCallingLook")).toBeVisible();
  await nextButton(page).click();
  await expect(stepTitle(page, "coldCallingMove")).toBeVisible();
  await skipButton(page).click();

  // The step of making a deal from the contact.
  await expect(stepTitle(page, "dealFromContact")).toBeVisible();
  await expect(nextButton(page)).toBeDisabled();
  const { data: stage } = await client
    .from("pipeline_stages")
    .select("id")
    .eq("user_id", account.id)
    .eq("is_won", false)
    .eq("is_lost", false)
    .order("position")
    .limit(1)
    .single();
  const deal = await client
    .from("deals")
    .insert({
      user_id: account.id,
      stage_id: stage!.id,
      title: "E2E Vlastní obchod",
      contact_id: contact.data!.id,
    })
    .select("id")
    .single();
  expect(deal.error).toBeNull();
  await expect(nextButton(page)).toBeEnabled({ timeout: 15_000 });
  await expect
    .poll(async () => (await tutorialOf(account.id))?.tutorial)
    .toMatchObject({ mode: "full", step: "dealFromContact" });

  // End here and delete the samples.
  await overlay(page)
    .getByRole("button", { name: exact(L, "tutorial.end") })
    .click();
  await overlay(page)
    .getByRole("button", { name: exact(L, "tutorial.endConfirm.delete") })
    .click();
  await expect(overlay(page)).toHaveCount(0);

  await expect
    .poll(() => sampleCounts(account.id), { timeout: 20_000 })
    .toEqual({
      contacts: 0,
      deals: 0,
      milestones: 0,
      tasks: 0,
      crm_tasks: 0,
      calendar_events: 0,
      notes: 0,
    });
  const db = admin();
  const own = await db.from("deals").select("id").eq("id", deal.data!.id);
  expect(own.data).toHaveLength(1);
  const milestones = await db
    .from("milestones")
    .select("title")
    .eq("user_id", account.id)
    .eq("title", "E2E Moje první zakázka");
  expect(milestones.data).toHaveLength(1);
  await expect
    .poll(async () => (await tutorialOf(account.id))?.tutorial)
    .toMatchObject({ mode: "full", outcome: "abandoned", demo: "deleted" });
});
