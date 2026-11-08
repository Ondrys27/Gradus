import { admin, seedContacts, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { text } from "./support/i18n";
import { openApp, waitForApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

/**
 * 22.4: one account, two companies. An owner of their own company works in
 * another one too → lands in that company (the default, as before), sees
 * only its contacts → switches to "Moje firma" in the same section, sees only
 * their own → a company they are not in, by its address or through the
 * switch, is 404 → a link into the other company switches back there.
 */
test("48 · one account, two companies: switch, the data stay apart, a foreign company by URL is 404", async ({
  page,
  accounts,
}) => {
  const boss = await accounts.create({ label: "space-boss" });
  const person = await accounts.create({ label: "space-person" });
  const stranger = await accounts.create({ label: "space-stranger" });
  const db = admin();

  await seedContacts(boss, [{ company_name: "E2E Klient firmy B" }]);
  await seedContacts(person, [{ company_name: "E2E Klient vlastní firmy" }]);
  await seedContacts(stranger, [{ company_name: "E2E Klient cizí firmy" }]);
  const named = await db.from("profiles").update({ company_name: "E2E Firma B" }).eq("id", boss.id);
  if (named.error) throw named.error;

  // The person works for the boss with the contacts right.
  const { data: worker, error: workerError } = await db
    .from("workers")
    .insert({ owner_id: boss.id, user_id: person.id, name: "E2E Osoba", status: "active" })
    .select("id")
    .single();
  if (workerError) throw workerError;
  const granted = await db.from("worker_permission_grants").insert({
    owner_id: boss.id,
    worker_id: worker.id,
    section: "contacts",
    action: "view",
    allowed: true,
  });
  if (granted.error) throw granted.error;

  await signIn(page, person);
  const current = page.getByTestId("space-current");
  const main = page.locator("main");

  // The first company is where an account with one lands, as before 22.4.
  await openApp(page, "/app/kontakty");
  await expect(current).toHaveText("E2E Firma B");
  await expect(page.getByTestId("space-stripe")).toBeAttached();
  await expect(main.getByText("E2E Klient firmy B").first()).toBeVisible();
  await expect(main.getByText("E2E Klient vlastní firmy")).toHaveCount(0);

  // Switch to the own company: the same section, only the own contacts.
  await page.getByTestId("space-switcher").click();
  await page.getByRole("menuitem", { name: new RegExp(t("spaces.mine")) }).click();
  await expect(current).toHaveText(t("spaces.mine"));
  await waitForApp(page);
  await expect(page).toHaveURL(/\/app\/kontakty$/);
  await expect(page.getByTestId("space-stripe")).toHaveCount(0);
  await expect(main.getByText("E2E Klient vlastní firmy").first()).toBeVisible();
  await expect(main.getByText("E2E Klient firmy B")).toHaveCount(0);

  // A company the account is not in: 404 by its address and through the switch.
  const link = await page.request.get(`/app/prostor/${stranger.id}`, { maxRedirects: 0 });
  expect(link.status()).toBe(404);
  const api = await page.request.post("/api/space", { data: { space: stranger.id } });
  expect(api.status()).toBe(404);
  await openApp(page, "/app/kontakty");
  await expect(current).toHaveText(t("spaces.mine"));
  await expect(main.getByText("E2E Klient cizí firmy")).toHaveCount(0);

  // A link into the other company switches there and opens the dashboard.
  await page.goto(`/app/prostor/${boss.id}`);
  await expect(page).toHaveURL(/\/app$/);
  await waitForApp(page);
  await expect(current).toHaveText("E2E Firma B");
  await openApp(page, "/app/kontakty");
  await expect(main.getByText("E2E Klient firmy B").first()).toBeVisible();
  await expect(main.getByText("E2E Klient vlastní firmy")).toHaveCount(0);

  // The short id is in Settings → Account, in either company.
  await openApp(page, "/app/nastaveni/ucet");
  await expect(page.getByTestId("public-id")).toHaveText(/^[2-9A-HJKMNP-TV-Z]{6}$/);
});
