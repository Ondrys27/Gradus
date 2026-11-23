import type { Browser, Page } from "@playwright/test";
import { admin, signIn, userClient, type Account } from "./support/accounts";
import { expect, test, watchConsole } from "./support/fixtures";
import { openApp } from "./support/ui";

test.use({ reducedMotion: "reduce" });

const doc = (...lines: string[]) => ({
  type: "doc",
  content: lines.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

async function openNote(browser: Browser, account: Account, noteId: string, consoleErrors: string[]) {
  const context = await browser.newContext({ locale: "cs-CZ", timezoneId: "Europe/Prague" });
  watchConsole(context, consoleErrors);
  const page = await context.newPage();
  await signIn(page, account);
  await openApp(page, `/app/poznamky?shared=1&note=${noteId}`);
  await expect(page.getByTestId("note-editor")).toBeVisible();
  return { context, page };
}

const editorText = (page: Page) => page.getByTestId("note-editor").innerText();

/** Puts the cursor at the end of the note and types on a new line. */
async function typeAtEnd(page: Page, text: string, newLine = false) {
  await page.getByTestId("note-editor").click();
  await page.keyboard.press("ControlOrMeta+End");
  if (newLine) await page.keyboard.press("Enter");
  await page.keyboard.type(text, { delay: 15 });
}

/**
 * 28.4 in three browsers: the owner and an editor write the same paragraph at
 * once → both see the same text and so does the database; the editor goes
 * offline, keeps writing, comes back → merged everywhere; a viewer sees the
 * changes live, can not type, and a direct save of the note is refused.
 */
test("68 · notes: two people write at once → offline merge → a viewer can not write", async ({
  page,
  browser,
  accounts,
  consoleErrors,
}) => {
  const owner = await accounts.create({ label: "notes-live-owner" });
  const editor = await accounts.create({ label: "notes-live-editor" });
  const viewer = await accounts.create({ label: "notes-live-viewer" });
  const db = admin();
  for (const [person, name] of [
    [editor, "E2E Editorka"],
    [viewer, "E2E Čtenář"],
  ] as const) {
    const { error } = await db
      .from("workers")
      .insert({ owner_id: owner.id, user_id: person.id, name, email: person.email, status: "active" });
    if (error) throw error;
  }

  // The owner's note, shared with one editor and one viewer.
  const ownerDb = await userClient(owner.email, owner.password);
  const { data: note, error: noteError } = await ownerDb
    .from("notes")
    .insert({
      user_id: owner.id,
      space_id: owner.id,
      title: "E2E Porada",
      content: doc("E2E Porada", "Body:") as never,
      content_text: "E2E Porada\nBody:",
    })
    .select("id")
    .single();
  if (noteError) throw noteError;
  for (const [person, role] of [
    [editor, "editor"],
    [viewer, "viewer"],
  ] as const) {
    const { error } = await ownerDb.rpc("note_share_set", {
      _note: note.id,
      _folder: null as never,
      _target_kind: "member",
      _target: person.id,
      _role: role,
      _can_reshare: false,
    });
    if (error) throw error;
  }

  await signIn(page, owner);
  await openApp(page, `/app/poznamky?note=${note.id}`);
  const ownerEditor = page.getByTestId("note-editor");
  await expect(ownerEditor).toContainText("Body:");
  const second = await openNote(browser, editor, note.id, consoleErrors);
  try {
    // Each sees the other there.
    await expect(page.getByTestId("note-live-person")).toHaveCount(1);
    await expect(second.page.getByTestId("note-live-person")).toHaveCount(1);

    // Both type into the same paragraph at the same time.
    await Promise.all([typeAtEnd(page, " rozpočet"), typeAtEnd(second.page, " nábor")]);
    await expect
      .poll(async () => {
        const [a, b] = [await editorText(page), await editorText(second.page)];
        return a === b && a.includes("rozpočet") && a.includes("nábor");
      })
      .toBe(true);
    await expect(page.getByTestId("note-save-status")).toHaveAttribute("data-status", "saved");
    await expect(second.page.getByTestId("note-save-status")).toHaveAttribute("data-status", "saved");
    await expect
      .poll(async () => {
        const { data } = await db.from("notes").select("content_text, ydoc_version").eq("id", note.id).single();
        return (data?.content_text ?? "").includes("rozpočet") && (data?.content_text ?? "").includes("nábor");
      })
      .toBe(true);

    // The editor loses the connection and keeps writing; the owner writes too.
    await second.context.setOffline(true);
    await typeAtEnd(second.page, "Napsáno ve vlaku", true);
    await expect(second.page.getByTestId("note-save-status")).toHaveAttribute("data-status", "offline");
    await typeAtEnd(page, "Napsáno v kanceláři", true);
    await expect(page.getByTestId("note-save-status")).toHaveAttribute("data-status", "saved");

    // Back online: merged in both browsers and in the database.
    await second.context.setOffline(false);
    await expect
      .poll(async () => {
        const [a, b] = [await editorText(page), await editorText(second.page)];
        return a === b && a.includes("Napsáno ve vlaku") && a.includes("Napsáno v kanceláři");
      }, { timeout: 45_000 })
      .toBe(true);
    await expect
      .poll(async () => {
        const { data } = await db.from("notes").select("content_text").eq("id", note.id).single();
        const text = data?.content_text ?? "";
        return text.includes("Napsáno ve vlaku") && text.includes("Napsáno v kanceláři");
      }, { timeout: 45_000 })
      .toBe(true);

    // A viewer sees it live and can not type.
    const third = await openNote(browser, viewer, note.id, consoleErrors);
    try {
      const viewerEditor = third.page.getByTestId("note-editor");
      await expect(viewerEditor).toHaveAttribute("contenteditable", "false");
      await expect(viewerEditor).toContainText("Napsáno ve vlaku");
      await typeAtEnd(page, "Pro čtenáře", true);
      await expect(viewerEditor).toContainText("Pro čtenáře");

      // Not even by calling the save directly.
      await expect(page.getByTestId("note-save-status")).toHaveAttribute("data-status", "saved");
      const viewerDb = await userClient(viewer.email, viewer.password);
      const { data: before } = await db.from("notes").select("content_text, ydoc_version").eq("id", note.id).single();
      const { data: refused, error: refusedError } = await viewerDb.rpc("note_collab_save", {
        _note: note.id,
        _base: before!.ydoc_version,
        _ydoc: "\\x0000",
        _kind: "text",
        _title: "Podvrh",
        _content: doc("Podvrh") as never,
        _content_text: "Podvrh",
        _authors: [],
      });
      expect(refusedError).toBeNull();
      expect(refused?.[0]?.status).toBe("denied");
      const { error: directError } = await viewerDb
        .from("notes")
        .update({ content_text: "Podvrh" })
        .eq("id", note.id)
        .select("id");
      expect(directError === null || /permission|denied/i.test(directError.message)).toBe(true);
      const { data: after } = await db.from("notes").select("content_text").eq("id", note.id).single();
      expect(after?.content_text).not.toContain("Podvrh");
    } finally {
      await third.context.close();
    }
  } finally {
    await second.context.close();
  }
});
