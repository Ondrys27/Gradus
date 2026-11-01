import type { Locator, Page } from "@playwright/test";
import { admin, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

// Nodes glide to their new place; with reduced motion they are there at once.
test.use({ reducedMotion: "reduce" });

/** A mouse drag in small steps, so the drag sensors see a real movement. */
async function dragBy(page: Page, from: Locator, to: { x: number; y: number }) {
  const box = (await from.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 8, start.y + 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 16 });
  await page.mouse.up();
}

async function centre(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Waits until the map has centred itself: the node stops moving. */
async function settle(page: Page, locator: Locator) {
  let previous = "";
  await expect
    .poll(async () => {
      await page.waitForTimeout(250);
      const box = JSON.stringify(await locator.boundingBox());
      const still = box === previous;
      previous = box;
      return still;
    })
    .toBe(true);
}

/**
 * 17.5: in the map, task C (with its subtask) is dropped onto task A and
 * becomes its subtask; the list shows it one level deeper; dragged left in
 * the list it goes back to level 1; the map agrees.
 */
test("36 · move a task under another in the map → the list shows it nested → back in the list → the map agrees", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "task-move" });
  const db = admin();
  const { data: milestone, error: milestoneError } = await db
    .from("milestones")
    .insert({ user_id: account.id, title: "E2E Přesuny", position: 0 })
    .select("id")
    .single();
  if (milestoneError) throw milestoneError;
  const ids: Record<string, string> = {};
  for (const [title, position] of [
    ["Úkol A", 0],
    ["Úkol B", 1],
    ["Úkol C", 2],
  ] as const) {
    const { data, error } = await db
      .from("tasks")
      .insert({ user_id: account.id, milestone_id: milestone.id, title, position })
      .select("id")
      .single();
    if (error) throw error;
    ids[title] = data.id;
  }
  const { data: sub, error: subError } = await db
    .from("tasks")
    .insert({
      user_id: account.id,
      milestone_id: milestone.id,
      parent_task_id: ids["Úkol C"],
      title: "Podúkol C1",
      position: 0,
    })
    .select("id")
    .single();
  if (subError) throw subError;
  ids["Podúkol C1"] = sub.id;

  const parentOf = async (title: string) => {
    const { data, error } = await db
      .from("tasks")
      .select("parent_task_id")
      .eq("id", ids[title])
      .single();
    if (error) throw error;
    return data.parent_task_id;
  };

  await signIn(page, account);
  await openApp(page, `/app/milniky/${milestone.id}`);

  // Map: C onto A.
  await page.getByRole("button", { name: exact(L, "milestones.tasks.view.map") }).click();
  const map = page.getByRole("region", { name: t("milestones.map.label") });
  const node = (title: string) =>
    map.getByRole("button", { name: t("milestones.map.open", { title }) });
  await expect(node("Úkol C")).toBeVisible();
  await expect(node("Úkol A")).toBeVisible();
  // The whole map on screen, so the mouse reaches both nodes.
  await map.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await settle(page, node("Úkol C"));
  await dragBy(page, node("Úkol C"), await centre(node("Úkol A")));
  await expect.poll(() => parentOf("Úkol C"), { message: "C is under A" }).toBe(ids["Úkol A"]);
  // The subtask went along.
  expect(await parentOf("Podúkol C1")).toBe(ids["Úkol C"]);

  // List: C one level deeper, its subtask two.
  await page.getByRole("button", { name: exact(L, "milestones.tasks.view.list") }).click();
  const row = (title: string) => page.locator(`[data-task-row="${ids[title]}"]`);
  await expect(row("Úkol C")).toHaveAttribute("data-depth", "1");
  await expect(row("Podúkol C1")).toHaveAttribute("data-depth", "2");
  await expect(row("Úkol A")).toHaveAttribute("data-depth", "0");

  // Back in the list: C dragged by its grip to the left goes to level 1, right after A.
  const handle = row("Úkol C").getByTestId("task-drag-handle");
  const grip = await centre(handle);
  await dragBy(page, handle, { x: grip.x - 70, y: grip.y });
  await expect.poll(() => parentOf("Úkol C"), { message: "C is on level 1" }).toBeNull();
  await expect(row("Úkol C")).toHaveAttribute("data-depth", "0");
  await expect(row("Podúkol C1")).toHaveAttribute("data-depth", "1");
  const order = await page
    .locator("[data-task-row][data-depth='0']")
    .evaluateAll((rows) => rows.map((element) => element.getAttribute("data-task-row")));
  expect(order).toEqual([ids["Úkol A"], ids["Úkol C"], ids["Úkol B"]]);

  // The map agrees: C is back in A's column, its subtask one column further.
  await page.getByRole("button", { name: exact(L, "milestones.tasks.view.map") }).click();
  await expect(node("Úkol C")).toBeVisible();
  await expect
    .poll(async () => {
      const [a, c, c1] = await Promise.all(
        ["Úkol A", "Úkol C", "Podúkol C1"].map((title) =>
          node(title).locator("xpath=ancestor::*[@data-map-drag][1]").boundingBox(),
        ),
      );
      return Boolean(a && c && c1 && Math.abs(a.x - c.x) < 2 && c1.x > c.x + c.width);
    })
    .toBe(true);
});
