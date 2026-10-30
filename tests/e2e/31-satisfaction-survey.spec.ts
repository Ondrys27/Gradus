import { admin, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";

/**
 * The satisfaction survey on the dashboard: shown after 14 days of use, a
 * close hides it until tomorrow, the third close in a row for a month, and an
 * answer is stored with its two texts. The task ring shows only a percentage.
 */

const L = "cs";
const DAY = 24 * 60 * 60 * 1000;

test.use({ reducedMotion: "reduce" });

test("31 · satisfaction survey: close, pause, answer", async ({ page, accounts }) => {
  const account = await accounts.create({ label: "satisfaction" });
  const db = admin();
  const profile = () =>
    db
      .from("profiles")
      .select("nps_snoozed_until, nps_dismiss_streak")
      .eq("id", account.id)
      .single()
      .then(({ data, error }) => {
        if (error) throw error;
        return data;
      });

  await signIn(page, account);
  const card = page.getByRole("region", { name: exact(L, "dashboard.satisfaction.title") });

  // A fresh account is not asked yet.
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(card).toHaveCount(0);

  // Fifteen days of use: the card is there; a close hides it until the next midnight.
  await db
    .from("profiles")
    .update({ created_at: new Date(Date.now() - 15 * DAY).toISOString() })
    .eq("id", account.id);
  await page.reload();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: exact(L, "dashboard.satisfaction.close") }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(async () => (await profile()).nps_dismiss_streak).toBe(1);
  const snoozed = new Date((await profile()).nps_snoozed_until ?? 0).getTime();
  expect(snoozed).toBeGreaterThan(Date.now());
  expect(snoozed - Date.now()).toBeLessThanOrEqual(DAY);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(card).toHaveCount(0);

  // The third close in a row pauses it for thirty days.
  await db
    .from("profiles")
    .update({ nps_snoozed_until: null, nps_dismiss_streak: 2 })
    .eq("id", account.id);
  await page.reload();
  await card.getByRole("button", { name: exact(L, "dashboard.satisfaction.close") }).click();
  await expect.poll(async () => (await profile()).nps_dismiss_streak).toBe(0);
  const paused = new Date((await profile()).nps_snoozed_until ?? 0).getTime() - Date.now();
  expect(paused).toBeGreaterThan(29 * DAY);

  // An answer: 4 and both texts; then it is quiet for a month.
  await db.from("profiles").update({ nps_snoozed_until: null }).eq("id", account.id);
  await page.reload();
  const send = card.getByRole("button", { name: exact(L, "dashboard.satisfaction.submit") });
  await expect(send).toBeDisabled();
  await card.getByRole("radio", { name: exact(L, "dashboard.satisfaction.scoreLabel", { score: 4 }) }).click();
  await card.getByLabel(text(L, "dashboard.satisfaction.liked")).fill("Mapa milníků");
  await card.getByLabel(text(L, "dashboard.satisfaction.improve")).fill("Rychlejší kalendář");
  await send.click();
  await expect(page.getByRole("status").filter({ hasText: text(L, "dashboard.satisfaction.thanks") })).toBeVisible();
  await expect
    .poll(async () => {
      const { data } = await db
        .from("satisfaction_responses")
        .select("satisfaction, liked, improve")
        .eq("user_id", account.id);
      return data;
    })
    .toEqual([{ satisfaction: 4, liked: "Mapa milníků", improve: "Rychlejší kalendář" }]);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(card).toHaveCount(0);
});

test("31 · the task ring shows only the percentage", async ({ page, accounts }) => {
  const account = await accounts.create({ label: "task-ring" });
  const db = admin();
  const { data: milestone, error } = await db
    .from("milestones")
    .insert({ user_id: account.id, title: "Ring" })
    .select("id")
    .single();
  if (error) throw error;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(new Date());
  const tasks = await db.from("tasks").insert([
    {
      user_id: account.id,
      milestone_id: milestone.id,
      title: "Open today",
      due_date: today,
      status: "todo",
      completed_at: null,
    },
    {
      user_id: account.id,
      milestone_id: milestone.id,
      title: "Done today",
      due_date: today,
      status: "done",
      completed_at: new Date().toISOString(),
    },
  ]);
  if (tasks.error) throw tasks.error;

  await signIn(page, account);
  await page.goto("/app");
  const ring = page.getByRole("progressbar", {
    name: exact(L, "dashboard.tiles.tasks.ring", { done: 1, total: 2 }),
  });
  await expect(ring).toBeVisible();
  await expect(ring).toContainText("50");
  await expect(ring).not.toContainText("/");
});
