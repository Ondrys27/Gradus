import { admin, e2eEmail, e2ePassword, findUserByEmail } from "./support/accounts";
import { env } from "./support/env";
import { expect, test } from "./support/fixtures";
import { exact, text, type Locale } from "./support/i18n";
import { finishTour, mainNav, openApp } from "./support/ui";

const journeys: { title: string; locale: Locale; mode: "game" | "tool"; industry: string }[] = [
  { title: "2 · invite → game onboarding → Jarvis tour → dashboard", locale: "cs", mode: "game", industry: "realEstate" },
  { title: "3 · invite → tool onboarding in English → Jarvis tour → dashboard", locale: "en", mode: "tool", industry: "coaching" },
];

for (const journey of journeys) {
  test.describe(journey.title, () => {
    test.use({
      locale: journey.locale === "en" ? "en-GB" : "cs-CZ",
      extraHTTPHeaders: { "accept-language": journey.locale === "en" ? "en-GB,en;q=0.9" : "cs-CZ,cs;q=0.9" },
    });

    test("registers with the invite code and finishes onboarding and the tour", async ({
      page,
      accounts,
    }) => {
      const inviteCode = env("INVITE_CODE");
      test.skip(!inviteCode, "INVITE_CODE is not set");
      const { locale, mode, industry } = journey;
      const t = (key: string, values?: Record<string, string | number>) => text(locale, key, values);
      const email = e2eEmail(`register-${mode}`);
      accounts.register(email);

      await page.goto(locale === "en" ? "/en/register" : "/registrace");
      await page.locator("#register-invite").fill(inviteCode!);
      await page.locator("#register-name").fill(`E2E ${mode}`);
      await page.locator("#register-email").fill(email);
      await page.locator("#register-password").fill(e2ePassword());
      await page.locator("form button[type=submit]").click();
      await expect(page).toHaveURL(/\/app$/, { timeout: 60_000 });

      // The wizard.
      const wizard = page.getByRole("dialog", { name: t("onboarding.title") });
      await expect(wizard).toBeVisible();
      await wizard.getByRole("button", { name: exact(locale, "onboarding.actions.start") }).click();
      await wizard.getByRole("radio", { name: new RegExp(t(`onboarding.mode.${mode}.title`)) }).click();
      await wizard.getByRole("radio", { name: t(`onboarding.industry.industries.${industry}.label`) }).click();
      await wizard.getByRole("button", { name: exact(locale, "onboarding.actions.next") }).click();
      if (mode === "game") {
        // The path for the branch is preselected.
        await expect(wizard.getByRole("radio", { checked: true })).toBeVisible();
        await wizard.getByRole("button", { name: exact(locale, "onboarding.actions.next") }).click();
      }
      // Region.
      await expect(wizard.locator("#onboarding-country")).toBeVisible();
      await wizard.getByRole("button", { name: exact(locale, "onboarding.actions.next") }).click();
      if (mode === "tool") {
        await expect(wizard.locator("#onboarding-milestone-title")).toHaveValue(
          t(`onboarding.industry.industries.${industry}.milestoneTitle`),
        );
        await wizard.getByRole("button", { name: exact(locale, "onboarding.actions.next") }).click();
      }
      // First contact.
      await wizard.locator("#onboarding-contact-company").fill("E2E První kontakt");
      await wizard.getByRole("button", { name: exact(locale, "onboarding.actions.addContact") }).click();
      // Closing.
      await wizard.getByRole("button", { name: exact(locale, "onboarding.actions.finish") }).click();
      await expect(wizard).toBeHidden();

      if (mode === "game") {
        const celebration = page.getByRole("dialog", {
          name: t("game.celebration.onboardingCompleted.title"),
        });
        await expect(celebration).toBeVisible();
        await celebration.getByRole("button", { name: exact(locale, "celebration.continue") }).click();
        await expect(celebration).toBeHidden();
      }

      await finishTour(page, locale);
      await expect(page).toHaveURL(/\/app(\/|$)/);

      // What the account has now.
      const user = await findUserByEmail(email);
      expect(user).not.toBeNull();
      const db = admin();
      const { data: profile } = await db
        .from("profiles")
        .select("mode, industry, path_key, onboarding_completed_at, tour_completed_at, is_internal")
        .eq("id", user!.id)
        .single();
      expect(profile).toMatchObject({ mode, industry, is_internal: true });
      expect(profile?.onboarding_completed_at).not.toBeNull();
      await expect
        .poll(async () => {
          const { data } = await db.from("profiles").select("tour_completed_at").eq("id", user!.id).single();
          return data?.tour_completed_at ?? null;
        })
        .not.toBeNull();
      if (mode === "game") expect(profile?.path_key).toBeTruthy();
      const { count: milestones } = await db
        .from("milestones")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id);
      expect(milestones ?? 0).toBeGreaterThan(0);
      const { data: settings } = await db.from("user_settings").select("locale").eq("user_id", user!.id).single();
      expect(settings?.locale).toBe(locale);

      // The dashboard itself.
      await openApp(page, "/app");
      await expect(page.locator("h1.page-title")).toBeVisible();
      await expect(mainNav(page, locale)).toBeVisible();
    });
  });
}
