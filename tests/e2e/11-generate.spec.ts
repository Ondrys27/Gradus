import { admin, signIn } from "./support/accounts";
import { env } from "./support/env";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { dismissCelebrationsAutomatically, openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string) => text(L, key);

test("11 · contacts are generated from Google Maps into Unreached", async ({ page, accounts }) => {
  test.skip(!env("GOOGLE_MAPS_API_KEY"), "GOOGLE_MAPS_API_KEY is not set");
  const account = await accounts.create({ label: "generate" });
  await signIn(page, account);
  await dismissCelebrationsAutomatically(page, L);

  await openApp(page, "/app/kontakty");
  await page.getByRole("button", { name: exact(L, "contacts.actions.generate") }).first().click();
  const dialog = page.getByRole("dialog", { name: t("contacts.generate.title") });
  await dialog.locator("#generate-industry").fill("kavárna");
  await dialog.locator("#generate-location").fill("Olomouc");
  await dialog.locator("#generate-count").fill("3");
  await dialog.getByRole("button", { name: exact(L, "contacts.generate.submit") }).click();

  // Done: either new contacts in Unreached, or nothing new; never an error from Google.
  await expect(dialog.getByText(/v Neoslovených\.|Nic nového/).first()).toBeVisible({ timeout: 90_000 });
  await expect(dialog.getByText(/Google píše/)).toHaveCount(0);

  const db = admin();
  const { data: contacts } = await db
    .from("contacts")
    .select("id, external_place_id")
    .eq("user_id", account.id);
  expect(contacts!.length).toBeGreaterThan(0);
  expect(contacts!.length).toBeLessThanOrEqual(3);
  expect(contacts!.every((contact) => contact.external_place_id)).toBe(true);
  // Every Google request is logged on the server (events.ts: places_request).
  const { data: requests } = await db
    .from("analytics_events")
    .select("props")
    .eq("owner_id", account.id)
    .eq("event", "places_request");
  expect(requests!.length).toBeGreaterThan(0);
  console.log(`Google requests: ${JSON.stringify(requests!.map((row) => row.props))}`);
  console.log(`Outcome: ${await dialog.locator("[role=status], p").allInnerTexts()}`);

  await dialog.getByRole("button", { name: exact(L, "contacts.generate.done.show") }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("main li").filter({ visible: true }).first()).toBeVisible();
});
