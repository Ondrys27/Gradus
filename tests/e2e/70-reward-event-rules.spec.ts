import { admin, asUser, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { text } from "./support/i18n";
import { openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

test.use({ reducedMotion: "reduce" });

type Db = ReturnType<typeof admin>;

/** Answers for the required questions of a table, as the move dialog would fill them. */
async function answersFor(db: Db, tableId: string) {
  const { data, error } = await db
    .from("contact_table_fields")
    .select("id, type, required, options")
    .eq("table_id", tableId)
    .eq("required", true);
  if (error) throw error;
  const tomorrow = new Date(Date.now() + 24 * 3600_000);
  tomorrow.setUTCHours(9, 0, 0, 0);
  return Object.fromEntries(
    data.map((field) => {
      const options = Array.isArray(field.options) ? (field.options as Array<{ key: string }>) : [];
      const value =
        field.type === "datetime"
          ? tomorrow.toISOString()
          : field.type === "date"
            ? tomorrow.toISOString().slice(0, 10)
            : field.type === "boolean"
              ? true
              : field.type === "select"
                ? (options[0]?.key ?? "")
                : "E2E";
      return [field.id, value];
    }),
  );
}

/**
 * 29.1: the owner adds the rule "any move into Meeting scheduled, only the
 * first time per contact" with the sentence editor (and tries it on the
 * last 30 days) → the worker moves a contact there from "Follow up" → the
 * reward is there; back out and in again → still one reward.
 */
test("70 · reward rule: any move into Meeting scheduled pays once per contact", async ({ page, accounts }) => {
  const owner = await accounts.create({ label: "rules-owner" });
  const person = await accounts.create({ label: "rules-worker" });
  const db = admin();

  const { data: worker, error: workerError } = await db
    .from("workers")
    .insert({ owner_id: owner.id, user_id: person.id, name: "E2E Caller", email: person.email, status: "active" })
    .select("id")
    .single();
  if (workerError) throw workerError;
  const { error: grantError } = await db.from("worker_permission_grants").upsert(
    [
      ["contacts", "view"],
      ["contacts", "update"],
      ["cold_calling", "view"],
      ["cold_calling", "call"],
    ].map(([section, action]) => ({ owner_id: owner.id, worker_id: worker.id, section, action, allowed: true })),
    { onConflict: "worker_id,section,action" },
  );
  if (grantError) throw grantError;

  const { data: tables, error: tablesError } = await db
    .from("contact_tables")
    .select("id, system_key")
    .eq("user_id", owner.id)
    .in("system_key", ["follow_up", "meeting_scheduled"]);
  if (tablesError) throw tablesError;
  const follow = tables.find((table) => table.system_key === "follow_up")!.id;
  const meeting = tables.find((table) => table.system_key === "meeting_scheduled")!.id;
  const { data: contact, error: contactError } = await db
    .from("contacts")
    .insert({ user_id: owner.id, company_name: "E2E Kavárna U Rohu" })
    .select("id")
    .single();
  if (contactError) throw contactError;
  const move = (who: typeof owner, to: string) =>
    asUser(who, async (client) => {
      const { error } = await client.rpc("move_contact", {
        _contact_id: contact.id,
        _to_table_id: to,
        _answers: await answersFor(db, to),
      });
      if (error) throw error;
    });
  // The owner puts the contact into "Follow up" (the owner is not paid by a worker's plan).
  await move(owner, follow);

  // The owner writes the rule as a sentence.
  await signIn(page, owner);
  await openApp(page, `/app/firma?worker=${worker.id}&wtab=rewards`);
  await page.getByTestId("reward-plan-create").click();
  await page.getByTestId("reward-rule-add").click();
  const editor = page.getByTestId("reward-rule-editor");
  await expect(editor).toBeVisible();
  const sentence = editor.getByTestId("reward-sentence");
  await expect(sentence).toContainText(t("workers.rewardPlan.sentence.from.any"));
  await expect(sentence).toContainText(t("workers.rewardPlan.sentence.once.contact"));
  await expect(editor.getByTestId("reward-part-to")).toContainText("Domluvená schůzka");
  await editor.getByTestId("reward-part-reward").click();
  await editor.getByTestId("reward-amount-input").fill("500");
  await expect(editor.getByTestId("reward-part-reward")).toContainText("500");
  // Try it: nothing in the last 30 days yet, and nothing is written.
  await editor.getByRole("button", { name: t("workers.rewardPlan.try.button") }).click();
  await expect(editor.getByTestId("reward-try-result")).toContainText(t("workers.rewardPlan.try.nothing"));
  await editor.getByTestId("reward-rule-save").click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByTestId("reward-rule")).toHaveCount(1);
  await expect(page.getByTestId("reward-rule")).toContainText("Domluvená schůzka");

  const entries = async () => {
    const { data, error } = await db
      .from("reward_entries")
      .select("amount, status, source_kind")
      .eq("worker_id", worker.id)
      .is("corrects_id", null)
      .is("reversed_at", null);
    if (error) throw error;
    return data.map((entry) => `${entry.source_kind}:${Number(entry.amount)}:${entry.status}`);
  };
  expect(await entries()).toEqual([]);

  // The worker moves it from "Follow up" into "Meeting scheduled": the reward is there.
  await move(person, meeting);
  await expect.poll(entries).toEqual(["contact_move:500:pending"]);

  // Back out and in again: still one reward, never a second.
  await move(person, follow);
  await move(person, meeting);
  await expect.poll(entries).toEqual(["contact_move:500:pending"]);

  // The owner sees it waiting for approval.
  await page.reload();
  await expect(page.getByTestId("reward-approve-all")).toBeVisible();
});
