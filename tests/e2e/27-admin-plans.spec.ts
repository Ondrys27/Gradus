import type { Locator, Page } from "@playwright/test";
import type { PlanCatalog } from "../../src/config/pricing";
import type { Json } from "../../src/types/database";
import { admin, type Account } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { totp } from "./support/totp";

/**
 * Plans in the administration (step 15.5): the owner changes Solo's monthly
 * CZK price in the draft and saves it; the website still shows the old price.
 * Publishing (after the confirmation lists 490 → 491) changes the website;
 * bringing back the previous version from the history puts the old price
 * back. The catalog in force before the test is published again if anything
 * fails, and a draft the real owner had is put back as it was.
 */

const L = "cs";

async function signInToAdmin(page: Page, account: Account) {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000";
  await page.context().addCookies([{ name: "locale", value: L, url: baseURL }]);
  await page.goto("/admin/prihlaseni");
  await page.locator("#admin-email").fill(account.email);
  await page.locator("#admin-password").fill(account.password);
  await page.getByRole("button", { name: exact(L, "admin.login.submit") }).click();
  await expect(page.getByText(text(L, "admin.login.secretLabel"))).toBeVisible();
  const secret = (await page.locator("code").first().textContent())?.trim() ?? "";
  await page.locator("#admin-code").fill(totp(secret));
  await page.getByRole("button", { name: exact(L, "admin.login.enrollSubmit") }).click();
  const skip = page.getByRole("button", { name: exact(L, "admin.login.backupSkip") });
  const nav = page.getByRole("link", { name: exact(L, "admin.shell.nav.plans") }).first();
  // The backup offer stays until it is skipped, then the sign-in goes on.
  await skip.click();
  await expect(nav).toBeVisible();
}

