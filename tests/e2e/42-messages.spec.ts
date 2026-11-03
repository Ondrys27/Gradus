import { admin, signIn } from "./support/accounts";
import { expect, test, watchConsole } from "./support/fixtures";
import { text } from "./support/i18n";
import { mainNav, openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

test.use({ reducedMotion: "reduce" });

/**
 * 19.4 in two browsers, the owner and a worker: a direct message with an
 * @mention, the unread badge, a message that arrives without a reload, the
 * read receipt, and a group conversation that appears once the worker is
 * added to the group.
 */
test("42 · messages: direct message with a mention → badge → live → read → group conversation", async ({
  page,
  browser,
  accounts,
  consoleErrors,
}) => {
  const owner = await accounts.create({ label: "chat-owner" });
  const person = await accounts.create({ label: "chat-worker" });
  const db = admin();
  const { data: worker, error } = await db
    .from("workers")
    .insert({
      owner_id: owner.id,
      user_id: person.id,
      name: "E2E Kolega",
      email: person.email,
      status: "active",
    })
    .select("id")
    .single();
  if (error) throw error;

  // The owner writes to the worker, mentioning them.
  await signIn(page, owner);
  await openApp(page, "/app/zpravy");
  await page.locator(`[data-testid="chat-person"][data-member="${worker.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`to=${worker.id}`));
  const input = page.getByTestId("chat-input");
  await input.click();
  await page.keyboard.type("Ahoj @E2E");
  await expect(page.getByTestId("chat-mention-menu")).toContainText("E2E Kolega");
  await page.keyboard.press("Enter");
  await page.keyboard.type("jak to jde?");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid="chat-message"][data-own="true"]')).toContainText(
    "Ahoj @E2E Kolega jak to jde?",
  );
  await expect
    .poll(async () => {
      const { data } = await db.from("chat_messages").select("body").eq("owner_id", owner.id);
      return (data ?? []).map((row) => row.body);
    })
    .toEqual([`Ahoj <@${worker.id}> jak to jde?`]);
  // The first message made the conversation: the address follows it.
  await expect(page).toHaveURL(/[?&]c=/);

  const workerContext = await browser.newContext({ locale: "cs-CZ", timezoneId: "Europe/Prague" });
  watchConsole(workerContext, consoleErrors);
  const workerPage = await workerContext.newPage();
  try {
    await signIn(workerPage, person);
    const nav = mainNav(workerPage, L);
    const badge = nav.getByRole("link", { name: t("nav.messages") }).getByTestId("nav-unread-badge");
    await expect(badge).toHaveText("1");

    // A second message arrives without a reload.
    await page.getByTestId("chat-input").click();
    await page.keyboard.type("Druhá zpráva");
    await page.keyboard.press("Enter");
    await expect(badge).toHaveText("2");

    // The worker reads it: the mention is theirs, the badge goes.
    await nav.getByRole("link", { name: t("nav.messages") }).click();
    await workerPage.locator('[data-testid="chat-channel"][data-kind="direct"]').first().click();
    const conversation = workerPage.getByTestId("chat-conversation");
    await expect(conversation.getByText("Druhá zpráva")).toBeVisible();
    await expect(conversation.locator('[data-testid="chat-mention"][data-me="true"]')).toHaveText(
      "@E2E Kolega",
    );
    await expect(badge).toHaveCount(0);

    // The owner sees it read, without a reload.
    await expect(
      page.locator('[data-testid="chat-message"][data-own="true"]').last().getByTestId("chat-read"),
    ).toBeVisible();

    // And the next one arrives in the open conversation live.
    await page.getByTestId("chat-input").click();
    await page.keyboard.type("Třetí, naživo");
    await page.keyboard.press("Enter");
    await expect(conversation.getByText("Třetí, naživo")).toBeVisible();

    // A group with the worker in it: its conversation appears for them.
    const { data: group, error: groupError } = await db
      .from("worker_groups")
      .insert({ owner_id: owner.id, name: "E2E Tým", color: "teal" })
      .select("id")
      .single();
    if (groupError) throw groupError;
    const { error: memberError } = await db
      .from("worker_group_members")
      .insert({ group_id: group.id, worker_id: worker.id, owner_id: owner.id });
    if (memberError) throw memberError;
    const groupRow = workerPage.locator('[data-testid="chat-channel"][data-kind="group"]');
    await expect(groupRow).toContainText("E2E Tým");

    // The owner writes there; the worker sees it waiting in the list.
    await openApp(page, "/app/zpravy");
    await page.locator('[data-testid="chat-channel"][data-kind="group"]').click();
    await page.getByTestId("chat-input").click();
    await page.keyboard.type("Vítejte v týmu");
    await page.keyboard.press("Enter");
    await expect(groupRow.getByTestId("chat-channel-unread")).toHaveText("1");
  } finally {
    await workerContext.close();
  }
});
