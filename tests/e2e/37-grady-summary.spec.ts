import type { Page } from "@playwright/test";
import { admin, signIn, type Account } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string) => text(L, key);

/** The summary's stand-in model (src/features/grady/server/e2e-model.ts): a fixed line, no Anthropic. */
const E2E_MODEL_HEADER = "x-gradus-e2e-model";
const E2E_ECHO_SUMMARY = "echo-summary";
const E2E_SUMMARY_TEXT = "E2E summary";

// Grady bobs; with reduced motion he holds still, so a click is not retried forever.
test.use({ reducedMotion: "reduce" });

/** Today in Prague, as the database keeps last_daily_brief_on. */
function pragueDay(offsetDays = 0) {
  const at = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(at);
}

async function profileOf(account: Account) {
  const { data, error } = await admin()
    .from("profiles")
    .select("last_daily_brief_on")
    .eq("id", account.id)
    .single();
  if (error) throw error;
  return data;
}

async function frequencyOf(account: Account) {
  const { data, error } = await admin()
    .from("user_settings")
    .select("jarvis_frequency")
    .eq("user_id", account.id)
    .single();
  if (error) throw error;
  return data.jarvis_frequency;
}

/** Signs out by dropping the session, then in again through the form, like a new visit. */
async function signInAgain(page: Page, account: Account) {
  await page.context().clearCookies();
  await signIn(page, account);
}

test("37 · Grady's summary comes at the first arrival of the day, and only then", async ({
  page,
  accounts,
}) => {
  test.setTimeout(120_000);
  const account = await accounts.create({ label: "grady-summary" });
  // Onboarded two days ago (a new account has its welcome first), Grady on,
  // and today's summary already settled, so the first visit only sets the frequency.
  const prepared = await Promise.all([
    admin()
      .from("profiles")
      .update({
        onboarding_completed_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        last_daily_brief_on: pragueDay(),
      })
      .eq("id", account.id),
    admin()
      .from("user_settings")
      .update({
        jarvis_proactive: true,
        jarvis_frequency: "every_6h",
        jarvis_quiet_from: null,
        jarvis_quiet_to: null,
      })
      .eq("user_id", account.id),
    // Something to say today: an event right now.
    admin().from("calendar_events").insert({
      user_id: account.id,
      title: "E2E schůzka",
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    }),
  ]);
  for (const result of prepared) if (result.error) throw result.error;

  // Only the summary's model call is answered by the stand-in.
  await page.route(
    (url) => url.pathname === "/api/grady" && url.searchParams.get("view") === "summary",
    (route) =>
      route.continue({
        headers: { ...route.request().headers(), [E2E_MODEL_HEADER]: E2E_ECHO_SUMMARY },
      }),
  );
  const summary = page.getByTestId("grady-summary");

  // Settings → Grady: once a day.
  await signIn(page, account);
  await openApp(page, "/app/nastaveni/grady");
  await page.getByRole("radio", { name: exact(L, "settings.grady.frequencies.daily") }).click();
  await expect.poll(() => frequencyOf(account)).toBe("daily");

  // A new day: the next arrival brings the summary, worked out now.
  const settle = await admin()
    .from("profiles")
    .update({ last_daily_brief_on: pragueDay(-1) })
    .eq("id", account.id);
  if (settle.error) throw settle.error;
  await signInAgain(page, account);
  await expect(summary).toBeVisible({ timeout: 20_000 });
  await expect(summary).toContainText(t("grady.summary.heading.day"));
  await expect(summary).toContainText(`${E2E_SUMMARY_TEXT}: Write today's brief.`);
  await expect(summary.getByRole("button", { name: /Dnešní události/ })).toBeVisible();
  // On screen = settled for today.
  await expect.poll(async () => (await profileOf(account)).last_daily_brief_on).toBe(pragueDay());
  await summary.getByRole("button", { name: exact(L, "grady.summary.thanks") }).click();
  await expect(summary).toBeHidden();

  // The second arrival the same day: nothing.
  await signInAgain(page, account);
  await page.waitForTimeout(6_000);
  await expect(summary).toHaveCount(0);
});
