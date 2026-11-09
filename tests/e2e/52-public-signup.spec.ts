import { admin, e2eEmail, e2ePassword, findUserByEmail } from "./support/accounts";
import { publicSignupEnabled } from "./support/env";
import { expect, test } from "./support/fixtures";
import { text } from "./support/i18n";
import { openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);
const PLAN_PATH = "/app/nastaveni/predplatne";

/**
 * 52 · public sign-up (step 23.3): a visitor registers without a code, with a
 * plan picked on the pricing cards. The consent is required; the account
 * starts the 14-day trial of Pro and Settings → Subscription shows the picked
 * plan as the one to pay after the trial. The dev server's
 * PUBLIC_SIGNUP_ENABLED stays as it is: outside production the header below
 * turns public sign-up on for the tests' own accounts only.
 */
test.use({
  extraHTTPHeaders: { "accept-language": "cs-CZ,cs;q=0.9", "x-gradus-e2e-signup": "public" },
});

test("52 · public sign-up without a code → consent → 14-day trial → picked plan in Subscription", async ({
  page,
  accounts,
}) => {
  test.setTimeout(180_000);

  // The pricing cards link to the registration with their plan (only when the site has public sign-up).
  if (publicSignupEnabled) {
    await page.goto("/cenik");
    await expect(page.locator("a[data-plan='team']").first()).toHaveAttribute(
      "href",
      /\/registrace\?tarif=team&obdobi=(mesic|rok)$/,
    );
  }

  const email = e2eEmail("public-signup");
  accounts.register(email);
  await page.goto("/registrace?tarif=team&obdobi=rok");
  await expect(page.getByText(t("auth.register.descriptionPublic"))).toBeVisible();
  await expect(page.locator("#register-invite")).not.toHaveAttribute("required", "");
  await expect(page.getByTestId("register-chosen-plan")).toContainText(t("plans.billing.yearly"));

  await page.locator("#register-name").fill("E2E Veřejná registrace");
  await page.locator("#register-email").fill(email);
  await page.locator("#register-password").fill(e2ePassword());

  // Without the consent nothing is created.
  await page.locator("form button[type=submit]").click();
  await expect(page.getByText(t("auth.errors.termsRequired"))).toBeVisible();
  await expect(page).toHaveURL(/\/registrace/);
  expect(await findUserByEmail(email)).toBeNull();

  await page.getByTestId("register-terms").click();
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 60_000 });

  const user = await findUserByEmail(email);
  expect(user).not.toBeNull();
  const db = admin();
  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("terms_accepted_at, terms_version, marketing_consent_at")
    .eq("id", user!.id)
    .single();
  if (profileError) throw profileError;
  expect(profile.terms_accepted_at).not.toBeNull();
  expect(profile.terms_version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(profile.marketing_consent_at).toBeNull();

  const { data: sub, error: subError } = await db
    .from("subscriptions")
    .select("plan_key, status, trial_ends_at, chosen_plan_key, chosen_billing")
    .eq("user_id", user!.id)
    .single();
  if (subError) throw subError;
  expect(sub).toMatchObject({ plan_key: "pro", status: "trialing", chosen_plan_key: "team", chosen_billing: "yearly" });
  const days = (Date.parse(sub.trial_ends_at!) - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(13.9);
  expect(days).toBeLessThanOrEqual(14.01);

  const { data: events } = await db
    .from("analytics_events")
    .select("props")
    .eq("user_id", user!.id)
    .eq("event", "signup_completed");
  expect(events?.map((row) => row.props)).toEqual([
    { from: "pricing", method: "trial", plan: "team", billing: "yearly", marketing_consent: false },
  ]);

  // Past the wizard (the onboarding tests cover it), straight to Settings → Subscription.
  const now = new Date().toISOString();
  await db
    .from("profiles")
    .update({ onboarding_completed_at: now, tour_completed_at: now, notes_intro_seen_at: now })
    .eq("id", user!.id);
  await db.from("user_settings").update({ jarvis_proactive: false }).eq("user_id", user!.id);
  await openApp(page, PLAN_PATH);
  await expect(page.getByTestId("subscription-status")).toContainText(t("subscription.status.trialing", { date: "" }).trim());
  const chosen = page.getByTestId("subscription-chosen");
  await expect(chosen).toBeVisible();
  await expect(chosen).toContainText(t("plans.billing.yearly"));
  await expect(chosen).toContainText(t("subscription.chosen.trial", { plan: "", billing: "", date: "" }).split(":")[0]);
});
