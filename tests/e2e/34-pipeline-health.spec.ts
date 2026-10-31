import { admin, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

/** A day relative to today in Prague (the account's zone), as yyyy-MM-dd. */
function pragueDay(offset: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offset * 86_400_000));
}

/**
 * 17.3: a deal whose Close Date was yesterday lights the first tile on the
 * dashboard; the tile leads to the pipeline with its list open, the deal
 * opens from the list, its Close Date moves to today and the tile turns
 * green without a reload. The Close Date filter in the address shows only it.
 */
test("34 · Close Date yesterday → tile lit → list → open the deal → move the date → green", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "pipeline-health" });
  const db = admin();
  const { data: stage, error: stageError } = await db
    .from("pipeline_stages")
    .select("id")
    .eq("user_id", account.id)
    .eq("is_won", false)
    .eq("is_lost", false)
    .order("position")
    .limit(1)
    .single();
  if (stageError) throw stageError;
  const late = "E2E Web pro pekárnu";
  const calm = "E2E Logo pro kavárnu";
  const { data: deals, error: dealError } = await db
    .from("deals")
    .insert([
      { user_id: account.id, stage_id: stage.id, title: late, expected_close_date: pragueDay(-1) },
      { user_id: account.id, stage_id: stage.id, title: calm, expected_close_date: pragueDay(10) },
    ])
    .select("id, title");
  if (dealError) throw dealError;
  const lateId = deals.find((deal) => deal.title === late)!.id;

  await signIn(page, account);

  // The dashboard: the first tile counts the deal and is not green.
  await openApp(page, "/app");
  const dashboardTile = page.locator('[data-tile="closePast"]');
  await expect(dashboardTile).toHaveAttribute("data-count", "1");
  await expect(dashboardTile).toHaveAttribute("data-level", "warn");
  await dashboardTile.click();
  await expect(page).toHaveURL(/\/app\/pipeline\?tile=closePast/);

  // The pipeline opens with the tile's list unfolded under it.
  const tile = page.locator('[data-tile="closePast"]');
  await expect(tile).toHaveAttribute("aria-expanded", "true");
  await expect(tile).toHaveAttribute("data-count", "1");
  const list = page.getByRole("list", { name: t("pipeline.health.tiles.closePast.label") });
  await expect(list).toBeVisible();
  await expect(list.getByRole("button")).toHaveCount(1);
  await expect(list.getByText(late, { exact: true })).toBeVisible();

  // Open it from the list and move the Close Date to today.
  await list
    .getByRole("button", { name: exact(L, "pipeline.health.row.open", { title: late }) })
    .click();
  const detail = page.getByRole("dialog", { name: t("pipeline.detail.title") });
  await expect(detail).toBeVisible();
  await expect(detail.locator("#deal-title")).toHaveValue(late);
  await detail.locator("#deal-close").click();
  await page.getByRole("button", { name: exact(L, "common.datePicker.today") }).click();
  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("deals")
          .select("expected_close_date")
          .eq("id", lateId)
          .single();
        return data?.expected_close_date ?? null;
      },
      { message: "the Close Date is saved" },
    )
    .toBe(pragueDay(0));
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();

  // Green without a reload, and the list says there is nothing left.
  await expect(tile).toHaveAttribute("data-count", "0");
  await expect(tile).toHaveAttribute("data-level", "ok");
  await expect(
    page
      .locator("#pipeline-health-list")
      .getByText(t("pipeline.health.listEmpty"), { exact: true }),
  ).toBeVisible();

  // A second tap folds the list away and takes the tile out of the address.
  await tile.click();
  await expect(tile).toHaveAttribute("aria-expanded", "false");
  await expect(page).not.toHaveURL(/tile=/);

  // The Close Date filter lives in the address and shows only the deals it matches.
  await openApp(
    page,
    "/app/pipeline?close=custom&closeFrom=" + pragueDay(0) + "&closeTo=" + pragueDay(0),
  );
  const board = page.locator("main");
  await expect(board.getByText(late, { exact: true })).toBeVisible();
  await expect(board.getByText(calm, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: new RegExp(
        `^${t("pipeline.filters.remove", { filter: `${t("pipeline.filters.close")}:` })}`,
      ),
    }),
  ).toBeVisible();
});
