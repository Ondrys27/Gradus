import { admin, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { dismissCelebrationsAutomatically, openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

test("5 · contact by hand → moved to Meeting scheduled with its questions → event in the calendar", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "contact" });
  await signIn(page, account);
  await dismissCelebrationsAutomatically(page, L);
  const company = "E2E Kavárna U Mostu";

  await openApp(page, "/app/kontakty");
  await page.getByRole("button", { name: exact(L, "contacts.actions.newContact") }).first().click();
  const form = page.getByRole("dialog", { name: t("contacts.form.createTitle") });
  await form.locator("#contact-company_name").fill(company);
  await form.locator("#contact-first_name").fill("Jana");
  await form.locator("#contact-phone").fill("777 123 456");
  await form.getByRole("button", { name: exact(L, "contacts.form.create") }).click();
  await expect(page).toHaveURL(/\/app\/kontakty\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(company);

  // A new contact starts in Unreached.
  const { data: tables } = await admin()
    .from("contact_tables")
    .select("id, name, system_key")
    .eq("user_id", account.id);
  const meetingTable = tables!.find((table) => table.system_key === "meeting_scheduled")!;

  await page.getByRole("button", { name: exact(L, "contacts.move.open") }).click();
  const move = page.getByRole("dialog", { name: t("contacts.move.title") });
  await move.getByRole("button", { name: meetingTable.name }).click();
  await expect(move.getByText(t("contacts.move.movingTo", { name: meetingTable.name }))).toBeVisible();
  // The table's questions: When? is required, so confirming without it is refused.
  const confirm = move.getByRole("button", { name: t("contacts.move.confirm", { name: meetingTable.name }) });
  await confirm.click();
  await expect(move.getByText(t("contacts.move.errors.required")).first()).toBeVisible();
  await move.getByRole("button", { name: exact(L, "contacts.move.today") }).click();
  await move.getByRole("textbox", { name: "O jaký produkt má zájem" }).fill("Webové stránky");
  await confirm.click();
  await expect(move).toBeHidden();
  await expect(page.getByText(t("contacts.move.movedWithMeeting", { name: meetingTable.name }))).toBeVisible();

  // What the database has now: one entry in the meeting table, a meeting event.
  const db = admin();
  const { data: entries } = await db
    .from("contact_table_entries")
    .select("table_id")
    .eq("user_id", account.id);
  expect(entries).toEqual([{ table_id: meetingTable.id }]);
  const { data: events } = await db
    .from("calendar_events")
    .select("title, kind, contact_id")
    .eq("user_id", account.id);
  expect(events).toHaveLength(1);
  expect(events![0]).toMatchObject({ title: company, kind: "meeting" });

  // And the calendar shows it.
  await openApp(page, "/app/kalendar");
  await expect(page.locator("main").getByText(company).first()).toBeVisible();
});
