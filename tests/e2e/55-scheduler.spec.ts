import { signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { dismissCelebrationsAutomatically, openApp } from "./support/ui";

/**
 * 24.3: the scheduler's first open gives three meeting types and working
 * hours; the guide sets the handle and the video link; Saturday morning is
 * added to the hours; a new type is created and its link is the public one.
 * Booking through the link is 24.4.
 */

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

test("55 · scheduler: presets, guide, hours, a new type and its link", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "scheduler", mode: "tool" });
  await signIn(page, account);
  await dismissCelebrationsAutomatically(page, L);
  await openApp(page, "/app/planovac");

  // First open: three presets and the guide.
  await expect(page.getByTestId("event-type-card")).toHaveCount(3, { timeout: 20_000 });
  for (const preset of ["intro", "consultation", "meeting"]) {
    await expect(
      page.getByRole("button", { name: exact(L, `scheduler.presets.${preset}`) }),
    ).toBeVisible();
  }
  const guide = page.getByTestId("scheduler-setup");
  await expect(guide).toBeVisible();
  const handle = `e2e-${Date.now().toString(36)}`;
  await guide.getByLabel(exact(L, "scheduler.setup.handle")).fill(handle);
  await guide.getByLabel(exact(L, "scheduler.setup.video")).fill("https://meet.jit.si/gradus-e2e");
  await guide.getByRole("button", { name: exact(L, "scheduler.setup.done") }).click();
  await expect(guide).toHaveCount(0);
  await expect(page.getByTestId("scheduler-link")).toContainText(`/s/${handle}`);

  // Availability: Saturday 9:00–12:00 on top of Monday to Friday.
  await page.getByRole("tab", { name: exact(L, "scheduler.tabs.availability") }).click();
  const saturday = new Intl.DateTimeFormat("cs", { weekday: "long" }).format(
    new Date(2026, 10, 21),
  );
  await page.getByRole("switch", { name: t("scheduler.hours.dayOpen", { day: saturday }) }).click();
  await page.getByLabel(t("scheduler.hours.from", { day: saturday })).fill("09:00");
  await page.getByLabel(t("scheduler.hours.to", { day: saturday })).fill("12:00");
  await page.getByRole("button", { name: exact(L, "scheduler.availability.saveWeek") }).click();
  await expect(page.getByText(t("scheduler.availability.saved"))).toBeVisible();

  // A new meeting type.
  await page.getByRole("tab", { name: exact(L, "scheduler.tabs.types") }).click();
  await page
    .getByRole("button", { name: exact(L, "scheduler.newType") })
    .first()
    .click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel(exact(L, "scheduler.editor.name")).fill("Prohlídka webu");
  await expect(editor.getByLabel(exact(L, "scheduler.editor.slug"))).toHaveValue("prohlidka-webu");
  await editor.getByRole("button", { name: exact(L, "scheduler.editor.create") }).click();
  await expect(editor.getByText(t("scheduler.editor.saved"))).toBeVisible();

  // Its preview offers times (or says why not) and the public link is its own.
  await editor.getByRole("tab", { name: exact(L, "scheduler.editor.tabs.preview") }).click();
  await expect(
    editor
      .getByText(t("scheduler.editor.previewEmpty"))
      .or(editor.getByText(new RegExp(t("scheduler.editor.previewHint", { zone: ".+" })))),
  ).toBeVisible({ timeout: 20_000 });
  await editor
    .getByRole("button", { name: exact(L, "scheduler.editor.close") })
    .last()
    .click();
  await expect(page.getByTestId("event-type-card")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Prohlídka webu" })).toBeVisible();
});
