import type { Page } from "@playwright/test";
import { admin, signIn, type Account } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { closeCelebration } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

function wizardOf(page: Page) {
  return page.getByRole("dialog", { name: t("onboarding.title") });
}

/** The wizard is on this step: the address says so and the step's heading shows. */
async function onStep(page: Page, slug: string, heading: string) {
  await expect(page).toHaveURL(new RegExp(`[?&]krok=${slug}(&|$)`));
  await expect(wizardOf(page).getByRole("heading", { name: heading })).toBeVisible();
}

const HEADINGS = {
  uvod: () => t("onboarding.welcome.title"),
  rezim: () => t("onboarding.mode.title"),
  obor: () => t("onboarding.industry.title"),
  cesta: () => t("onboarding.path.title"),
  region: () => t("onboarding.region.title"),
  milnik: () => t("onboarding.milestone.title"),
  kontakt: () => t("onboarding.contact.title"),
  hotovo: () => t("onboarding.closing.title"),
};
type Slug = keyof typeof HEADINGS;

async function at(page: Page, slug: Slug) {
  await onStep(page, slug, HEADINGS[slug]());
}

/** Analytics of the wizard, as the server recorded them. */
async function wizardEvents(account: Account) {
  const { data, error } = await admin()
    .from("analytics_events")
    .select("event, props")
    .eq("user_id", account.id)
    .in("event", ["onboarding_step_completed", "onboarding_step_back", "onboarding_completed"]);
  if (error) throw error;
  return data ?? [];
}

test("15 · wizard: Back button and browser Back, reload in the middle, nothing saved twice", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "wizard-back", onboarded: false });
  await signIn(page, account);
  const wizard = wizardOf(page);
  const next = wizard.getByRole("button", { name: exact(L, "onboarding.actions.next") });
  const back = wizard.getByRole("button", { name: exact(L, "onboarding.actions.back") });

  // The step is in the address from the start; the welcome has no Back.
  await at(page, "uvod");
  await expect(back).toHaveCount(0);
  await wizard.getByRole("button", { name: exact(L, "onboarding.actions.start") }).click();
  await at(page, "rezim");

  // A step typed in ahead of time quietly becomes the first unfinished one.
  await page.goto("/app?krok=kontakt");
  await at(page, "rezim");

  await wizard.getByRole("radio", { name: new RegExp(t("onboarding.mode.tool.title")) }).click();
  await at(page, "obor");
  await wizard.getByRole("radio", { name: t("onboarding.industry.industries.coaching.label") }).click();
  await next.click();
  await at(page, "region");
  await next.click();
  await at(page, "milnik");
  const milestoneTitle = wizard.locator("#onboarding-milestone-title");
  await expect(milestoneTitle).toHaveValue(t("onboarding.industry.industries.coaching.milestoneTitle"));
  await milestoneTitle.fill("E2E Milník A");
  await next.click();
  await at(page, "kontakt");
  const company = wizard.locator("#onboarding-contact-company");
  await company.fill("E2E Kontakt A");
  await wizard.getByRole("button", { name: exact(L, "onboarding.actions.addContact") }).click();
  await at(page, "hotovo");

  // The Back button: the contact comes back filled in; saving edits it.
  await back.click();
  await at(page, "kontakt");
  await expect(company).toHaveValue("E2E Kontakt A");
  // Only the wizard's own Skip is left; the saved contact is kept or edited, not skipped.
  await expect(wizard.getByRole("button", { name: exact(L, "onboarding.actions.skip") })).toHaveCount(1);
  await company.fill("E2E Kontakt B");
  await next.click();
  await at(page, "hotovo");

  // The browser's Back, twice: the milestone comes back filled in.
  await page.goBack();
  await at(page, "kontakt");
  await page.goBack();
  await at(page, "milnik");
  await expect(milestoneTitle).toHaveValue("E2E Milník A");
  await milestoneTitle.fill("E2E Milník B");
  await wizard.getByRole("textbox", { name: t("onboarding.milestone.taskLabel", { number: 3 }) }).fill("");
  await next.click();
  await at(page, "kontakt");

  // A reload in the middle stays on the step, with what was saved.
  await page.reload();
  await at(page, "kontakt");
  await expect(company).toHaveValue("E2E Kontakt B");

  // Back through every step to the mode; the answers are kept.
  await back.click();
  await at(page, "milnik");
  await expect(milestoneTitle).toHaveValue("E2E Milník B");
  await back.click();
  await at(page, "region");
  await page.goBack();
  await at(page, "obor");
  await expect(
    wizard.getByRole("radio", { name: t("onboarding.industry.industries.coaching.label") }),
  ).toHaveAttribute("aria-checked", "true");
  await back.click();
  await at(page, "rezim");
  await expect(
    wizard.getByRole("radio", { name: new RegExp(t("onboarding.mode.tool.title")) }),
  ).toHaveAttribute("aria-checked", "true");

  // And forward again to the end.
  await page.goForward();
  await at(page, "obor");
  await next.click();
  await at(page, "region");
  await next.click();
  await at(page, "milnik");
  await next.click();
  await at(page, "kontakt");
  await next.click();
  await at(page, "hotovo");
  await wizard.getByRole("button", { name: exact(L, "onboarding.actions.finish") }).click();
  await expect(wizard).toBeHidden();
  await expect(page).not.toHaveURL(/krok=/);

  // One milestone with the two tasks left, one contact — nothing twice.
  const db = admin();
  const { data: milestones } = await db
    .from("milestones")
    .select("id, title, template_id")
    .eq("user_id", account.id);
  expect(milestones).toHaveLength(1);
  expect(milestones![0]).toMatchObject({ title: "E2E Milník B", template_id: null });
  const { data: tasks } = await db
    .from("tasks")
    .select("title")
    .eq("milestone_id", milestones![0].id)
    .order("position");
  expect(tasks?.map((task) => task.title)).toEqual([
    t("onboarding.industry.industries.coaching.task1"),
    t("onboarding.industry.industries.coaching.task2"),
  ]);
  const { data: contacts } = await db.from("contacts").select("company_name").eq("user_id", account.id);
  expect(contacts).toEqual([{ company_name: "E2E Kontakt B" }]);
  const { data: profile } = await db
    .from("profiles")
    .select("mode, industry, onboarding_completed_at")
    .eq("id", account.id)
    .single();
  expect(profile).toMatchObject({ mode: "tool", industry: "coaching" });
  expect(profile?.onboarding_completed_at).not.toBeNull();

  // Analytics: each step completed once, the ways back recorded without answers.
  await expect
    .poll(async () => (await wizardEvents(account)).some((e) => e.event === "onboarding_completed"), {
      timeout: 30_000,
    })
    .toBe(true);
  const events = await wizardEvents(account);
  const completed = events
    .filter((e) => e.event === "onboarding_step_completed")
    .map((e) => (e.props as { step: string }).step)
    .sort();
  expect(completed).toEqual(["contact", "industry", "milestone", "mode", "region", "welcome"]);
  const backs = events.filter((e) => e.event === "onboarding_step_back").map((e) => e.props);
  expect(backs).toContainEqual({ step: "closing", to: "contact", via: "button" });
  expect(backs).toContainEqual({ step: "contact", to: "milestone", via: "browser" });
  for (const props of backs) expect(Object.keys(props as object).sort()).toEqual(["step", "to", "via"]);
});

