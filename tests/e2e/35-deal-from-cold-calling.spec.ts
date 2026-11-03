import { admin, seedContacts, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { dismissCelebrationsAutomatically, openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

/**
 * 17.4: Cold Calling → Domluvená schůzka → Založit obchod → the deal is in the
 * pipeline in the stage picked in the settings, with the contact and the
 * meeting in its history → the contact lists the deal under Obchody.
 */
test("35 · cold calling → meeting → create deal in the chosen stage → pipeline with contact and meeting → contact shows the deal", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "cc-deal" });
  const company = "E2E Stavebniny Novák";
  const [contact] = await seedContacts(account, [
    { company_name: company, first_name: "Petr", last_name: "Novák", phone: "+420777555666" },
  ]);
  const db = admin();
  const { data: stages, error: stageError } = await db
    .from("pipeline_stages")
    .select("id, name, system_key")
    .eq("user_id", account.id);
  if (stageError) throw stageError;
  // Not the first stage, so the setting is what puts the deal there.
  const chosen = stages.find((stage) => stage.system_key === "meeting")!;
  const { data: meetingTable, error: tableError } = await db
    .from("contact_tables")
    .select("id, name")
    .eq("user_id", account.id)
    .eq("system_key", "meeting_scheduled")
    .single();
  if (tableError) throw tableError;

  await signIn(page, account);
  await dismissCelebrationsAutomatically(page, L);

  // Settings → Cold Calling: deals from calls land in the meeting stage.
  await openApp(page, "/app/nastaveni/prace");
  await page.locator("#settings-cold-calling-stage").click();
  await page.getByRole("option", { name: chosen.name, exact: true }).click();
  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("user_settings")
          .select("cold_calling_deal_stage_id")
          .eq("user_id", account.id)
          .single();
        return data?.cold_calling_deal_stage_id ?? null;
      },
      { message: "the stage is saved" },
    )
    .toBe(chosen.id);

  // Cold Calling: the contact into Domluvená schůzka, then the offered deal.
  await openApp(page, "/app/cold-calling");
  const list = page.getByRole("list").filter({ hasText: company });
  await list.getByRole("button", { name: new RegExp(company) }).click();
  const panel = page.getByRole("dialog", { name: t("coldCalling.panel.title") });
  await expect(
    panel.getByRole("button", { name: exact(L, "coldCalling.panel.createDeal") }),
  ).toBeVisible();
  await panel.getByRole("button", { name: exact(L, "coldCalling.panel.move") }).click();
  const move = page.getByRole("dialog", { name: t("contacts.move.title") });
  await move.getByRole("button", { name: meetingTable.name }).click();
  await move.getByRole("button", { name: exact(L, "contacts.move.today") }).click();
  await move
    .getByRole("button", { name: t("contacts.move.confirm", { name: meetingTable.name }) })
    .click();
  await expect(
    move.getByText(t("contacts.move.dealOffer.movedWithMeeting", { name: meetingTable.name })),
  ).toBeVisible();
  await move.getByRole("button", { name: exact(L, "contacts.move.dealOffer.create") }).click();
  // Prefilled: the company as the name, the stage from the settings.
  await expect(move.locator("#new-deal-title")).toHaveValue(company);
  await expect(move.locator("#new-deal-stage")).toContainText(chosen.name);
  await move.getByRole("button", { name: exact(L, "pipeline.form.create") }).click();
  await expect(move).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: company })).toContainText(
    t("coldCalling.list.dealCreated", { title: company }),
  );

  // What the database has: the deal in the chosen stage with the contact and
  // the caller, and the meeting the move booked tied to it.
  let dealId = "";
  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("deals")
          .select("id, title, stage_id, contact_id, assignee_id")
          .eq("user_id", account.id);
        if (data?.length === 1) dealId = data[0]!.id;
        return data?.map(({ title, stage_id, contact_id, assignee_id }) => ({
          title,
          stage_id,
          contact_id,
          assignee_id,
        }));
      },
      { message: "the deal is saved" },
    )
    .toEqual([
      { title: company, stage_id: chosen.id, contact_id: contact!.id, assignee_id: account.id },
    ]);
  const { data: meetings } = await db
    .from("calendar_events")
    .select("deal_id, kind, source")
    .eq("user_id", account.id)
    .eq("contact_id", contact!.id);
  expect(meetings).toEqual([{ deal_id: dealId, kind: "meeting", source: "contact_move" }]);

  // The contact's row in Cold Calling links the deal, and the button is gone.
  await page
    .getByRole("group", { name: t("contacts.tables.label") })
    .getByRole("button", { name: new RegExp(meetingTable.name) })
    .click();
  const dealLink = page.getByRole("link", { name: t("coldCalling.list.deal", { title: company }) });
  await expect(dealLink).toBeVisible();
  await page.getByRole("list").filter({ hasText: company }).getByRole("button", { name: new RegExp(company) }).click();
  await expect(panel.getByRole("link", { name: new RegExp(company) })).toBeVisible();
  await expect(
    panel.getByRole("button", { name: exact(L, "coldCalling.panel.createDeal") }),
  ).toHaveCount(0);
  await panel.getByRole("button", { name: exact(L, "coldCalling.panel.close") }).click();

  // The pipeline: in the chosen stage, with the contact and the meeting in its history.
  await dealLink.click();
  await expect(page).toHaveURL(new RegExp(`/app/pipeline\\?deal=${dealId}`));
  const detail = page.getByRole("dialog", { name: t("pipeline.detail.title") });
  await expect(detail.locator("#deal-title")).toHaveValue(company);
  await expect(detail.getByText(chosen.name).first()).toBeVisible();
  const history = detail.getByRole("region", { name: t("pipeline.detail.history") });
  await expect(history.getByText(t("calendar.kind.meeting"), { exact: true })).toBeVisible();
  await expect(history.getByText(company, { exact: true }).first()).toBeVisible();
  await expect(detail.getByText(company).first()).toBeVisible();

  // The contact lists the deal under Obchody, with one open deal in the summary.
  await openApp(page, `/app/kontakty/${contact!.id}`);
  const deals = page.getByRole("region", { name: t("contacts.deals.title"), exact: true });
  await expect(
    deals.getByRole("link", { name: t("contacts.deals.open", { title: company }) }),
  ).toBeVisible();
  const summary = deals.getByRole("definition").first();
  await expect(summary).toHaveText("1");
  await expect(deals.getByText(chosen.name, { exact: true })).toBeVisible();
});
