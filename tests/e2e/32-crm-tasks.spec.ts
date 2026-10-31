import { admin, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

test("32 · task from a deal → in Tasks → filter Today → done with a note → in the deal's history", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "crm-tasks" });
  const db = admin();
  const { data: stage, error: stageError } = await db
    .from("pipeline_stages")
    .select("id")
    .eq("user_id", account.id)
    .eq("is_won", false)
    .eq("is_lost", false)
    .order("position")
    .limit(1)
    .single();
  if (stageError) throw stageError;
  const { data: contact, error: contactError } = await db
    .from("contacts")
    .insert({ user_id: account.id, company_name: "E2E Pekárna Nováková" })
    .select("id")
    .single();
  if (contactError) throw contactError;
  const dealTitle = "E2E Web pro pekárnu";
  const { data: deal, error: dealError } = await db
    .from("deals")
    .insert({ user_id: account.id, stage_id: stage.id, title: dealTitle, contact_id: contact.id })
    .select("id")
    .single();
  if (dealError) throw dealError;

  const title = "E2E Zavolat kvůli nabídce";
  const note = "Volal jsem s klientkou, pošle podklady v pondělí";

  // A task from the deal: title, "Dnes", Enter.
  await signIn(page, account);
  await openApp(page, `/app/pipeline?deal=${deal.id}`);
  const detail = page.getByRole("dialog", { name: t("pipeline.detail.title") });
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: exact(L, "crmTasks.section.add") }).click();
  const form = page.getByRole("dialog", { name: t("crmTasks.form.newTitle") });
  await expect(form).toBeVisible();
  // The deal and its contact are already filled in.
  await expect(form.getByText(dealTitle, { exact: true })).toBeVisible();
  await form.getByRole("button", { name: exact(L, "crmTasks.form.quick.today") }).click();
  await form.locator("#crm-task-title").fill(title);
  await form.locator("#crm-task-title").press("Enter");
  await expect(form).toBeHidden();
  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("crm_tasks")
          .select("deal_id, contact_id, assignee_id, created_by, status, duration_minutes")
          .eq("user_id", account.id)
          .eq("title", title)
          .maybeSingle();
        return data;
      },
      { message: "the task is saved for the deal with the defaults" },
    )
    .toEqual({
      deal_id: deal.id,
      contact_id: contact.id,
      assignee_id: account.id,
      created_by: account.id,
      status: "open",
      duration_minutes: 15,
    });
  await expect(
    detail.getByRole("button", { name: exact(L, "crmTasks.row.open", { title }) }),
  ).toBeVisible();

  // In Tasks, then only today's.
  await openApp(page, "/app/ukoly-crm");
  const row = page.getByRole("button", { name: exact(L, "crmTasks.row.open", { title }) });
  await expect(row).toBeVisible();
  await page.getByRole("radio", { name: exact(L, "crmTasks.quick.today") }).click();
  await expect(page).toHaveURL(/[?&]due=today/);
  await expect(page.getByRole("radio", { name: exact(L, "crmTasks.quick.today") })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(row).toBeVisible();

  // Done, with a note in the same step.
  await page.getByRole("checkbox", { name: exact(L, "crmTasks.row.complete", { title }) }).click();
  const done = page.getByRole("dialog", { name: t("crmTasks.complete.title") });
  await expect(done).toBeVisible();
  await done.getByLabel(t("crmTasks.complete.note")).fill(note);
  await done.getByRole("button", { name: exact(L, "crmTasks.complete.confirm") }).click();
  await expect(done).toBeHidden();
  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("crm_tasks")
          .select("status, completion_note, completed_by")
          .eq("user_id", account.id)
          .eq("title", title)
          .maybeSingle();
        return data;
      },
      { message: "the task is done with its note" },
    )
    .toEqual({ status: "done", completion_note: note, completed_by: account.id });

  // The note shows in the deal's history.
  await openApp(page, `/app/pipeline?deal=${deal.id}`);
  const history = page
    .getByRole("dialog", { name: t("pipeline.detail.title") })
    .getByRole("region", { name: t("pipeline.detail.history") });
  await expect(history.getByText(t("crmTasks.history.done"), { exact: true })).toBeVisible();
  await expect(history.getByText(note, { exact: true })).toBeVisible();
  await expect(history.getByText(title, { exact: true })).toBeVisible();
});
