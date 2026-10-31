import { admin, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

/**
 * 17.2: the deal detail in one window — Close Date changed in place, a second
 * contact with a role, the delivery date as an all-day event in the calendar
 * that only opens the deal, a task, and all of it in the deal's history.
 */
test("33 · deal detail → Close Date → second contact with a note → deadline in the calendar → task → history", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "deal-detail" });
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
  const { data: contacts, error: contactError } = await db
    .from("contacts")
    .insert([
      { user_id: account.id, company_name: "E2E Pekárna Nováková" },
      { user_id: account.id, company_name: "E2E Účetní Dvořák" },
    ])
    .select("id, company_name");
  if (contactError) throw contactError;
  const primary = contacts.find((row) => row.company_name === "E2E Pekárna Nováková")!;
  const second = contacts.find((row) => row.company_name === "E2E Účetní Dvořák")!;
  const dealTitle = "E2E Web pro pekárnu";
  const { data: deal, error: dealError } = await db
    .from("deals")
    .insert({ user_id: account.id, stage_id: stage.id, title: dealTitle, contact_id: primary.id })
    .select("id")
    .single();
  if (dealError) throw dealError;

  await signIn(page, account);
  await openApp(page, `/app/pipeline?deal=${deal.id}`);
  const detail = page.getByRole("dialog", { name: t("pipeline.detail.title") });
  await expect(detail).toBeVisible();
  await expect(detail.locator("#deal-title")).toHaveValue(dealTitle);

  // Close Date, changed in place.
  await detail.locator("#deal-close").click();
  await page.getByRole("button", { name: exact(L, "common.datePicker.today") }).click();
  await expect
    .poll(
      async () => {
        const { data } = await db.from("deals").select("expected_close_date").eq("id", deal.id).single();
        return data?.expected_close_date ?? null;
      },
      { message: "the Close Date is saved" },
    )
    .not.toBeNull();

  // A second contact with a role note; the first stays primary.
  await detail.getByRole("button", { name: exact(L, "pipeline.contacts.add") }).click();
  await detail.locator("#deal-contact-new").fill("Účetní Dvořák");
  await detail.getByRole("button", { name: second.company_name!, exact: true }).click();
  await detail.locator("#deal-contact-note").fill("fakturace");
  await detail.getByRole("button", { name: exact(L, "pipeline.contacts.confirm") }).click();
  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("deal_contacts")
          .select("contact_id, note, is_primary")
          .eq("deal_id", deal.id)
          .order("position");
        return data;
      },
      { message: "the deal has both contacts" },
    )
    .toEqual([
      { contact_id: primary.id, note: null, is_primary: true },
      { contact_id: second.id, note: "fakturace", is_primary: false },
    ]);
  const contactsRegion = detail.getByRole("region", { name: t("pipeline.contacts.title") });
  await expect(contactsRegion.getByText("fakturace", { exact: true })).toBeVisible();

  // The delivery date makes an all-day event in the calendar.
  await detail.locator("#deal-deadline").click();
  await page.getByRole("button", { name: exact(L, "common.datePicker.today") }).click();
  let eventId = "";
  let eventDay = "";
  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("calendar_events")
          .select("id, title, all_day, kind")
          .eq("deal_id", deal.id)
          .eq("source", "deal_deadline");
        if (data?.length === 1) eventId = data[0]!.id;
        return data?.map(({ title, all_day, kind }) => ({ title, all_day, kind }));
      },
      { message: "the deadline event exists" },
    )
    .toEqual([{ title: dealTitle, all_day: true, kind: "deadline" }]);
  const { data: saved } = await db.from("deals").select("deadline_date").eq("id", deal.id).single();
  eventDay = saved!.deadline_date!;

  // A task from the detail.
  const taskTitle = "E2E Poslat návrh webu";
  await detail.getByRole("button", { name: exact(L, "crmTasks.section.add") }).click();
  const form = page.getByRole("dialog", { name: t("crmTasks.form.newTitle") });
  await expect(form).toBeVisible();
  await form.locator("#crm-task-title").fill(taskTitle);
  await form.locator("#crm-task-title").press("Enter");
  await expect(form).toBeHidden();
  await expect(
    detail.getByRole("button", { name: exact(L, "crmTasks.row.open", { title: taskTitle }) }),
  ).toBeVisible();

  // The history has all of it.
  const history = detail.getByRole("region", { name: t("pipeline.detail.history") });
  await expect(history.getByText(t("pipeline.timeline.created"), { exact: true })).toBeVisible();
  await expect(
    history.getByText(new RegExp(`^${t("pipeline.timeline.closeDate", { from: "—", to: "" }).trim()}`)),
  ).toBeVisible();
  await expect(
    history.getByText(t("pipeline.timeline.contactAdded", { name: second.company_name! }), {
      exact: true,
    }),
  ).toBeVisible();
  await expect(history.getByText(t("pipeline.timeline.taskCreated"), { exact: true })).toBeVisible();
  await expect(history.getByText(taskTitle, { exact: true })).toBeVisible();
  await expect
    .poll(
      async () => {
        const { data } = await db.from("deal_events").select("kind").eq("deal_id", deal.id);
        return data?.map((row) => row.kind);
      },
      { message: "the Close Date change is logged" },
    )
    .toEqual(["close_date"]);

  // In the calendar: the event is there, can not be edited, and leads to the deal.
  await openApp(page, "/app/kalendar");
  await expect(page.locator("main").getByRole("button", { name: dealTitle }).first()).toBeVisible();
  await openApp(page, `/app/kalendar?event=${eventId}&date=${eventDay}`);
  const event = page.getByRole("dialog", { name: t("calendar.detail.title") });
  await expect(event).toBeVisible();
  await expect(event.getByText(t("calendar.detail.fromDeal"), { exact: true })).toBeVisible();
  await expect(event.getByRole("button", { name: exact(L, "calendar.detail.edit") })).toHaveCount(0);
  await expect(event.getByRole("button", { name: exact(L, "calendar.detail.delete") })).toHaveCount(0);
  await event.getByRole("link", { name: dealTitle }).click();
  await expect(page).toHaveURL(new RegExp(`/app/pipeline\\?deal=${deal.id}`));
  await expect(page.getByRole("dialog", { name: t("pipeline.detail.title") })).toBeVisible();
});