/** The Solo card on the Czech pricing page, read fresh. */
async function soloCardOnWeb(page: Page, name: string): Promise<Locator> {
  await page.goto("/cenik");
  return page.locator("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
}

test("27 · a price change waits in the draft, shows on the website once published and goes back", async ({
  page,
  browser,
  accounts,
}) => {
  const db = admin();
  const owner = await accounts.create({ label: "plansowner" });
  const { error: roleError } = await db.from("user_roles").insert({ user_id: owner.id, role: "owner" });
  if (roleError) throw roleError;

  const read = async () => {
    const { data, error } = await db
      .from("plan_catalog_versions")
      .select("id, status, payload")
      .in("status", ["published", "draft"]);
    if (error) throw error;
    return {
      published: data.find((row) => row.status === "published")!,
      draft: data.find((row) => row.status === "draft") ?? null,
    };
  };
  const before = await read();
  const catalog = before.published.payload as PlanCatalog;
  const solo = catalog.find((plan) => plan.key === "solo")!;
  const oldPrice = solo.monthly.CZK;
  const newPrice = oldPrice + 1;
  const soloName = solo.name.cs;
  const price = (value: number) => new RegExp(`(^|\\D)${value}\\s?Kč`);

  // The website in another context, without the admin session.
  const visitor = await (await browser.newContext()).newPage();

  try {
    await signInToAdmin(page, owner);
    await page.goto("/admin/tarify");
    const editor = page.getByTestId("plans-editor");
    await expect(editor).toBeVisible();
    const actions = page.getByTestId("plans-actions");

    // A start from the published version, not from somebody's draft.
    if (before.draft) {
      await actions.getByRole("button", { name: exact(L, "admin.plans.actions.discard") }).click();
      await page
        .getByRole("dialog", { name: exact(L, "admin.plans.discardConfirm.title") })
        .getByRole("button", { name: exact(L, "admin.plans.discardConfirm.confirm") })
        .click();
      await expect(actions.getByRole("status")).toHaveText(exact(L, "admin.plans.notices.discarded"));
    }

    // 1. The draft: a new price, saved, nothing published.
    await page.locator("#plan-solo-monthly-CZK").fill(String(newPrice));
    await actions.getByRole("button", { name: exact(L, "admin.plans.actions.save") }).click();
    await expect(actions.getByRole("status")).toHaveText(exact(L, "admin.plans.notices.saved"));
    expect((await read()).published.id).toBe(before.published.id);

    let card = await soloCardOnWeb(visitor, soloName);
    await expect(card).toContainText(price(oldPrice));
    await expect(card).not.toContainText(price(newPrice));

    // 2. Publishing: the confirmation lists the change, then the website follows.
    await actions.getByRole("button", { name: exact(L, "admin.plans.actions.publish") }).click();
    const confirm = page.getByRole("dialog", { name: exact(L, "admin.plans.publishConfirm.title") });
    await expect(confirm.getByTestId("plan-changes")).toContainText(`${oldPrice} → ${newPrice}`);
    await confirm.getByRole("button", { name: exact(L, "admin.plans.publishConfirm.confirm") }).click();
    await expect(confirm).toBeHidden();
    await expect(actions.getByRole("status")).toHaveText(exact(L, "admin.plans.notices.published"));
    const afterPublish = await read();
    expect(afterPublish.published.id).not.toBe(before.published.id);
    expect(afterPublish.draft).toBeNull();

    card = await soloCardOnWeb(visitor, soloName);
    await expect(card).toContainText(price(newPrice));

    // 3. Bringing back the previous version publishes a copy of it.
    await page.reload();
    const previous = page.getByTestId("plan-version").nth(1);
    await previous.getByRole("button", { name: exact(L, "admin.plans.history.restore") }).click();
    const restore = page.getByRole("dialog").filter({ has: page.getByTestId("plan-changes") });
    await expect(restore.getByTestId("plan-changes")).toContainText(`${newPrice} → ${oldPrice}`);
    await restore
      .getByRole("button", { name: exact(L, "admin.plans.restoreConfirm.confirm") })
      .click();
    await expect(page.getByText(text(L, "admin.plans.notices.restored"))).toBeVisible();
    const restored = await read();
    expect(restored.published.id).not.toBe(afterPublish.published.id);
    expect(restored.published.payload).toEqual(before.published.payload);

    card = await soloCardOnWeb(visitor, soloName);
    await expect(card).toContainText(price(oldPrice));
    await expect(card).not.toContainText(price(newPrice));

    const { data: audit, error: auditError } = await db
      .from("admin_audit")
      .select("detail")
      .eq("user_id", owner.id)
      .eq("target", "settings.plans")
      .order("id");
    if (auditError) throw auditError;
    expect(audit.map((row) => (row.detail as { action: string }).action)).toEqual([
      "publish",
      "restore",
    ]);
  } finally {
    await visitor.context().close();
    const now = await read();
    // Anything left half-way: the catalog in force before the test goes back up.
    if (JSON.stringify(now.published.payload) !== JSON.stringify(before.published.payload)) {
      const archived = await db
        .from("plan_catalog_versions")
        .update({ status: "archived" })
        .eq("id", now.published.id);
      if (archived.error) throw archived.error;
      const republished = await db.from("plan_catalog_versions").insert({
        status: "published",
        published_at: new Date().toISOString(),
        payload: before.published.payload as Json,
      });
      if (republished.error) throw republished.error;
    }
    // The real owner's draft, if there was one, as it was; otherwise none.
    if (before.draft) {
      const draft = now.draft
        ? await db
            .from("plan_catalog_versions")
            .update({ payload: before.draft.payload as Json })
            .eq("id", now.draft.id)
        : await db
            .from("plan_catalog_versions")
            .insert({ status: "draft", payload: before.draft.payload as Json });
      if (draft.error) throw draft.error;
    } else if (now.draft) {
      const removed = await db.from("plan_catalog_versions").delete().eq("id", now.draft.id);
      if (removed.error) throw removed.error;
    }
  }
});
