import { admin, asUser, seedContacts, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

function noteDoc(title: string, body: string) {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
      { type: "paragraph", content: [{ type: "text", text: body }] },
    ],
  };
}

test("26 · notes: @contact chip opens the contact, which lists the note", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "mentions" });
  const [contact] = await seedContacts(account, [{ first_name: "Jan", last_name: "Zmíňák" }]);
  await signIn(page, account);
  await page.goto("/app/poznamky");

  const editor = page.getByTestId("note-editor");
  const status = page.getByTestId("note-save-status");
  await page.getByTestId("note-new").click();
  await expect(editor).toBeFocused();
  await page.keyboard.type("E2E Plán hovorů");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Zavolat @zminak");

  // The @ menu searches the user's records without diacritics, grouped by kind.
  const menu = page.getByTestId("mention-menu");
  const option = menu.getByTestId("mention-option").filter({ hasText: "Jan Zmíňák" });
  await expect(option).toBeVisible();
  await expect(menu.getByRole("group", { name: t("search.groups.contact") })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();

  const chip = editor.getByTestId("note-mention");
  await expect(chip).toHaveCount(1);
  await expect(chip).toContainText("Jan Zmíňák");
  await expect(chip).toHaveAttribute("data-state", "live");
  await page.keyboard.type("zítra");
  await expect(status).toHaveAttribute("data-status", "saved");

  // Saved as a node with type, id and label; the plain text carries the label,
  // and the database lists the mention.
  const db = admin();
  const { data: notes } = await db
    .from("notes")
    .select("id, content_text")
    .eq("user_id", account.id);
  expect(notes).toHaveLength(1);
  expect(notes![0].content_text).toContain(`[${t("notes.mention.kind.contact")}: Jan Zmíňák]`);
  const { data: mentions } = await db
    .from("note_mentions")
    .select("target_type, target_id")
    .eq("note_id", notes![0].id);
  expect(mentions).toEqual([{ target_type: "contact", target_id: contact.id }]);

  // The chip opens the contact; the contact shows the note.
  await chip.getByRole("button").click();
  await expect(page).toHaveURL(new RegExp(`/app/kontakty/${contact.id}$`));
  const mentioned = page.getByTestId("mentioned-in-notes");
  await expect(mentioned).toContainText(t("notes.mentioned.title"));
  await mentioned.getByRole("link", { name: /E2E Plán hovorů/ }).click();
  await expect(page).toHaveURL(new RegExp(`/app/poznamky\\?note=${notes![0].id}`));
  await expect(chip).toContainText("Jan Zmíňák");

  // A renamed contact shows its new name; a deleted one is struck through.
  await db.from("contacts").update({ last_name: "Přejmenovaný" }).eq("id", contact.id);
  await page.reload();
  await expect(editor.getByTestId("note-mention")).toContainText("Jan Přejmenovaný");
  await db.from("contacts").delete().eq("id", contact.id);
  await page.reload();
  const gone = editor.getByTestId("note-mention");
  await expect(gone).toHaveAttribute("data-state", "missing");
  await expect(gone.getByTitle(t("notes.mention.missing"))).toBeVisible();
  await expect(editor).toContainText("zítra");
});

test("26 · notes: the list's bin asks first, Undo and the Delete key", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "notes-bin" });
  await asUser(account, async (client) => {
    for (const [title, body] of [
      ["E2E Starší", "první"],
      ["E2E Novější", "druhá"],
    ]) {
      const { error } = await client.from("notes").insert({
        user_id: account.id,
        title,
        content: noteDoc(title, body),
        content_text: `${title}\n${body}`,
      });
      if (error) throw error;
    }
  });
  await signIn(page, account);
  await page.goto("/app/poznamky");

  const rows = page.getByTestId("note-row");
  await expect(rows).toHaveCount(2);
  const newer = page.locator("li", { has: rows.filter({ hasText: "E2E Novější" }) });
  await newer.hover();
  await newer.getByTestId("note-row-delete").click();

  const confirm = page.getByRole("dialog", {
    name: t("notes.deleteConfirm.title", { title: "E2E Novější" }),
  });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: exact(L, "notes.deleteConfirm.cancel") }).first().click();
  await expect(confirm).toBeHidden();
  await expect(rows).toHaveCount(2);

  await newer.getByTestId("note-row-delete").click();
  await confirm.getByRole("button", { name: exact(L, "notes.deleteConfirm.confirm") }).click();
  await expect(rows).toHaveCount(1);
  // The list moves on to the neighbour, and Undo waits at the bottom.
  await expect(page).toHaveURL(/\?note=/);
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  const undo = page.getByTestId("notes-undo");
  await expect(undo).toContainText(t("notes.deleted"));
  await undo.getByRole("button", { name: exact(L, "notes.undo") }).click();
  await expect(rows).toHaveCount(2);

  // Delete on a selected row asks the same way.
  const older = rows.filter({ hasText: "E2E Starší" });
  await older.focus();
  await page.keyboard.press("Delete");
  const confirmOlder = page.getByRole("dialog", {
    name: t("notes.deleteConfirm.title", { title: "E2E Starší" }),
  });
  await expect(confirmOlder).toBeVisible();
  await confirmOlder.getByRole("button", { name: exact(L, "notes.deleteConfirm.confirm") }).click();
  await expect(rows.filter({ hasText: "E2E Starší" })).toHaveCount(0);

  // The trash says how long notes stay.
  await page.getByTestId("notes-trash-open").click();
  await expect(page.getByTestId("notes-trash")).toContainText(t("notes.trash.hint"));
  await expect(page.getByTestId("trash-row").filter({ hasText: "E2E Starší" })).toBeVisible();
});
