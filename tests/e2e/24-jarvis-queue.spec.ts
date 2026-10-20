import { admin, signIn, type Account } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text, within } from "./support/i18n";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);
const position = (current: number, total: number) => t("jarvis.queue.position", { current, total });

// Jarvis's button bobs; with reduced motion it holds still, so the click is not retried forever.
test.use({ reducedMotion: "reduce" });

/**
 * Three insights of Jarvis, written the way the watch writes them (server
 * side, admin client), newest first: A, B, C. None of them is about a call,
 * so the time window does not hold them back.
 */
async function seedNotices(account: Account) {
  const now = Date.now();
  const rows = ["A", "B", "C"].map((name, index) => ({
    user_id: account.id,
    kind: "suggestion",
    type: "insight",
    text: `E2E notice ${name}`,
    action: { kind: "ask", prompt: `E2E prompt ${name}` },
    payload: { people: false },
    dedupe_key: `e2e-queue:${name}`,
    created_at: new Date(now - (index + 1) * 60_000).toISOString(),
  }));
  const { data, error } = await admin().from("jarvis_suggestions").insert(rows).select("id, text");
  if (error) throw error;
  const id = (name: string) => data.find((row) => row.text === `E2E notice ${name}`)!.id;
  return { A: id("A"), B: id("B"), C: id("C") };
}

async function stateOf(id: string) {
  const { data, error } = await admin()
    .from("jarvis_suggestions")
    .select("shown_at, dismissed_at")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

test("24 · Jarvis's panel shows one notice at a time; skipped ones stay queued", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "jarvis-queue" });
  const ids = await seedNotices(account);
  await signIn(page, account);

  // The button's name also counts the unseen notices once they have loaded.
  await page.getByRole("button", { name: within(L, "jarvis.open") }).click();
  const panel = page.getByRole("dialog", { name: t("jarvis.title") });
  const noticed = panel.getByTestId("jarvis-noticed");

  // Three notices → one card.
  await expect(noticed.getByRole("listitem")).toHaveCount(1);
  await expect(noticed).toContainText("E2E notice A");
  await expect(noticed.getByTestId("notice-position")).toHaveText(position(1, 3));
  // The chat input stays clear of the card.
  const input = panel.getByRole("textbox", { name: t("jarvis.inputLabel") });
  const [card, field] = await Promise.all([noticed.boundingBox(), input.boundingBox()]);
  expect(card!.y + card!.height).toBeLessThanOrEqual(field!.y);

  // Close it → the second one.
  await noticed.getByRole("button", { name: exact(L, "jarvis.suggestion.dismiss") }).click();
  await expect(noticed).toContainText("E2E notice B");
  await expect(noticed.getByTestId("notice-position")).toHaveText(position(1, 2));

  // Skip forward, then back with the arrow key: B was skipped, not closed.
  await noticed.getByRole("button", { name: exact(L, "jarvis.queue.next") }).click();
  await expect(noticed).toContainText("E2E notice C");
  await expect(noticed.getByTestId("notice-position")).toHaveText(position(2, 2));
  await noticed.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(noticed).toContainText("E2E notice B");
  await expect(noticed.getByTestId("notice-position")).toHaveText(position(1, 2));

  await expect.poll(async () => (await stateOf(ids.A)).dismissed_at).not.toBeNull();
  expect((await stateOf(ids.B)).dismissed_at).toBeNull();
  expect((await stateOf(ids.C)).dismissed_at).toBeNull();
});

test("24 · Jarvis flies in with one card for three notices", async ({ page, accounts }) => {
  // Waits for the 30 s a page has to settle before Jarvis speaks up.
  test.setTimeout(180_000);
  const account = await accounts.create({ label: "jarvis-bubble" });
  const settings = await admin()
    .from("user_settings")
    .update({
      jarvis_proactive: true,
      jarvis_frequency: "often",
      jarvis_quiet_from: null,
      jarvis_quiet_to: null,
    })
    .eq("user_id", account.id);
  if (settings.error) throw settings.error;
  const ids = await seedNotices(account);
  await signIn(page, account);

  const bubble = page.getByTestId("jarvis-proactive");
  await expect(bubble).toBeVisible({ timeout: 90_000 });
  await expect(bubble).toHaveCount(1);
  await expect(bubble).toContainText("E2E notice A");
  await expect(bubble.getByTestId("notice-position")).toHaveText(position(1, 3));

  // Skip A, close B → C takes its place.
  await bubble.getByRole("button", { name: exact(L, "jarvis.queue.next") }).click();
  await expect(bubble).toContainText("E2E notice B");
  await expect(bubble.getByTestId("notice-position")).toHaveText(position(2, 3));
  await bubble.getByRole("button", { name: exact(L, "jarvis.proactive.close") }).click();
  await expect(bubble).toContainText("E2E notice C");
  await expect(bubble.getByTestId("notice-position")).toHaveText(position(2, 2));

  // Back with the arrow key: A was skipped, not closed.
  await bubble.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(bubble).toContainText("E2E notice A");
  await expect(bubble.getByTestId("notice-position")).toHaveText(position(1, 2));

  await expect.poll(async () => (await stateOf(ids.B)).dismissed_at).not.toBeNull();
  const first = await stateOf(ids.A);
  expect(first.dismissed_at).toBeNull();
  // Each one counts as shown once it was on screen.
  expect(first.shown_at).not.toBeNull();
  await expect.poll(async () => (await stateOf(ids.C)).shown_at).not.toBeNull();
  expect((await stateOf(ids.C)).dismissed_at).toBeNull();
});
