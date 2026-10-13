import { admin, signIn } from "./support/accounts";
import { env } from "./support/env";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";

const L = "cs" as const;
const t = (key: string) => text(L, key);

// Jarvis's button bobs; with reduced motion it holds still, so the click is not retried forever.
test.use({ reducedMotion: "reduce" });

test("10 · Jarvis answers a message", async ({ page, accounts }) => {
  test.skip(!env("ANTHROPIC_API_KEY"), "ANTHROPIC_API_KEY is not set");
  const account = await accounts.create({ label: "jarvis" });
  await signIn(page, account);

  await page.getByRole("button", { name: exact(L, "jarvis.open") }).click();
  const panel = page.getByRole("dialog", { name: t("jarvis.title") });
  await expect(panel).toBeVisible();
  await panel.getByRole("textbox", { name: t("jarvis.inputLabel") }).fill("Odpověz jedním slovem: jak se řekne anglicky „ahoj“?");
  await panel.getByRole("button", { name: exact(L, "jarvis.send") }).click();

  // A finished answer gets its thumbs; no error on the way.
  await expect(panel.getByRole("button", { name: t("jarvis.rate.up") }).first()).toBeVisible({ timeout: 90_000 });
  await expect(panel.getByRole("alert")).toHaveCount(0);
  const answer = panel.locator(".border-teal.whitespace-pre-wrap").last();
  await expect(answer).not.toHaveText("");

  // Measured in the call itself.
  await expect
    .poll(async () => {
      const { count } = await admin()
        .from("ai_usage")
        .select("id", { count: "exact", head: true })
        .eq("user_id", account.id);
      return count ?? 0;
    })
    .toBeGreaterThan(0);
});
