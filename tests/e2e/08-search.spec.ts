import { seedContacts, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { text } from "./support/i18n";

const L = "cs" as const;
const t = (key: string) => text(L, key);

test("8 · ⌘K search finds a contact without diacritics and by part of its phone", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "search" });
  const [contact] = await seedContacts(account, [
    { company_name: "E2E Žluťoučký kůň s.r.o.", first_name: "Šimon", phone: "+420602555818" },
    { company_name: "E2E Jiná firma", phone: "+420731000111" },
  ]);
  await signIn(page, account);

  const palette = page.getByRole("dialog", { name: t("search.dialog.title") });
  const input = palette.getByRole("combobox", { name: t("search.dialog.title") });
  const results = palette.getByRole("listbox", { name: t("search.dialog.results") });
  const found = results.getByRole("option", { name: /E2E Žluťoučký kůň/ });

  // Ctrl+K (⌘K on a Mac) from anywhere in the app.
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette).toBeVisible();

  await input.fill("zlutoucky kun");
  await expect(found).toBeVisible();
  await expect(results.getByRole("option", { name: /E2E Jiná firma/ })).toHaveCount(0);

  await input.fill("555 81");
  await expect(found).toBeVisible();
  await expect(results.getByRole("option", { name: /E2E Jiná firma/ })).toHaveCount(0);

  // Choosing it opens the contact.
  await found.click();
  await expect(page).toHaveURL(new RegExp(`/app/kontakty/${contact!.id}`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E Žluťoučký kůň");
});
