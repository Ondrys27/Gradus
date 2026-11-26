import { admin, signIn, skipCompanyTutorial, userClient, type Account } from "./support/accounts";
import { expect, test, watchConsole } from "./support/fixtures";
import { text } from "./support/i18n";
import { openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

test.use({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });

/** Tomorrow at a Prague wall-clock hour, as an instant (winter: UTC+1, summer: UTC+2). */
function tomorrowAt(hour: number): string {
  const day = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "Europe/Prague",
  });
  const probe = new Date(`${day}T12:00:00Z`);
  const offset =
    Number(
      probe.toLocaleString("en-US", {
        timeZone: "Europe/Prague",
        hour: "2-digit",
        hourCycle: "h23",
      }),
    ) - 12;
  return new Date(
    Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`) - offset * 3_600_000,
  ).toISOString();
}

/** The calendar on tomorrow, one day at a time. */
async function showTomorrow(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: t("calendar.views.day"), exact: true }).click();
  await page.getByRole("button", { name: t("calendar.nav.today") }).click();
  await page.getByRole("button", { name: t("calendar.nav.next.day") }).click();
}

async function hire(owner: Account, person: Account, name: string) {
  const db = admin();
  const { data: worker, error } = await db
    .from("workers")
    .insert({ owner_id: owner.id, user_id: person.id, name, email: person.email, status: "active" })
    .select("id")
    .single();
  if (error) throw error;
  const granted = await db.from("worker_permission_grants").insert(
    ["view", "create", "update"].map((action) => ({
      owner_id: owner.id,
      worker_id: worker.id,
      section: "calendar",
      action,
      allowed: true,
    })),
  );
  if (granted.error) throw granted.error;
  await skipCompanyTutorial(person.id, owner.id);
}

/**
 * 30.3 in two browsers, two people of one company who see only their own
 * events: Hana asks Váša for his calendar → he allows busy → she sees only
 * hatched "Busy" blocks → she asks for write, he allows → she sees his
 * meeting and writes a new one into his calendar ("Into the calendar of:
 * Váša") → his private event stays "Busy" on her screen and is hidden from
 * her through the API too (the table and the function).
 */
test("74 · calendar sharing: request → busy → write → event in his calendar; private stays hidden", async ({
  page,
  browser,
  accounts,
  consoleErrors,
}) => {
  const owner = await accounts.create({ label: "cal-share-owner" });
  const hana = await accounts.create({ label: "cal-share-hana" });
  const vasa = await accounts.create({ label: "cal-share-vasa" });
  await hire(owner, hana, "E2E Hana");
  await hire(owner, vasa, "E2E Váša");
  const db = admin();
  const { data: events, error: eventsError } = await db
    .from("calendar_events")
    .insert([
      {
        user_id: owner.id,
        actor_id: vasa.id,
        calendar_owner_id: vasa.id,
        title: "E2E Schůzka s klientem",
        kind: "meeting",
        starts_at: tomorrowAt(10),
        ends_at: tomorrowAt(11),
        // A multi-row insert sends missing keys as null, not the default.
        private: false,
      },
      {
        user_id: owner.id,
        actor_id: vasa.id,
        calendar_owner_id: vasa.id,
        title: "E2E Lékař",
        kind: "meeting",
        starts_at: tomorrowAt(14),
        ends_at: tomorrowAt(15),
        private: true,
      },
    ])
    .select("id, title");
  if (eventsError) throw eventsError;
  const secretId = events!.find((event) => event.title === "E2E Lékař")!.id;

  // Hana asks for busy times.
  await signIn(page, hana);
  await openApp(page, "/app/kalendar");
  await page.getByTestId("calendars-panel-request").click();
  await page.getByTestId("calendar-request-person").click();
  await page.getByRole("option", { name: "E2E Váša", exact: true }).click();
  await page.getByTestId("calendar-request-level-busy").check();
  await page.getByTestId("calendar-request-send").click();
  await expect(
    page.getByText(t("calendar.sharing.request.sent", { name: "E2E Váša" })),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Váša hears it in the bell and allows it.
  const vasaContext = await browser.newContext({
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    viewport: { width: 1440, height: 900 },
  });
  watchConsole(vasaContext, consoleErrors);
  const vasaPage = await vasaContext.newPage();
  try {
    await signIn(vasaPage, vasa);
    await expect(vasaPage.getByTestId("inbox-count")).toBeVisible();
    await vasaPage.getByTestId("inbox-bell").click();
    await vasaPage
      .locator('[data-testid="inbox-notification"][data-kind="calendar_share_requested"]')
      .first()
      .click();
    await expect(vasaPage.getByTestId("calendar-answer")).toContainText("E2E Hana");
    await vasaPage.getByTestId("calendar-answer-allow").click();
    await expect(vasaPage.getByTestId("calendar-answer")).toHaveCount(0);

    // Hana sees only blocks: no titles, two "Busy".
    await page.reload();
    await expect(
      page.getByTestId("calendars-panel-person").filter({ hasText: "E2E Váša" }),
    ).toBeVisible();
    await showTomorrow(page);
    await expect(page.getByText(t("calendar.sharing.busy"), { exact: true })).toHaveCount(2);
    await expect(page.getByText("E2E Schůzka s klientem")).toHaveCount(0);
    await expect(page.getByText("E2E Lékař")).toHaveCount(0);

    // She asks for write; Váša allows it.
    await page.getByTestId("calendars-panel-request").click();
    await page.getByTestId("calendar-request-person").click();
    await page.getByRole("option", { name: "E2E Váša", exact: true }).click();
    await page.getByTestId("calendar-request-level-write").check();
    await page.getByTestId("calendar-request-send").click();
    await expect(
      page.getByText(t("calendar.sharing.request.sent", { name: "E2E Váša" })),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const { data: second } = await db
      .from("calendar_share_requests")
      .select("id")
      .eq("user_id", hana.id)
      .eq("to_user_id", vasa.id)
      .eq("status", "pending")
      .single();
    await openApp(vasaPage, `/app/kalendar?shareRequest=${second!.id}`);
    await vasaPage.getByTestId("calendar-answer-allow").click();
    await expect(vasaPage.getByTestId("calendar-answer")).toHaveCount(0);

    // Now his meeting reads in full; the private one is still only busy.
    await page.reload();
    await showTomorrow(page);
    await expect(page.getByText("E2E Schůzka s klientem")).toBeVisible();
    await expect(page.getByText(t("calendar.sharing.busy"), { exact: true })).toHaveCount(1);
    await expect(page.getByText("E2E Lékař")).toHaveCount(0);

    // She writes into his calendar.
    await page
      .getByRole("button", { name: t("calendar.actions.add") })
      .first()
      .click();
    const form = page.getByRole("dialog");
    await form.getByTestId("event-owner").click();
    await page.getByRole("option", { name: "E2E Váša", exact: true }).click();
    await form.getByLabel(t("calendar.form.title")).fill("E2E Porada od Hany");
    await form.getByRole("button", { name: t("calendar.form.create") }).click();
    await expect(form).toHaveCount(0);
    await expect
      .poll(async () => {
        const { data } = await db
          .from("calendar_events")
          .select("calendar_owner_id, actor_id, user_id")
          .eq("title", "E2E Porada od Hany")
          .maybeSingle();
        return data;
      })
      .toEqual({ calendar_owner_id: vasa.id, actor_id: hana.id, user_id: owner.id });

    // Váša has it in his calendar, made by Hana.
    await openApp(vasaPage, "/app/kalendar");
    await showTomorrow(vasaPage);
    await vasaPage.getByText("E2E Porada od Hany").first().click();
    await expect(vasaPage.getByTestId("event-owner-line")).toContainText("E2E Hana");
  } finally {
    await vasaContext.close();
  }

  // Through the API the private event never reaches Hana.
  const client = await userClient(hana.email, hana.password);
  try {
    const direct = await client.from("calendar_events").select("id, title").eq("id", secretId);
    expect(direct.error).toBeNull();
    expect(direct.data).toEqual([]);
    const shared = await client.rpc("calendar_shared_events", {
      _space: owner.id,
      _from: new Date(Date.now() - 86_400_000).toISOString(),
      _to: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });
    expect(shared.error).toBeNull();
    const row = (shared.data ?? []).find((entry) => entry.id === secretId);
    expect(row).toMatchObject({ busy_only: true, title: null, location: null, description: null });
  } finally {
    await client.auth.signOut();
  }
  expect(consoleErrors).toEqual([]);
});
