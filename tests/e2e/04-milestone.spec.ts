import { admin, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { closeAllCelebrations, dismissCelebrationsAutomatically, openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

test("4 · milestone → three tasks and a subtask → locked parent unlocks → complete → celebration", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "milestone", mode: "game" });
  await signIn(page, account);
  const smallWins = await dismissCelebrationsAutomatically(page, L);

  await openApp(page, "/app/milniky");
  await page.getByRole("button", { name: exact(L, "milestones.actions.new") }).first().click();
  const form = page.getByRole("dialog", { name: t("milestones.form.createTitle") });
  await form.locator("#milestone-title").fill("E2E Spustit web");
  await form.locator("#milestone-reward").fill("Večeře venku");
  await form.getByRole("button", { name: exact(L, "milestones.form.create") }).click();
  await expect(page).toHaveURL(/\/app\/milniky\/[0-9a-f-]{36}$/);

  const complete = page.getByRole("button", { name: new RegExp(`^${t("milestones.actions.complete")}`) });
  // No task yet: locked with "add the first task".
  await expect(complete).toBeDisabled();
  await expect(complete).toContainText(t("milestones.actions.completeEmpty"));

  const quickAdd = page.getByRole("textbox", { name: exact(L, "milestones.tasks.addLabel") });
  for (const title of ["Úkol A", "Úkol B", "Úkol C"]) {
    await quickAdd.fill(title);
    await quickAdd.press("Enter");
    await expect(page.getByRole("checkbox", { name: t("milestones.tasks.checkDone", { title }) })).toBeVisible();
  }
  await expect(complete).toBeDisabled();
  await expect(complete).toContainText("3");

  // A subtask under A locks A.
  await page.getByRole("button", { name: t("milestones.tasks.actions", { title: "Úkol A" }) }).click();
  await page.getByRole("menuitem", { name: t("milestones.tasks.addSubtask") }).click();
  const subForm = page.getByRole("dialog", { name: t("milestones.tasks.form.createSubtaskTitle", { parent: "Úkol A" }) });
  await subForm.locator("#task-title").fill("Podúkol A1");
  await subForm.getByRole("button", { name: exact(L, "milestones.tasks.form.create") }).click();
  await expect(subForm).toBeHidden();
  const lockedA = page.getByRole("button", { name: t("milestones.tasks.lockedLabel", { title: "Úkol A" }) });
  await expect(lockedA).toBeVisible();
  await expect(page.getByRole("checkbox", { name: t("milestones.tasks.checkDone", { title: "Úkol A" }) })).toHaveCount(0);

  // Tick B, C and the subtask.
  for (const title of ["Úkol B", "Úkol C", "Podúkol A1"]) {
    await page.getByRole("checkbox", { name: t("milestones.tasks.checkDone", { title }) }).click();
    await expect(page.getByRole("checkbox", { name: t("milestones.tasks.checkReopen", { title }) })).toBeChecked();
  }

  // A is unlocked but not done by itself; the milestone stays locked.
  await expect(lockedA).toHaveCount(0);
  const checkA = page.getByRole("checkbox", { name: t("milestones.tasks.checkDone", { title: "Úkol A" }) });
  await expect(checkA).toBeVisible();
  await expect(checkA).not.toBeChecked();
  await expect(complete).toBeDisabled();

  // Tick A: the milestone unlocks, still waiting for the user's tap.
  await checkA.click();
  await expect(complete).toBeEnabled();
  await expect(complete).toHaveText(t("milestones.actions.complete"));
  const { data: before } = await admin()
    .from("milestones")
    .select("status")
    .eq("user_id", account.id)
    .eq("title", "E2E Spustit web")
    .single();
  expect(before?.status).not.toBe("completed");

  await smallWins.stop();
  console.log(`Small celebrations on the way: ${smallWins.seen.join(", ") || "none"}`);
  await complete.click();
  const celebration = page.getByRole("dialog", { name: t("milestones.celebration.title") });
  await expect(celebration).toBeVisible();
  await expect(celebration).toContainText(t("milestones.celebration.reward", { reward: "Večeře venku" }));
  const titles = await closeAllCelebrations(page, L);
  expect(titles[0]).toBe(t("milestones.celebration.title"));

  await expect(page.getByRole("button", { name: exact(L, "milestones.actions.reopen") })).toBeVisible();
  const { data: after } = await admin()
    .from("milestones")
    .select("status")
    .eq("user_id", account.id)
    .eq("title", "E2E Spustit web")
    .single();
  expect(after?.status).toBe("completed");
});
