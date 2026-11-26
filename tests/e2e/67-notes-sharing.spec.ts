import { admin, signIn, skipCompanyTutorial } from "./support/accounts";
import { expect, test, watchConsole } from "./support/fixtures";
import { text } from "./support/i18n";
import { openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

test.use({ reducedMotion: "reduce" });

/**
 * 28.3 in two browsers, the owner and a worker in a group: the owner shares
 * a folder with the group → the member sees its note under Shared with me
 * and hears it in the bell → as a viewer they can not write → made an
 * editor, they write and the owner gets the text → the share removed, the
 * member's next save is refused at once (nothing kept for later) and the
 * note is gone after a reload.
 */
test("67 · notes: folder shared with a group → viewer reads → editor writes → access removed", async ({
  page,
  browser,
  accounts,
  consoleErrors,
}) => {
  const owner = await accounts.create({ label: "notes-share-owner" });
  const person = await accounts.create({ label: "notes-share-member" });
  const db = admin();
  const { data: worker, error } = await db
    .from("workers")
    .insert({ owner_id: owner.id, user_id: person.id, name: "E2E Kolegyně", email: person.email, status: "active" })
    .select("id")
    .single();
  if (error) throw error;
  await skipCompanyTutorial(person.id, owner.id);
  const { data: group, error: groupError } = await db
    .from("worker_groups")
    .insert({ owner_id: owner.id, name: "E2E Obchod", color: "teal" })
    .select("id")
    .single();
  if (groupError) throw groupError;
  const { error: memberError } = await db
    .from("worker_group_members")
    .insert({ group_id: group.id, worker_id: worker.id, owner_id: owner.id });
  if (memberError) throw memberError;

  // The owner makes a folder and writes a note in it.
  await signIn(page, owner);
  await openApp(page, "/app/poznamky");
  await page.getByTestId("notes-folder-new").click();
  await page.getByTestId("note-folder-name").fill("E2E Podklady");
  await page.getByTestId("note-folder-save").click();
  const folderRow = page.locator('[data-testid="notes-folder"]', { hasText: "E2E Podklady" });
  await expect(folderRow).toHaveAttribute("aria-current", "true");
  await page.getByTestId("note-new").click();
  const editor = page.getByTestId("note-editor");
  await expect(editor).toBeFocused();
  await page.keyboard.type("E2E Sdílený ceník");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Konzultace 1 500 Kč");
  await expect(page.getByTestId("note-save-status")).toHaveAttribute("data-status", "saved");
  const { data: saved } = await db
    .from("notes")
    .select("id, folder_id, space_id")
    .eq("user_id", owner.id)
    .eq("title", "E2E Sdílený ceník")
    .single();
  expect(saved?.space_id).toBe(owner.id);
  expect(saved?.folder_id).toBeTruthy();
  const noteId = saved!.id;

  // Shared with the group, as viewers.
  await folderRow.hover();
  await page.locator('[data-testid="notes-folder-menu"]').first().click();
  await page.getByTestId("notes-folder-share").click();
  const dialog = page.getByTestId("note-share-dialog");
  await dialog.getByTestId("note-share-target").selectOption(`group:${group.id}`);
  await dialog.getByTestId("note-share-role").selectOption("viewer");
  await dialog.getByTestId("note-share-add").click();
  const groupEntry = dialog.locator('[data-testid="note-share-entry"][data-kind="group"]');
  await expect(groupEntry).toContainText("E2E Obchod");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-testid="notes-folder-shared"]').first()).toBeVisible();

  const memberContext = await browser.newContext({ locale: "cs-CZ", timezoneId: "Europe/Prague" });
  watchConsole(memberContext, consoleErrors);
  const memberPage = await memberContext.newPage();
  try {
    await signIn(memberPage, person);
    // The bell says it.
    await expect(memberPage.getByTestId("inbox-count")).toBeVisible();
    await memberPage.getByTestId("inbox-bell").click();
    await expect(
      memberPage.locator('[data-testid="inbox-notification"][data-kind="note_shared"]').first(),
    ).toContainText("E2E Podklady");
    await memberPage.keyboard.press("Escape");

    // Shared with me: the note is there, read only.
    await openApp(memberPage, "/app/poznamky");
    await memberPage.getByTestId("notes-scope-shared").click();
    const sharedRow = memberPage.locator('[data-testid="note-row"]', { hasText: "E2E Sdílený ceník" });
    await expect(sharedRow).toHaveAttribute("data-role", "viewer");
    await sharedRow.click();
    const memberEditor = memberPage.getByTestId("note-editor");
    await expect(memberEditor).toContainText("Konzultace 1 500 Kč");
    await expect(memberEditor).toHaveAttribute("contenteditable", "false");
    await expect(memberPage.getByTestId("note-delete")).toHaveCount(0);
    await expect(memberPage.getByTestId("note-shared-by")).toContainText(t("notes.sharing.viewOnly"));

    // The owner makes the group editors.
    await page.locator('[data-testid="notes-folder-menu"]').first().click();
    await page.getByTestId("notes-folder-share").click();
    await dialog
      .locator('[data-testid="note-share-entry"][data-kind="group"]')
      .getByTestId("note-share-entry-role")
      .selectOption("editor");
    await expect
      .poll(async () => {
        const { data } = await db.from("note_shares").select("role").eq("folder_id", saved!.folder_id!);
        return (data ?? []).map((row) => row.role);
      })
      .toEqual(["editor"]);

    // Now the member writes, and the text reaches the owner's note.
    await memberPage.reload();
    await expect(memberEditor).toHaveAttribute("contenteditable", "true");
    await memberEditor.click();
    await memberPage.keyboard.press("ControlOrMeta+End");
    await memberPage.keyboard.press("Enter");
    await memberPage.keyboard.type("Doplnila kolegyně");
    await expect(memberPage.getByTestId("note-save-status")).toHaveAttribute("data-status", "saved");
    await expect
      .poll(async () => {
        const { data } = await db.from("notes").select("content_text").eq("id", noteId).single();
        return data?.content_text ?? "";
      })
      .toContain("Doplnila kolegyně");
    // Who saved it is in the history.
    const { data: versions } = await db.from("note_versions").select("saved_by").eq("note_id", noteId);
    expect((versions ?? []).map((v) => v.saved_by)).toContain(person.id);

    // The owner takes the access away: the member's next save is refused at once.
    await dialog
      .locator('[data-testid="note-share-entry"][data-kind="group"]')
      .getByTestId("note-share-remove")
      .click();
    await expect(dialog.locator('[data-testid="note-share-entry"][data-kind="group"]')).toHaveCount(0);
    await memberEditor.click();
    await memberPage.keyboard.press("ControlOrMeta+End");
    await memberPage.keyboard.type(" a ještě");
    await expect(memberPage.getByTestId("note-save-status")).toHaveAttribute("data-status", "denied");
    const { data: after } = await db.from("notes").select("content_text").eq("id", noteId).single();
    expect(after?.content_text).not.toContain("a ještě");

    // After a reload the note is gone from the member's notes.
    await memberPage.goto("/app/poznamky?shared=1");
    await expect(memberPage.getByTestId("notes-nav")).toBeVisible();
    await expect(memberPage.locator('[data-testid="note-row"]', { hasText: "E2E Sdílený ceník" })).toHaveCount(0);
  } finally {
    await memberContext.close();
  }
});
