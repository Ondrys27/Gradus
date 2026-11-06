import { readFile } from "node:fs/promises";
import path from "node:path";
import { admin, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

// Nodes glide to their place; with reduced motion they are there at once.
test.use({ reducedMotion: "reduce" });

const OPML = path.resolve(__dirname, "../fixtures/mindmap/sample.opml");

/**
 * 20.2: an OPML file (as MindNode exports it) is imported into an empty
 * milestone, the map shows its tasks with the milestone selected, done items
 * came in done, and the Markdown export carries exactly the same tree.
 */
test("43 · import OPML → the map shows it → export Markdown → the content matches", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "mindmap-import" });
  const db = admin();
  const title = "E2E Import mapy";
  const { data: milestone, error } = await db
    .from("milestones")
    .insert({ user_id: account.id, title, position: 0 })
    .select("id")
    .single();
  if (error) throw error;

  await signIn(page, account);
  await openApp(page, `/app/milniky/${milestone.id}`);

  // Import: pick the file, look at the preview, import.
  await page.getByRole("button", { name: exact(L, "milestones.mapIo.importButton") }).click();
  const dialog = page.getByRole("dialog", { name: t("milestones.mapIo.importTitle") });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(t("milestones.mapIo.fileLabel")).setInputFiles(OPML);
  const preview = dialog.getByTestId("mindmap-preview");
  await expect(preview.getByText("Úprava fotek", { exact: true })).toBeVisible();
  await expect(dialog.getByTestId("mindmap-summary")).toContainText("9");
  await dialog.locator("button[type='submit']").click();
  await expect(dialog).toBeHidden();

  // The tasks are in the database with their states.
  const { data: tasks, error: tasksError } = await db
    .from("tasks")
    .select("title, status, parent_task_id, id")
    .eq("milestone_id", milestone.id);
  if (tasksError) throw tasksError;
  expect(tasks).toHaveLength(9);
  const done = tasks.filter((task) => task.status === "done").map((task) => task.title).sort();
  expect(done).toEqual(["Koupit doménu", "Pozadí a světlo", "Vybrat dodavatele"]);
  const byTitle = new Map(tasks.map((task) => [task.title, task]));
  expect(byTitle.get("Úprava fotek")?.parent_task_id).toBe(byTitle.get("Nafotit produkty")?.id);

  // The map shows them, with the milestone selected.
  const map = page.getByRole("region", { name: t("milestones.map.label") });
  await expect(
    map.getByRole("button", { name: t("milestones.map.open", { title: "Úprava fotek" }) }),
  ).toBeVisible();
  await expect(map.locator("[data-mindmap-node][data-selected]")).toBeFocused();

  // Export Markdown: the same tree with the milestone at the root.
  await page.getByRole("button", { name: exact(L, "milestones.mapIo.export.label") }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: exact(L, "milestones.mapIo.export.markdown") }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`${title}.md`);
  const markdown = await readFile((await download.path())!, "utf-8");
  expect(markdown).toBe(
    [
      `# ${title}`,
      "",
      "- [ ] Produkty",
      "  - [x] Vybrat dodavatele",
      "  - [ ] Nafotit produkty",
      "    - [x] Pozadí a světlo",
      "    - [ ] Úprava fotek",
      "- [ ] Web & doména",
      "  - [x] Koupit doménu",
      "  - [ ] Vybrat šablonu",
      "- [ ] Marketing",
      "",
    ].join("\n"),
  );
});
