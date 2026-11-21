import type { Page } from "@playwright/test";
import { admin, type Account } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { totp } from "./support/totp";
import { openApp } from "./support/ui";

/**
 * Grady's model per job in the administration (step 27.3): a throw-away
 * full admin puts the chat on Haiku, confirms, and the next chat message
 * (the e2e echo stand-in, which goes through the same model choice) is in
 * ai_usage on Haiku; then the Economy preset puts every job on its minimum.
 * The settings in force before the test are put back afterwards, so real
 * users feel at most a few seconds of the change.
 */

const L = "cs";
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);
const E2E_MODEL_HEADER = "x-gradus-e2e-model";

// Grady's button bobs; with reduced motion it holds still, so the click is not retried forever.
test.use({ reducedMotion: "reduce" });

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
  await page.getByRole("button", { name: exact(L, "admin.login.backupSkip") }).click();
  await expect(page.getByRole("link", { name: exact(L, "admin.shell.nav.ai") })).toBeVisible();
}

async function saveModels(page: Page) {
  const form = page.getByTestId("grady-models-form");
  await form.getByRole("button", { name: exact(L, "admin.ai.models.save") }).click();
  const dialog = page.getByRole("dialog", { name: exact(L, "admin.ai.models.confirmTitle") });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: exact(L, "admin.ai.models.confirm") }).click();
  await expect(dialog).toBeHidden();
  await expect(form.getByRole("status")).toHaveText(exact(L, "admin.ai.models.saved"));
  return dialog;
}

type Stored = { features: Record<string, string>; economy: boolean; chat_large: string | null };

test("63 · the chat on Haiku answers on Haiku, and the Economy preset puts every job on its minimum", async ({
  page,
  accounts,
}) => {
  const db = admin();
  const boss = await accounts.create({ label: "models-admin" });
  const { error: roleError } = await db
    .from("user_roles")
    .insert({ user_id: boss.id, role: "admin", level: "full" });
  if (roleError) throw roleError;

  const { data: before, error: readError } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "grady_models")
    .maybeSingle();
  if (readError) throw readError;
  const saved = async () => {
    const { data } = await db.from("app_settings").select("value").eq("key", "grady_models").single();
    return data?.value as Stored;
  };

  try {
    await signInToAdmin(page, boss);
    await page.goto("/admin/ai?tab=models");
    const form = page.getByTestId("grady-models-form");
    await expect(form).toBeVisible();
    await expect(page.getByTestId("models-prices")).toContainText("claude-haiku-5-5");

    // The chat on Haiku: confirmed, saved, audited.
    const chat = form.getByLabel(
      exact(L, "admin.ai.models.modelFor", { feature: t("admin.ai.models.features.chat.name") }),
    );
    await chat.selectOption("haiku");
    await form.getByRole("button", { name: exact(L, "admin.ai.models.save") }).click();
    const dialog = page.getByRole("dialog", { name: exact(L, "admin.ai.models.confirmTitle") });
    await expect(dialog.getByTestId("models-changes")).toContainText("Claude Haiku 5.5");
    await dialog.getByRole("button", { name: exact(L, "admin.ai.models.confirm") }).click();
    await expect(form.getByRole("status")).toHaveText(exact(L, "admin.ai.models.saved"));
    expect((await saved()).features.chat).toBe("haiku");
    const { data: audit } = await db
      .from("admin_audit")
      .select("kind, detail")
      .eq("user_id", boss.id)
      .eq("target", "settings.grady_models")
      .order("id", { ascending: false })
      .limit(1)
      .single();
    expect(audit?.kind).toBe("update");
    expect((audit?.detail as { to: Stored }).to.features.chat).toBe("haiku");

    // The next chat message runs on Haiku (the echo stand-in goes through the same choice).
    await openApp(page, "/app");
    await page.route("**/api/grady", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.continue({
        headers: { ...route.request().headers(), [E2E_MODEL_HEADER]: "echo-notes" },
      });
    });
    await page.getByRole("button", { name: exact(L, "grady.open") }).click();
    const panel = page.getByRole("dialog", { name: t("grady.title") });
    await panel.getByRole("textbox", { name: t("grady.inputLabel") }).fill("Udělej mi rozbor obchodů");
    await panel.getByRole("button", { name: exact(L, "grady.send") }).click();
    await expect(panel.locator(".border-teal.whitespace-pre-wrap").last()).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(async () => {
        const { data } = await db
          .from("ai_usage")
          .select("model, routed_from")
          .eq("user_id", boss.id)
          .eq("purpose", "chat")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return data;
      })
      .toEqual({ model: "claude-haiku-5-5", routed_from: null });

    // The Economy preset: every job on its minimum (Haiku wherever it may).
    await page.goto("/admin/ai?tab=models");
    const economy = page.getByTestId("models-preset-economy");
    await economy.click();
    await expect(economy).toHaveAttribute("aria-pressed", "true");
    await saveModels(page);
    const after = await saved();
    expect(after.features.chat).toBe("haiku");
    expect(after.features.briefing).toBe("haiku");
    expect(after.features.milestone_review).toBe("haiku");
    expect(after.features.analysis).toBe("sonnet");
    expect(after.features.reward_setup).toBe("sonnet");
    expect(after.chat_large).toBeNull();
  } finally {
    // Put the settings in force before the test back (none = the defaults again).
    const restore = before
      ? await db.from("app_settings").update({ value: before.value }).eq("key", "grady_models")
      : await db.from("app_settings").delete().eq("key", "grady_models");
    if (restore.error) throw restore.error;
  }
});
