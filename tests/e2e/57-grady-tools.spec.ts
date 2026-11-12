import type { Page } from "@playwright/test";
import { admin, seedContacts, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

/**
 * Same as src/features/grady/server/e2e-model.ts: the tools stand-in plays
 * the listed tool calls instead of Anthropic (only for e2e accounts outside
 * production), then answers with a line naming what came back.
 */
const E2E_MODEL_HEADER = "x-gradus-e2e-model";
const E2E_TOOLS_HEADER = "x-gradus-e2e-tools";

// Grady's button bobs; with reduced motion it holds still, so the click is not retried forever.
test.use({ reducedMotion: "reduce" });

/** Every chat message of this page plays `script` (base64 JSON of tool calls). */
async function scriptTools(page: Page, script: { name: string; input: Record<string, unknown> }[]) {
  await page.unroute("**/api/grady");
  await page.route("**/api/grady", async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { kind?: string } | null;
    if (request.method() !== "POST" || body?.kind) return route.continue();
    await route.continue({
      headers: {
        ...request.headers(),
        [E2E_MODEL_HEADER]: "tool-script",
        [E2E_TOOLS_HEADER]: Buffer.from(JSON.stringify(script)).toString("base64"),
      },
    });
  });
}

async function ask(page: Page, message: string) {
  const panel = page.getByRole("dialog", { name: t("grady.title") });
  if (!(await panel.isVisible()))
    await page.getByRole("button", { name: exact(L, "grady.open") }).click();
  await panel.getByRole("textbox", { name: t("grady.inputLabel") }).fill(message);
  await panel.getByRole("button", { name: exact(L, "grady.send") }).click();
  return panel;
}

test("57 · Grady works in the app: an instant task with Undo, a delete only after Confirm", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "grady-tools" });
  const db = admin();
  const { data: milestone, error } = await db
    .from("milestones")
    .insert({ user_id: account.id, title: "E2E Firemní e-mail", category: "work", position: 0 })
    .select("id")
    .single();
  if (error) throw error;
  await seedContacts(account, [
    { company_name: "E2E Smazat Kavárna" },
    { company_name: "E2E Nechat Pekárna" },
  ]);
  const { data: contacts } = await db
    .from("contacts")
    .select("id, company_name")
    .eq("user_id", account.id)
    .like("company_name", "E2E %");
  const toDelete = contacts!.find((row) => row.company_name === "E2E Smazat Kavárna")!;
  const toKeep = contacts!.find((row) => row.company_name === "E2E Nechat Pekárna")!;

  await signIn(page, account);
  await openApp(page, "/app");

  // "Put it in my tasks": a card, the task is in the milestone; Undo takes it back.
  await scriptTools(page, [
    {
      name: "add_tasks",
      input: { milestoneId: milestone.id, tasks: [{ title: "E2E Koupit doménu" }] },
    },
  ]);
  const panel = await ask(page, "Dej mi to do úkolů: koupit doménu");
  const card = panel.getByTestId("grady-action").last();
  await expect(card).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await expect(card).toContainText("E2E Koupit doménu");
  const added = async () =>
    (
      await db
        .from("tasks")
        .select("id")
        .eq("milestone_id", milestone.id)
        .eq("title", "E2E Koupit doménu")
    ).data ?? [];
  expect(await added()).toHaveLength(1);
  await card.getByRole("button", { name: t("grady.actions.undo") }).click();
  await expect(card).toHaveAttribute("data-status", "undone");
  expect(await added()).toHaveLength(0);

  // Deleting a contact waits for Confirm; Cancel leaves it, Confirm deletes it.
  await scriptTools(page, [{ name: "delete_contact", input: { contactId: toKeep.id } }]);
  await ask(page, "Smaž Pekárnu");
  const keep = panel.getByTestId("grady-action").last();
  await expect(keep).toHaveAttribute("data-status", "pending", { timeout: 30_000 });
  await expect(keep).toContainText("E2E Nechat Pekárna");
  await keep.getByRole("button", { name: t("grady.actions.reject") }).click();
  await expect(keep).toHaveAttribute("data-status", "rejected");
  expect((await db.from("contacts").select("id").eq("id", toKeep.id)).data).toHaveLength(1);

  await scriptTools(page, [{ name: "delete_contact", input: { contactId: toDelete.id } }]);
  await ask(page, "Smaž Kavárnu");
  const remove = panel.getByTestId("grady-action").last();
  await expect(remove).toHaveAttribute("data-status", "pending", { timeout: 30_000 });
  expect((await db.from("contacts").select("id").eq("id", toDelete.id)).data).toHaveLength(1);
  await remove.getByRole("button", { name: t("grady.actions.confirm") }).click();
  await expect(remove).toHaveAttribute("data-status", "done");
  expect((await db.from("contacts").select("id").eq("id", toDelete.id)).data).toHaveLength(0);

  // The record of the actions is the account's own, written by the server.
  const { data: actions } = await db
    .from("grady_actions")
    .select("tool, status")
    .eq("user_id", account.id)
    .order("created_at");
  expect(actions?.map((row) => `${row.tool}:${row.status}`)).toEqual([
    "add_tasks:undone",
    "delete_contact:rejected",
    "delete_contact:done",
  ]);
});

test("57 · a worker without the pipeline right is never offered a pipeline tool", async ({
  page,
  accounts,
}) => {
  const boss = await accounts.create({ label: "grady-tools-boss" });
  const person = await accounts.create({ label: "grady-tools-worker" });
  const db = admin();
  const { data: worker, error } = await db
    .from("workers")
    .insert({ owner_id: boss.id, user_id: person.id, name: "E2E Pracovník", status: "active" })
    .select("id")
    .single();
  if (error) throw error;
  const granted = await db.from("worker_permission_grants").insert(
    ["view", "create"].map((action) => ({
      owner_id: boss.id,
      worker_id: worker.id,
      section: "contacts",
      action,
      allowed: true,
    })),
  );
  if (granted.error) throw granted.error;

  await signIn(page, person);
  await openApp(page, "/app");
  await scriptTools(page, [{ name: "create_deal", input: { title: "E2E Obchod pracovníka" } }]);
  const panel = await ask(page, "Založ obchod pro Kavárnu");
  await expect(panel.locator(".border-teal.whitespace-pre-wrap").last()).toContainText(
    "E2E tools: not offered: create_deal",
    { timeout: 30_000 },
  );
  expect(
    (await db.from("deals").select("id").eq("title", "E2E Obchod pracovníka")).data,
  ).toHaveLength(0);
});
