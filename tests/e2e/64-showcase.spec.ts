import { admin, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact } from "./support/i18n";
import { openApp } from "./support/ui";

/**
 * 27.4: the showcase. A regular account does not have it (404, no card in
 * the tutorial). The app's admin (a test account outside production needs
 * no switch) starts scenario a from /app/ukazka: it plays in its own stage
 * account to the end card without a failed step, in Czech and in English,
 * and afterwards the stage is gone with every sample row it had.
 */

const L = "cs" as const;

const SAMPLE_TABLES = [
  "contacts",
  "deals",
  "milestones",
  "tasks",
  "crm_tasks",
  "calendar_events",
  "notes",
] as const;

async function leftovers(userId: string) {
  const db = admin();
  let total = 0;
  for (const table of SAMPLE_TABLES) {
    const { count, error } = await db
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) throw error;
    total += count ?? 0;
  }
  return total;
}

/** The stage account a presenter's showcase plays in (marked by the server in app_metadata). */
async function stageOf(presenterId: string): Promise<string> {
  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await admin().auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find(
      (user) =>
        user.email?.startsWith("showcase-") &&
        !user.email.includes("-team@") &&
        user.app_metadata?.showcase_by === presenterId,
    );
    if (found) return found.id;
    if (data.users.length < 1000) break;
  }
  throw new Error("No stage account was made");
}

test("64 · a regular account has no showcase: 404 and no card in the tutorial", async ({
  page,
  accounts,
  consoleErrors,
}) => {
  const account = await accounts.create({ label: "showcase-none" });
  await signIn(page, account);
  const response = await page.goto("/app/ukazka?scenar=a");
  expect(response?.status()).toBe(404);
  const refused = await page.request.post("/api/showcase/stage", { data: { scenar: "a" } });
  expect(refused.status()).toBe(404);
  // The 404 page and the refused start are the point; the browser reports exactly those.
  consoleErrors.splice(
    0,
    consoleErrors.length,
    ...consoleErrors.filter((error) => !/status of 404/.test(error)),
  );

  await openApp(page, "/app/nastaveni/grady");
  await page.getByRole("button", { name: exact(L, "settings.help.start") }).click();
  const choice = page.getByTestId("tutorial-choice");
  await expect(choice).toBeVisible();
  await expect(choice.locator('[data-tutorial-choice="showcase"]')).toHaveCount(0);
});

for (const locale of ["cs", "en"] as const) {
  test(`64 · scenario a plays to the end in ${locale} and leaves no sample data`, async ({
    page,
    accounts,
  }) => {
    test.setTimeout(300_000);
    const presenter = await accounts.create({ label: `showcase-${locale}` });
    const role = await admin()
      .from("user_roles")
      .insert({ user_id: presenter.id, role: "admin", level: "full" });
    if (role.error) throw role.error;
    await signIn(page, presenter);

    // The tutorial offers it to the app's admin.
    await openApp(page, "/app/nastaveni/grady");
    await page.getByRole("button", { name: exact(L, "settings.help.start") }).click();
    await page.getByTestId("tutorial-choice").locator('[data-tutorial-choice="showcase"]').click();
    await expect(page).toHaveURL(/\/app\/ukazka$/);

    await page.goto(`/app/ukazka?scenar=a&jazyk=${locale}&velikost=1920x1080`);
    const made = page.waitForResponse(
      (response) => response.url().endsWith("/api/showcase/stage") && response.request().method() === "POST",
      { timeout: 90_000 },
    );
    await page.getByRole("button", { name: exact(L, "showcase.start") }).click();
    expect((await made).status()).toBe(200);
    // The page moves on at once; the stage is found by who made it.
    const stage = await stageOf(presenter.id);

    // The stage plays in the scenario's language, then the end card; data deleted.
    await expect(page.locator("html")).toHaveAttribute("lang", locale, { timeout: 60_000 });
    await expect(page.locator("html")).toHaveAttribute("data-showcase-state", /playing|paused/, {
      timeout: 60_000,
    });
    await expect(page.locator("[data-showcase-caption]")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("html")).toHaveAttribute("data-showcase-state", /outro|ended|failed/, {
      timeout: 240_000,
    });
    const recording = await page.evaluate(() => window.__gradusShowcase ?? null);
    expect(recording?.error ?? null, "every step played").toBeNull();
    expect(recording?.cues.length).toBeGreaterThanOrEqual(4);
    await expect(page.locator("[data-showcase-outro]")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-showcase-state", "ended", {
      timeout: 60_000,
    });

    const { data: gone } = await admin().auth.admin.getUserById(stage);
    expect(gone?.user ?? null, "the stage account is deleted").toBeNull();
    expect(await leftovers(stage)).toBe(0);
  });
}
