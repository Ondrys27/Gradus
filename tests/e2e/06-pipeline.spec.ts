import type { Locator, Page } from "@playwright/test";
import { admin, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { closeAllCelebrations, dismissCelebrationsAutomatically, openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

/** A real mouse drag (dnd-kit starts after 6 px), dropped in the middle of the target column. */
async function drag(page: Page, card: Locator, column: Locator) {
  await column.evaluate((element) => element.scrollIntoView({ block: "nearest", inline: "nearest" }));
  await card.scrollIntoViewIfNeeded();
  const from = (await card.boundingBox())!;
  const to = (await column.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(to.height / 2, 160), { steps: 15 });
  await page.mouse.up();
}

test("6 · deal → dragged to the won stage → celebration → contact in Clients → income in Finance", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "pipeline", mode: "game" });
  await signIn(page, account);
  const smallWins = await dismissCelebrationsAutomatically(page, L);
  // Leaving the Meeting stage asks how the meeting went; the journey skips it.
  let surveyAsked = false;
  const survey = page.getByRole("dialog", { name: t("dashboard.survey.title") });
  await page.addLocatorHandler(survey, async () => {
    surveyAsked = true;
    await survey.getByRole("button", { name: exact(L, "dashboard.survey.skip") }).click();
  });
  const title = "E2E Web pro pekárnu";
  const contactName = "E2E Pekárna Novák";

  await openApp(page, "/app/pipeline");
  await page.getByRole("button", { name: exact(L, "pipeline.actions.newDeal") }).first().click();
  const form = page.getByRole("dialog", { name: t("pipeline.form.createTitle") });
  await form.locator("#new-deal-title").fill(title);
  await form.locator("#new-deal-contact").fill(contactName);
  await form.getByRole("button", { name: t("pipeline.form.contactCreate", { name: contactName }) }).click();
  // The picked contact shows as a chip with a remove button once it is created.
  await expect(form.getByRole("button", { name: exact(L, "pipeline.form.contactClear") })).toBeVisible();
  await expect(form.getByText(contactName, { exact: true })).toBeVisible();
  await form.locator("#new-deal-value").fill("25000");
  await form.getByRole("button", { name: exact(L, "pipeline.form.create") }).click();
  await expect(form).toBeHidden();
  await expect
    .poll(async () => {
      const { data } = await admin().from("deals").select("contact_id").eq("user_id", account.id).maybeSingle();
      return Boolean(data?.contact_id);
    }, { message: "the new deal is saved with its contact" })
    .toBe(true);

  const { data: stages } = await admin()
    .from("pipeline_stages")
    .select("id, name, position, is_won, is_lost")
    .eq("user_id", account.id)
    .order("position");
  const path = stages!.filter((stage) => !stage.is_lost);
  const card = page.getByRole("button", { name: t("pipeline.card.open", { title }) });
  await expect(page.getByRole("region", { name: path[0]!.name }).getByText(title)).toBeVisible();

  for (const stage of path.slice(1)) {
    const column = page.getByRole("region", { name: stage.name, exact: true });
    if (stage.is_won) await smallWins.stop();
    await drag(page, card, column);
    if (stage.is_won) {
      const celebration = page.getByRole("dialog", { name: t("pipeline.celebration.title") });
      await expect(celebration).toBeVisible();
      const titles = await closeAllCelebrations(page, L);
      expect(titles[0]).toBe(t("pipeline.celebration.title"));
    }
    await expect(column.getByText(title)).toBeVisible();
    await expect
      .poll(async () => {
        const { data } = await admin().from("deals").select("stage_id").eq("user_id", account.id).single();
        return data?.stage_id;
      })
      .toBe(stage.id);
  }
  console.log(`Small celebrations on the way: ${smallWins.seen.join(", ") || "none"}`);
  expect(surveyAsked, "the meeting survey was offered").toBe(true);

  // The contact is a client now.
  const { data: won } = await admin()
    .from("deals")
    .select("contact_id, won_at")
    .eq("user_id", account.id)
    .single();
  expect(won?.contact_id, "the deal kept its contact").toBeTruthy();
  expect(won?.won_at).toBeTruthy();
  const { data: clientsTable } = await admin()
    .from("contact_tables")
    .select("id, name")
    .eq("user_id", account.id)
    .eq("system_key", "clients")
    .single();
  const { data: entry } = await admin()
    .from("contact_table_entries")
    .select("table_id")
    .eq("user_id", account.id)
    .eq("contact_id", won!.contact_id!)
    .single();
  expect(entry?.table_id).toBe(clientsTable!.id);
  const clients = clientsTable!.name;
  await openApp(page, "/app/kontakty");
  await page
    .getByRole("group", { name: t("contacts.tables.label") })
    .getByRole("button", { name: new RegExp(clients) })
    .click();
  await expect(page.locator("main").getByText(contactName).first()).toBeVisible();

  // And the win booked its income.
  const { data: income } = await admin()
    .from("transactions")
    .select("type, amount, source, description")
    .eq("user_id", account.id);
  expect(income).toContainEqual(
    expect.objectContaining({ type: "income", source: "deal_invoice", description: title }),
  );
  await openApp(page, "/app/finance");
  await expect(page.locator("main").getByText(title).first()).toBeVisible();
});
