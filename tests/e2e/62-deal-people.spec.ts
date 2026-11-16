import { admin, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { text } from "./support/i18n";
import { openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

test.use({ reducedMotion: "reduce" });

/**
 * More people on one deal: the owner ticks a worker with only own deals on
 * the owner's deal → both are on it (the card shows them) → the worker sees
 * the deal on their board and cannot take themself off it.
 */
test("62 · more people on a deal: a worker with only own deals sees the deal they were added to", async ({
  page,
  browser,
  accounts,
}) => {
  const owner = await accounts.create({ label: "people-owner" });
  const person = await accounts.create({ label: "people-worker" });
  const db = admin();

  const { data: worker, error: workerError } = await db
    .from("workers")
    .insert({
      owner_id: owner.id,
      user_id: person.id,
      name: "E2E Spolupracovník",
      email: person.email,
      status: "active",
    })
    .select("id")
    .single();
  if (workerError) throw workerError;
  const grants = await db.from("worker_permission_grants").insert(
    ["view", "update"].map((action) => ({
      owner_id: owner.id,
      worker_id: worker.id,
      section: "pipeline",
      action,
      allowed: true,
    })),
  );
  if (grants.error) throw grants.error;

  const { data: stage, error: stageError } = await db
    .from("pipeline_stages")
    .select("id")
    .eq("user_id", owner.id)
    .eq("is_won", false)
    .eq("is_lost", false)
    .order("position")
    .limit(1)
    .single();
  if (stageError) throw stageError;
  const title = "E2E Společný obchod";
  const { data: deal, error: dealError } = await db
    .from("deals")
    .insert({ user_id: owner.id, stage_id: stage.id, title, assignee_id: owner.id })
    .select("id")
    .single();
  if (dealError) throw dealError;

  const people = async () => {
    const { data, error } = await db
      .from("deal_assignees")
      .select("assignee_id")
      .eq("deal_id", deal.id);
    if (error) throw error;
    return data.map((row) => row.assignee_id).sort();
  };
  expect(await people()).toEqual([owner.id]);

  // The owner adds the worker in the deal detail.
  await signIn(page, owner);
  await openApp(page, "/app/pipeline");
  await page.getByRole("button", { name: t("pipeline.card.open", { title }) }).click();
  const detail = page.getByRole("dialog", { name: t("pipeline.detail.title") });
  await detail.locator("#deal-assignee").click();
  await page
    .getByRole("option")
    .filter({ hasNotText: t("crmTasks.who.me") })
    .first()
    .click();
  await expect.poll(people).toEqual([owner.id, person.id].sort());
  await page.keyboard.press("Escape");
  await expect(detail.locator("#deal-assignee")).toContainText(t("crmTasks.who.me"));

  // The worker, with only own deals, sees it and stays on it.
  const workerContext = await browser.newContext({ locale: "cs-CZ", timezoneId: "Europe/Prague" });
  const workerPage = await workerContext.newPage();
  try {
    await signIn(workerPage, person);
    await openApp(workerPage, "/app/pipeline");
    const card = workerPage.getByRole("button", { name: t("pipeline.card.open", { title }) });
    await expect(card).toBeVisible();
    await card.click();
    const workerDetail = workerPage.getByRole("dialog", { name: t("pipeline.detail.title") });
    await workerDetail.locator("#deal-assignee").click();
    const self = workerPage.getByRole("option", { name: t("crmTasks.who.me") });
    await expect(self).toHaveAttribute("data-disabled", "");
    await workerPage.keyboard.press("Escape");
    expect(await people()).toEqual([owner.id, person.id].sort());
  } finally {
    await workerContext.close();
  }
});
