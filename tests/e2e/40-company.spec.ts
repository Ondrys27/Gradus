import type { Locator, Page } from "@playwright/test";
import { admin, e2eEmail, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

// Cards glide to their new place; with reduced motion they are there at once.
test.use({ reducedMotion: "reduce" });

/** A mouse drag in small steps, so the drag sensors see a real movement. */
async function dragTo(page: Page, from: Locator, to: Locator) {
  const start = (await from.boundingBox())!;
  const end = (await to.boundingBox())!;
  const a = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  const b = { x: end.x + end.width / 2, y: end.y + end.height / 2 };
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 8, a.y + 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 16 });
  await page.mouse.up();
}

/** Waits until the map has centred itself: the card stops moving. */
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
 * 19.2: the owner invites a worker under another one → the map shows the tree
 * → the second one is dragged right under the owner → the list agrees → a
 * group is created with them as a member → the filter shows only them.
 */
test("40 · company: invite under a manager → map tree → drag → list agrees → group and filter", async ({
  page,
  accounts,
}) => {
  const owner = await accounts.create({ label: "company" });
  const db = admin();
  const idOf = async (name: string) => {
    const { data, error } = await db
      .from("workers")
      .select("id, manager_id")
      .eq("owner_id", owner.id)
      .eq("name", name)
      .single();
    if (error) throw error;
    return data;
  };

  await signIn(page, owner);
  await openApp(page, "/app/firma");

  async function invite(name: string, manager?: string) {
    await page
      .getByRole("button", { name: exact(L, "workers.add") })
      .first()
      .click();
    const form = page.getByRole("dialog", { name: t("workers.form.newTitle") });
    await form.locator("#worker-name").fill(name);
    await form.locator("#worker-email").fill(e2eEmail("company-worker"));
    if (manager) {
      await form.getByTestId("worker-manager").click();
      await page.getByRole("option", { name: manager }).click();
    }
    await form.getByRole("button", { name: exact(L, "workers.form.create") }).click();
    const ready = page.getByRole("dialog", { name: t("workers.form.inviteReady") });
    await ready.getByRole("button", { name: exact(L, "workers.form.done") }).click();
    await expect(ready).toHaveCount(0);
  }

  await invite("E2E Vedoucí");
  await invite("E2E Podřízená", "E2E Vedoucí");
  const lead = await idOf("E2E Vedoucí");
  const report = await idOf("E2E Podřízená");
  expect(report.manager_id).toBe(lead.id);

  // The map: the owner on top, the lead below, the report below the lead.
  await page.getByRole("button", { name: exact(L, "workers.company.view.map") }).click();
  const map = page.getByRole("region", { name: t("workers.company.map.label") });
  // Visible cards only, not their twins in the hidden measuring layer.
  const card = (id: string) => map.locator(`[data-map-node] [data-company-node="${id}"]`);
  await expect(card(report.id)).toHaveAttribute("data-manager", lead.id);
  await map.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await settle(page, card(report.id));
  const [ownerBox, leadBox, reportBox] = await Promise.all([
    card("owner").boundingBox(),
    card(lead.id).boundingBox(),
    card(report.id).boundingBox(),
  ]);
  expect(ownerBox!.y).toBeLessThan(leadBox!.y);
  expect(leadBox!.y).toBeLessThan(reportBox!.y);

  // Drag the report onto the owner: right under the owner now.
  await dragTo(page, card(report.id), card("owner"));
  await expect
    .poll(async () => (await idOf("E2E Podřízená")).manager_id, { message: "under the owner" })
    .toBeNull();
  await expect(card(report.id)).toHaveAttribute("data-manager", "owner");

  // The list agrees.
  await page.getByRole("button", { name: exact(L, "workers.company.view.list") }).click();
  const row = (id: string) => page.locator(`[data-company-row="${id}"]`);
  await expect(row(report.id)).toHaveAttribute("data-depth", "1");
  await expect(row(report.id)).toHaveAttribute("data-manager", "owner");
  await expect(row(lead.id)).toHaveAttribute("data-depth", "1");

  // "Move under…" puts the lead under the report; a cycle is never offered.
  await page
    .getByRole("button", { name: t("workers.company.actions", { name: "E2E Vedoucí" }) })
    .click();
  await page.getByRole("menuitem", { name: t("workers.company.moveMenu") }).click();
  const dialog = page.getByRole("dialog", {
    name: t("workers.company.moveDialog.title", { name: "E2E Vedoucí" }),
  });
  await dialog.getByRole("radio", { name: "E2E Podřízená" }).click();
  await dialog
    .getByRole("button", { name: exact(L, "workers.company.moveDialog.confirm") })
    .click();
  await expect.poll(async () => (await idOf("E2E Vedoucí")).manager_id).toBe(report.id);
  await expect(row(lead.id)).toHaveAttribute("data-depth", "2");

  // A group with the report in it.
  await page.getByRole("tab", { name: t("workers.company.tabs.groups") }).click();
  await page
    .getByRole("button", { name: exact(L, "workers.company.groups.add") })
    .first()
    .click();
  const groupForm = page.getByRole("dialog", { name: t("workers.company.groupForm.newTitle") });
  await groupForm.locator("#group-name").fill("E2E Obchod");
  await groupForm.getByRole("button", { name: t("workers.company.colors.teal") }).click();
  await groupForm.getByRole("button", { name: "E2E Podřízená" }).click();
  await groupForm
    .getByRole("button", { name: exact(L, "workers.company.groupForm.create") })
    .click();
  await expect(groupForm).toHaveCount(0);
  const groupCard = page
    .getByTestId("company-groups")
    .locator("li")
    .filter({ hasText: "E2E Obchod" });
  await expect(groupCard).toBeVisible();
  const { data: group, error: groupError } = await db
    .from("worker_groups")
    .select("id, color, worker_group_members(worker_id)")
    .eq("owner_id", owner.id)
    .eq("name", "E2E Obchod")
    .single();
  if (groupError) throw groupError;
  expect(group.color).toBe("teal");
  expect(group.worker_group_members.map((member) => member.worker_id)).toEqual([report.id]);

  // The filter: the report as a member, the lead (below them, not a member) out of the tree.
  await groupCard.getByRole("button", { name: t("workers.company.groups.show") }).click();
  await expect(page).toHaveURL(new RegExp(`group=${group.id}`));
  await expect(row(report.id)).toBeVisible();
  await expect(row(report.id).getByTestId("group-chip")).toHaveText("E2E Obchod");
  await expect(row(lead.id)).toHaveCount(0);
  await page.getByTestId("company-group-filter").click();
  await page.getByRole("option", { name: t("workers.company.filter.all") }).click();
  await expect(row(lead.id)).toBeVisible();
});
