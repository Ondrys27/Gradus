import { expect, type Locator } from "@playwright/test";

/**
 * The meeting dialog of 30.4 (Cold Calling, a contact, a deal): for an
 * account without a scheduler the one step of working hours first (the
 * default Monday–Friday 9–17), then the first free time of the day the
 * picker opens on, held for the dialog. Returns the start (ms).
 */
export async function pickFirstMeetingTime(dialog: Locator): Promise<number> {
  const setup = dialog.getByTestId("meeting-quick-setup");
  const picker = dialog.getByTestId("slot-picker");
  await expect(setup.or(picker)).toBeVisible({ timeout: 20_000 });
  if (await setup.isVisible()) await dialog.getByTestId("meeting-setup-save").click();
  const time = picker.getByTestId("booking-time").first();
  await expect(time).toBeVisible({ timeout: 20_000 });
  const start = (await time.getAttribute("data-start")) ?? "";
  await time.click();
  await expect(dialog.getByTestId("meeting-held")).toHaveAttribute("data-start", start, {
    timeout: 15_000,
  });
  return Number(start);
}
