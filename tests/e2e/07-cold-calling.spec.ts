import { admin, seedContacts, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { dismissCelebrationsAutomatically, openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

/** "Dnes 0:00:07" → 7. */
function secondsOf(label: string | null) {
  const match = label?.match(/(\d+):(\d{2}):(\d{2})/);
  if (!match) throw new Error(`No stopwatch in "${label}"`);
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

test("7 · cold calling: start and pause the timer, move out of Unreached, the chart shows today", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "calling" });
  await seedContacts(account, [
    { company_name: "E2E Truhlářství Dub", phone: "+420777111222" },
    { company_name: "E2E Zámečnictví Klíč", phone: "+420777333444" },
  ]);
  await signIn(page, account);
  await dismissCelebrationsAutomatically(page, L);

  await openApp(page, "/app/cold-calling");
  const list = page.getByRole("list").filter({ hasText: "E2E Truhlářství Dub" });
  await expect(list.getByText("E2E Zámečnictví Klíč")).toBeVisible();

  // Start: the stopwatch runs.
  const timer = page
    .locator("div")
    .filter({ has: page.getByRole("heading", { name: t("coldCalling.timer.title") }) })
    .filter({ has: page.locator('p[aria-label^="Dnes "]') })
    .last();
  const readout = timer.locator('p[aria-label^="Dnes "]');
  await timer.getByRole("button", { name: exact(L, "coldCalling.timer.start") }).click();
  await expect(timer.getByText(t("coldCalling.timer.running"))).toBeVisible();
  await expect.poll(async () => secondsOf(await readout.getAttribute("aria-label")), { timeout: 15_000 }).toBeGreaterThanOrEqual(3);

  // A contact out of Unreached.
  await list.getByRole("button", { name: /E2E Truhlářství Dub/ }).click();
  const panel = page.getByRole("dialog", { name: t("coldCalling.panel.title") });
  await panel.getByRole("button", { name: exact(L, "coldCalling.panel.move") }).click();
  const { data: noAnswer } = await admin()
    .from("contact_tables")
    .select("id, name")
    .eq("user_id", account.id)
    .eq("system_key", "no_answer")
    .single();
  const move = page.getByRole("dialog", { name: t("contacts.move.title") });
  await move.getByRole("button", { name: noAnswer!.name }).click();
  await move.getByRole("button", { name: t("contacts.move.confirm", { name: noAnswer!.name }) }).click();
  await expect(move).toBeHidden();
  await expect(page.getByText(t("coldCalling.list.moved", { name: noAnswer!.name }))).toBeVisible();
  await expect(list.getByText("E2E Truhlářství Dub")).toHaveCount(0);
  // The next contact opens by itself; close it to get back to the timer.
  await expect(panel.getByText("E2E Zámečnictví Klíč")).toBeVisible();
  await panel.getByRole("button", { name: exact(L, "coldCalling.panel.close") }).click();
  await expect(panel).toBeHidden();

  // Pause: the stopwatch stops and stays.
  await timer.getByRole("button", { name: exact(L, "coldCalling.timer.pause") }).click();
  await expect(timer.getByText(t("coldCalling.timer.paused"))).toBeVisible();
  const stopped = secondsOf(await readout.getAttribute("aria-label"));
  await page.waitForTimeout(2_000);
  expect(secondsOf(await readout.getAttribute("aria-label"))).toBe(stopped);

  const { data: segments } = await admin()
    .from("prospecting_segments")
    .select("started_at, ended_at")
    .eq("user_id", account.id);
  expect(segments).toHaveLength(1);
  expect(segments![0]!.ended_at).not.toBeNull();
  const { data: entry } = await admin()
    .from("contact_table_entries")
    .select("table_id, contacts!inner(company_name)")
    .eq("user_id", account.id)
    .eq("contacts.company_name", "E2E Truhlářství Dub")
    .single();
  expect(entry?.table_id).toBe(noAnswer!.id);

  // The time chart has today's column, labelled Today.
  const chart = page.getByRole("region", { name: t("coldCalling.stats.timeTitle") });
  await expect(chart.locator("svg text", { hasText: t("coldCalling.stats.today") })).toBeVisible();
  await expect(chart.locator("table tr")).not.toHaveCount(0);
});
