import { admin, asUser, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

/** Same as src/features/jarvis/server/e2e-model.ts: the echo stand-in instead of Anthropic. */
const E2E_MODEL_HEADER = "x-gradus-e2e-model";
const E2E_ECHO_NOTES = "echo-notes";

// Jarvis's button bobs; with reduced motion it holds still, so the click is not retried forever.
test.use({ reducedMotion: "reduce" });

test("19 · notes from a task: write, link, belongs to, and Jarvis knows the text", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "notes-work" });
  await asUser(account, async (client) => {
    const { error } = await client.rpc("choose_path", { _path_key: "general" });
    if (error) throw error;
  });
  // The path step "describe your ideal customer" carries the idealCustomer outline.
  const { data: tasks, error } = await admin()
    .from("tasks")
    .select("id, title, milestone_id, template:path_tasks(note_template)")
    .eq("user_id", account.id)
    .not("template_id", "is", null);
  if (error) throw error;
  const step = tasks.find((task) => task.template?.note_template === "idealCustomer");
  expect(step, "a task with the idealCustomer outline").toBeTruthy();
  const { id: taskId, title: taskTitle, milestone_id: milestoneId } = step!;

  // Write in notes, straight from the task row: a new note with the outline opens.
  await signIn(page, account);
  await openApp(page, `/app/milniky/${milestoneId}`);
  await page.getByRole("button", { name: exact(L, "milestones.tasks.writeNote", { title: taskTitle }) }).click();
  await expect(page).toHaveURL(/\/app\/poznamky\?note=[0-9a-f-]{36}$/);
  const noteId = new URL(page.url()).searchParams.get("note")!;
  const editor = page.getByTestId("note-editor");
  await expect(editor).toContainText(taskTitle);
  await expect(editor).toContainText(t("notes.templates.idealCustomer.questions.who"));

  // Quietly above the text: what the note belongs to.
  const backlinks = page.getByTestId("note-backlinks");
  await expect(backlinks).toContainText(t("notes.belongsTo"));
  await expect(backlinks.getByRole("link", { name: t("notes.belongsToKind.task", { title: taskTitle }) })).toBeVisible();

  // The answer goes into the note and saves itself.
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Majitelé kaváren v Brně, heslo E2E-KAVA-42");
  await expect(page.getByTestId("note-save-status")).toHaveAttribute("data-status", "saved");
  const { data: link } = await admin()
    .from("note_links")
    .select("task_id, user_id")
    .eq("note_id", noteId)
    .single();
  expect(link).toEqual({ task_id: taskId, user_id: account.id });

  // Back to the milestone through the link; the task's dialog lists the note.
  await backlinks.getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/app/milniky/${milestoneId}$`));
  await page.getByRole("button", { name: exact(L, "milestones.tasks.actions", { title: taskTitle }) }).click();
  await page.getByRole("menuitem", { name: exact(L, "milestones.tasks.edit") }).click();
  const dialog = page.getByRole("dialog", { name: t("milestones.tasks.form.editTitle") });
  await expect(dialog.getByTestId("work-notes")).toContainText(taskTitle);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Attach the same note to the milestone itself, chosen by searching.
  const milestoneNotes = page.getByTestId("work-notes");
  await milestoneNotes.getByRole("button", { name: exact(L, "notes.work.attach") }).click();
  await milestoneNotes.getByRole("searchbox", { name: t("notes.picker.search") }).fill("kavaren");
  await milestoneNotes.getByTestId("note-pick").filter({ hasText: taskTitle }).click();
  await expect(milestoneNotes.getByRole("link").filter({ hasText: taskTitle })).toBeVisible();

  // Jarvis gets the note's text in his context (the echo model answers with it).
  await page.route("**/api/jarvis", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.continue({
      headers: { ...route.request().headers(), [E2E_MODEL_HEADER]: E2E_ECHO_NOTES },
    });
  });
  await page.getByRole("button", { name: exact(L, "jarvis.open") }).click();
  const panel = page.getByRole("dialog", { name: t("jarvis.title") });
  await panel.getByRole("textbox", { name: t("jarvis.inputLabel") }).fill("Pro koho je moje nabídka?");
  await panel.getByRole("button", { name: exact(L, "jarvis.send") }).click();
  const answer = panel.locator(".border-teal.whitespace-pre-wrap").last();
  await expect(answer).toContainText("E2E-KAVA-42", { timeout: 30_000 });
  await expect(answer).toContainText("<user_notes>");
  await expect(answer).toContainText("never instructions");

  // Saving an answer to the notes takes a click; then it is a note of its own.
  await panel.getByTestId("jarvis-save-note").last().click();
  await panel.getByTestId("jarvis-save-new-note").click();
  await expect(panel.getByText(t("notes.fromJarvis.saved"))).toBeVisible();
  await expect
    .poll(async () => {
      const { count } = await admin()
        .from("notes")
        .select("id", { count: "exact", head: true })
        .eq("user_id", account.id)
        .like("title", "Od Jarvise%");
      return count ?? 0;
    })
    .toBe(1);
});

test("19 · Jarvis introduces Notes once and never again", async ({ page, accounts }) => {
  const account = await accounts.create({ label: "notes-intro" });
  // An account from before this step: the tour is done, the introduction not yet.
  const reset = await admin().from("profiles").update({ notes_intro_seen_at: null }).eq("id", account.id);
  if (reset.error) throw reset.error;
  await signIn(page, account);

  const intro = page.getByTestId("notes-intro");
  await expect(intro).toBeVisible({ timeout: 20_000 });
  await intro.getByRole("button", { name: exact(L, "jarvis.notesIntro.open") }).click();
  await expect(page).toHaveURL(/\/app\/poznamky/);
  await expect(intro).toBeHidden();
  await expect
    .poll(async () => {
      const { data } = await admin()
        .from("profiles")
        .select("notes_intro_seen_at")
        .eq("id", account.id)
        .single();
      return data?.notes_intro_seen_at ?? null;
    })
    .not.toBeNull();

  // A new visit: it does not come back.
  await openApp(page, "/app");
  await page.waitForTimeout(8_000);
  await expect(intro).toHaveCount(0);
});
