import { admin, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { pickFirstMeetingTime } from "./support/meeting";
import { dismissCelebrationsAutomatically, openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

test("5 · contact by hand → moved to Meeting scheduled with a time from the scheduler and its questions → event in the calendar", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "contact" });
  await signIn(page, account);
  await dismissCelebrationsAutomatically(page, L);
  const company = "E2E Kavárna U Mostu";

  await openApp(page, "/app/kontakty");
  await page
    .getByRole("button", { name: exact(L, "contacts.actions.newContact") })
    .first()
    .click();
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
  // 30.4: the meeting is booked through the scheduler — the one step of
  // working hours, a free time held for the dialog, then the table's questions.
  const submit = move.getByTestId("meeting-submit");
  await expect(submit.or(move.getByTestId("meeting-quick-setup"))).toBeVisible({ timeout: 20_000 });
  const start = await pickFirstMeetingTime(move);
  await move.getByRole("textbox", { name: "O jaký produkt má zájem" }).fill("Webové stránky");
  await submit.click();
  await expect(move).toBeHidden({ timeout: 20_000 });
  await expect(
    page.getByText(t("contacts.move.movedWithMeeting", { name: meetingTable.name })),
  ).toBeVisible();

  // What the database has now: one entry in the meeting table, the booking's meeting.
  const db = admin();
  const { data: entries } = await db
    .from("contact_table_entries")
    .select("table_id")
    .eq("user_id", account.id);
  expect(entries).toEqual([{ table_id: meetingTable.id }]);
  const { data: events } = await db
    .from("calendar_events")
    .select("id, title, kind, contact_id, source, starts_at")
    .eq("user_id", account.id);
  expect(events).toHaveLength(1);
  expect(events![0]).toMatchObject({ kind: "meeting", source: "booking" });
  expect(Date.parse(events![0]!.starts_at)).toBe(start);
  const { data: bookings } = await db
    .from("bookings")
    .select("status, source, created_by, host_user_id")
    .eq("space_id", account.id);
  expect(bookings).toEqual([
    { status: "confirmed", source: "app", created_by: account.id, host_user_id: account.id },
  ]);

  // And the calendar shows it, on its day: late in the week the first free
  // time can fall in the next week, outside the week the calendar opens on.
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(start);
  await openApp(page, `/app/kalendar?event=${events![0]!.id}&date=${day}`);
  // A booking's meeting is called "type · guest" (24.4), not by the company.
  await expect(page.locator("main").getByText(events![0]!.title).first()).toBeVisible();
});
