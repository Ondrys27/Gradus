import { extractText, getDocumentProxy } from "unpdf";
import { admin, signIn, userClient } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { dismissCelebrationsAutomatically, openApp } from "./support/ui";

/**
 * 16.3: the supplier guide → an invoice issued from a deal → its PDF exists
 * and carries the number and the amount → marked paid → the income is in
 * Finance. Then the numbering series under real concurrency: drafts issued
 * at the same moment get consecutive numbers, none twice, none skipped.
 */

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);
const spaces = (value: string) => value.replace(/[\s  ]+/g, " ");

test("30 · supplier guide → invoice from a deal → PDF → paid → income in Finance", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "invoices", mode: "game" });
  await signIn(page, account);
  await dismissCelebrationsAutomatically(page, L);

  const db = admin();
  const { data: contact } = await db
    .from("contacts")
    .insert({ user_id: account.id, company_name: "E2E Pekárna Novák", email: "pekarna@gradus.local", city: "Brno" })
    .select("id")
    .single();
  const { data: stage } = await db
    .from("pipeline_stages")
    .select("id")
    .eq("user_id", account.id)
    .eq("system_key", "offer")
    .single();
  const { data: deal } = await db
    .from("deals")
    .insert({ user_id: account.id, contact_id: contact!.id, stage_id: stage!.id, title: "E2E Web pro pekárnu", value: 24000 })
    .select("id")
    .single();

  // The deal's button makes a prefilled draft and opens the invoice form.
  await openApp(page, `/app/pipeline?deal=${deal!.id}`);
  await page.getByRole("button", { name: exact(L, "pipeline.detail.createInvoice") }).click();
  await page.waitForURL(/\/app\/finance\/faktury\/[0-9a-f-]{36}$/);

  // No supplier yet: the guide comes first.
  const guide = page.getByRole("dialog", { name: t("invoices.setup.title") });
  await expect(guide).toBeVisible();
  await guide.locator("#invoice-profile-name").fill("E2E Jana Dvořáková");
  await guide.locator("#invoice-profile-ico").fill("25596641");
  await guide.locator("#invoice-profile-street").fill("Křižíkova 148/34");
  await guide.locator("#invoice-profile-city").fill("Praha 8");
  await guide.locator("#invoice-profile-psc").fill("186 00");
  await guide.locator("#invoice-profile-account").fill("19-2000145399");
  await guide.locator("#invoice-profile-bank").fill("0800");
  await guide.getByRole("button", { name: exact(L, "invoices.setup.submit") }).click();
  await expect(guide).toBeHidden();

  // The form has the deal's contact and one item of its value.
  await expect(page.locator("#invoice-customer-name")).toHaveValue("E2E Pekárna Novák");
  await expect(page.getByRole("img", { name: t("invoices.editor.previewLabel") })).toBeVisible();
  await page.getByRole("button", { name: exact(L, "invoices.editor.issue") }).click();
  const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog", { name: t("invoices.editor.issueTitle") }));
  await confirm.getByRole("button", { name: exact(L, "invoices.editor.issueConfirm") }).click();

  const year = new Date().getFullYear();
  const number = `${year}-0001`;
  await expect(page.getByRole("heading", { name: t("invoices.detail.title", { number }) })).toBeVisible();
  const invoiceId = page.url().split("/").pop()!;

  // The PDF: made on first download, then stored; it reads the number and the amount.
  const link = await page.request.get(`/api/invoices/${invoiceId}/pdf`);
  expect(link.ok()).toBe(true);
  const { url } = (await link.json()) as { url: string };
  const file = await page.request.get(url);
  expect(file.ok()).toBe(true);
  const bytes = new Uint8Array(await file.body());
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  const { text: pdfText } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
  expect(pdfText).toContain(number);
  expect(spaces(pdfText)).toContain("24 000,00 Kč");
  expect(pdfText).not.toMatch(/gradus/i);
  const { data: stored } = await db.from("invoices").select("pdf_path, status").eq("id", invoiceId).single();
  expect(stored).toEqual({ pdf_path: `${account.id}/${invoiceId}.pdf`, status: "open" });

  // Paid today: the income is booked once and shows in Finance.
  await page.getByRole("button", { name: exact(L, "invoices.detail.markPaid") }).click();
  await expect(page.getByText(exact(L, "invoices.list.status.paid")).first()).toBeVisible();
  await expect
    .poll(async () => {
      const { data } = await db
        .from("transactions")
        .select("amount, type, source")
        .eq("user_id", account.id)
        .eq("invoice_id", invoiceId);
      return data;
    })
    .toEqual([{ amount: 24000, type: "income", source: "invoice" }]);
  await openApp(page, "/app/finance");
  await expect(page.getByText(new RegExp(number)).first()).toBeVisible();
});

test("30 · drafts issued at the same moment get consecutive numbers", async ({ accounts }) => {
  const account = await accounts.create({ label: "invoice-series" });
  const client = await userClient(account.email, account.password);
  const { error: profileError } = await client
    .from("invoice_profiles")
    .insert({ user_id: account.id, name: "E2E Series" });
  expect(profileError).toBeNull();

  const drafts = await Promise.all(
    Array.from({ length: 6 }, async (_, index) => {
      const { data, error } = await client
        .from("invoices")
        .insert({
          user_id: account.id,
          number: null,
          amount: 0,
          customer: { name: `E2E Customer ${index}` },
          items: [{ id: `i${index}`, name: "Work", quantity: 1, unit: "h", unit_price: 1000 + index, vat_rate: 0 }],
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    }),
  );
  // Each issue is its own request and transaction, all at once.
  const issued = await Promise.all(
    drafts.map(async (id) => {
      const { data, error } = await client.rpc("issue_invoice", { _invoice_id: id });
      if (error) throw error;
      return data.number;
    }),
  );
  const year = new Date().getFullYear();
  expect([...issued].sort()).toEqual(
    Array.from({ length: 6 }, (_, index) => `${year}-${String(index + 1).padStart(4, "0")}`),
  );
});
