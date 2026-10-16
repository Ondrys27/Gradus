import { signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

test("18 · notes: template, writing, reload, search, trash and restore", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "notes" });
  await signIn(page, account);
  await page.goto("/app/poznamky");

  const editor = page.getByTestId("note-editor");
  const status = page.getByTestId("note-save-status");
  const rows = page.getByTestId("note-row");

  // No notes yet: five prepared outlines, one click each.
  const templates = page.getByTestId("note-templates");
  await expect(templates.getByRole("button")).toHaveCount(5);
  await templates
    .getByRole("button", {
      name: exact(L, "notes.empty.useTemplate", { title: t("notes.templates.pricing.title") }),
    })
    .click();
  await expect(editor).toContainText(t("notes.templates.pricing.questions.items"));
  await expect(status).toHaveAttribute("data-status", "saved");

  // A new note: the first line is the title, Markdown shortcuts work, it saves itself.
  await page.getByTestId("note-new").click();
  await expect(editor).toBeFocused();
  await page.keyboard.type("E2E Nápady na kavárnu");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Espresso s levandulí");
  await page.keyboard.press("Enter");
  await page.keyboard.type("[ ] Zavolat dodavateli");
  await expect(editor.locator('ul[data-type="taskList"]')).toContainText("Zavolat dodavateli");
  await expect(status).toHaveAttribute("data-status", "saved");
  await expect(rows.first()).toContainText("E2E Nápady na kavárnu");
  await expect(rows.first()).toContainText("Espresso s levandulí");

  // After a reload the text is still there.
  await page.reload();
  await rows.filter({ hasText: "E2E Nápady na kavárnu" }).click();
  await expect(editor).toContainText("Espresso s levandulí");
  await expect(editor.locator('ul[data-type="taskList"]')).toContainText("Zavolat dodavateli");

  // Search in the list, without diacritics and by the start of a word.
  const search = page.getByTestId("notes-search");
  await search.fill("levandul");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("E2E Nápady na kavárnu");
  await search.fill("zzz neexistuje");
  await expect(page.getByText(t("notes.noResults", { query: "zzz neexistuje" }))).toBeVisible();
  await search.fill("");
  await expect(rows).toHaveCount(2);

  // ⌘K finds notes too.
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: t("search.dialog.title") });
  await palette.getByRole("combobox", { name: t("search.dialog.title") }).fill("kavarnu")
  await expect(
    palette.getByRole("option", { name: /E2E Nápady na kavárnu/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();

  // Delete moves it to Recently Deleted, Restore brings it back with its text.
  await rows.filter({ hasText: "E2E Nápady na kavárnu" }).click();
  await page.getByTestId("note-delete").click();
  await expect(rows.filter({ hasText: "E2E Nápady na kavárnu" })).toHaveCount(0);
  await page.getByTestId("notes-trash-open").click();
  const trashed = page.getByTestId("trash-row").filter({ hasText: "E2E Nápady na kavárnu" });
  await expect(trashed).toBeVisible();
  await trashed.getByRole("button", { name: exact(L, "notes.trash.restore") }).click();
  await expect(rows.filter({ hasText: "E2E Nápady na kavárnu" })).toBeVisible();
  await expect(editor).toContainText("Espresso s levandulí");
});