test("15 · wizard: tool first, then back to game — the path replaces the hand-made milestone", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "wizard-switch", onboarded: false });
  await signIn(page, account);
  const wizard = wizardOf(page);
  const next = wizard.getByRole("button", { name: exact(L, "onboarding.actions.next") });

  await wizard.getByRole("button", { name: exact(L, "onboarding.actions.start") }).click();
  await wizard.getByRole("radio", { name: new RegExp(t("onboarding.mode.tool.title")) }).click();
  await wizard.getByRole("radio", { name: t("onboarding.industry.industries.realEstate.label") }).click();
  await next.click();
  await at(page, "region");
  await next.click();
  await at(page, "milnik");
  await next.click();
  await at(page, "kontakt");

  // Back to the mode in the browser and pick the game instead.
  for (const slug of ["milnik", "region", "obor", "rezim"] as const) {
    await page.goBack();
    await at(page, slug);
  }
  await wizard.getByRole("radio", { name: new RegExp(t("onboarding.mode.game.title")) }).click();
  await at(page, "obor");
  await next.click();
  await at(page, "cesta");
  await expect(wizard.getByRole("radio", { checked: true })).toBeVisible();
  await next.click();
  await at(page, "region");
  // Forward is not offered past where the game's steps reach yet; Back goes to the path.
  await wizard.getByRole("button", { name: exact(L, "onboarding.actions.back") }).click();
  await at(page, "cesta");
  await next.click();
  await at(page, "region");
  await next.click();
  await at(page, "kontakt");
  await wizard.getByRole("button", { name: exact(L, "onboarding.actions.skip") }).last().click();
  await at(page, "hotovo");
  await wizard.getByRole("button", { name: exact(L, "onboarding.actions.finish") }).click();
  await expect(wizard).toBeHidden();
  await closeCelebration(page, L, t("game.celebration.onboardingCompleted.title"));

  const db = admin();
  const { data: profile } = await db.from("profiles").select("mode, path_key").eq("id", account.id).single();
  expect(profile?.mode).toBe("game");
  expect(profile?.path_key).toBeTruthy();
  const { data: milestones } = await db
    .from("milestones")
    .select("template_id")
    .eq("user_id", account.id);
  expect(milestones!.length).toBeGreaterThan(0);
  // Only the path's milestones, each once.
  expect(milestones!.every((m) => m.template_id !== null)).toBe(true);
  expect(new Set(milestones!.map((m) => m.template_id)).size).toBe(milestones!.length);
});

test("15 · Back from the app after sign-in does not return to the sign-in page", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "wizard-signin", onboarded: false });
  // Signing in replaces the sign-in page in the history, so Back leaves the app
  // for the page before it (which a signed-in visitor may see).
  await page.goto("/cenik");
  await signIn(page, account);
  await at(page, "uvod");
  await page.goBack();
  await expect(page).toHaveURL(/\/cenik$/);
});
