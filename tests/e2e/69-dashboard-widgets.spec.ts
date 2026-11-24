import type { Page } from "@playwright/test";
import { admin, asUser, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { openApp } from "./support/ui";

test.use({ reducedMotion: "reduce" });

/** The widgets on the board, in their order. */
function board(page: Page) {
  return page.getByTestId("widget-grid").getByTestId("widget");
}

async function order(page: Page): Promise<string[]> {
  return board(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-widget") ?? ""),
  );
}

/** Drags a widget onto another one, with steps so dnd-kit sees a real drag. */
async function drag(page: Page, from: string, onto: string) {
  // Both widgets must be on screen at once: a widget added at the end sits
  // below a laptop-sized window, and the mouse cannot press what it cannot see.
  const viewport = page.viewportSize();
  if (viewport && viewport.height < 2000) {
    await page.setViewportSize({ width: viewport.width, height: 2000 });
  }
  const source = page.getByTestId("widget-grid").locator(`[data-widget="${from}"]`).first();
  const target = page.getByTestId("widget-grid").locator(`[data-widget="${onto}"]`).first();
  const a = (await source.boundingBox())!;
  const b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 });
  await page.mouse.move(b.x + 24, b.y + 24, { steps: 16 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

/**
 * 28.5: the owner's dashboard of widgets. Add a widget from the gallery, move
 * it to the front by dragging, make it large, open its detail and close it
 * again; after a reload the layout is the same, saved by itself.
 */
test("69a · widgets: add from the gallery, move, resize, open the detail, saved", async ({
  page,
  accounts,
}) => {
  const owner = await accounts.create({ label: "widgets-owner", mode: "tool" });
  const db = admin();
  await signIn(page, owner);
  await openApp(page, "/app");

  await expect(board(page).first()).toBeVisible();
  const before = await order(page);
  expect(before[0]).toBe("today");
  expect(before).not.toContain("meetings");

  // Edit → Add widget → the gallery → Upcoming meetings, medium.
  await page.getByTestId("board-edit").click();
  await expect(page.getByTestId("widget-board")).toHaveAttribute("data-editing", "true");
  await page.getByTestId("board-add").click();
  const gallery = page.getByTestId("widget-gallery");
  await expect(gallery).toBeVisible();
  // Finance widgets are offered to the owner.
  await expect(
    gallery.locator('[data-testid="gallery-widget"][data-widget="financeMonth"]'),
  ).toHaveCount(1);
  const meetings = gallery.locator('[data-testid="gallery-widget"][data-widget="meetings"]');
  await meetings.getByTestId("gallery-size-M").click();
  await meetings.getByTestId("gallery-add").click();
  await expect(gallery).toHaveCount(0);
  await expect.poll(() => order(page)).toContain("meetings");

  // Drag it onto Today: it takes the first place, the rest make room.
  await drag(page, "meetings", "today");
  await expect.poll(async () => (await order(page))[0]).toBe("meetings");

  // Large from the corner menu.
  const widget = page.getByTestId("widget-grid").locator('[data-widget="meetings"]');
  await widget.getByTestId("widget-resize").click();
  await page.getByTestId("widget-size-L").click();
  await expect(widget).toHaveAttribute("data-size", "L");

  // Undo takes the size back, a second resize keeps it.
  await page.getByTestId("board-undo").click();
  await expect(widget).toHaveAttribute("data-size", "M");
  await widget.getByTestId("widget-resize").click();
  await page.getByTestId("widget-size-L").click();
  await expect(widget).toHaveAttribute("data-size", "L");

  await page.getByTestId("board-edit").click();
  await expect(page.getByTestId("widget-board")).not.toHaveAttribute("data-editing", "true");

  // Saved by itself: the main tab is now the owner's own.
  await expect
    .poll(async () => {
      const { data } = await db
        .from("dashboard_layouts")
        .select("items")
        .eq("user_id", owner.id)
        .eq("is_default", true)
        .maybeSingle();
      const items = (data?.items ?? []) as { widget: string; size: string }[];
      return items[0] ? `${items[0].widget}:${items[0].size}` : "";
    })
    .toBe("meetings:L");

  // A tap opens the detail; Esc puts it back.
  await widget
    .getByRole("button", { name: /schůzky|meetings/i })
    .first()
    .click();
  const detail = page.getByTestId("widget-detail");
  await expect(detail).toBeVisible();
  await expect(detail.getByTestId("widget-open-section")).toHaveAttribute("href", "/app/kalendar");
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);

  // After a reload the layout is the same.
  await page.reload();
  await expect.poll(async () => (await order(page))[0]).toBe("meetings");
  await expect(page.getByTestId("widget-grid").locator('[data-widget="meetings"]')).toHaveAttribute(
    "data-size",
    "L",
  );
});

/**
 * 28.5: a worker without the finance right. The company default holds finance
 * widgets; the worker's board leaves them out quietly, the gallery does not
 * offer them, and asking the database directly gives nothing either.
 */
/**
 * GR-87H55P: a widget dragged over others of another size and held still made
 * the grid swap two widgets back and forth until React gave up (error #185).
 * The drag sweeps over every widget, stops on each, and the page stays whole.
 */
test("69c · widgets: dragging over widgets of other sizes and holding still does not loop", async ({
  page,
  accounts,
}) => {
  const owner = await accounts.create({ label: "widgets-sweep", mode: "tool" });
  await signIn(page, owner);
  await page.setViewportSize({ width: 1440, height: 2000 });
  await openApp(page, "/app");
  await expect(board(page).first()).toBeVisible();
  await page.getByTestId("board-edit").click();
  await expect(page.getByTestId("widget-board")).toHaveAttribute("data-editing", "true");

  const boxes = await board(page).evaluateAll((nodes) =>
    nodes.map((node) => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
  expect(boxes.length).toBeGreaterThan(2);
  const first = boxes[0];
  await page.mouse.move(first.x + first.w / 2, first.y + first.h / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + first.w / 2 + 12, first.y + first.h / 2 + 12, { steps: 4 });
  // Over every widget: its corners and middle, holding still at each.
  for (const box of [...boxes.slice(1), ...boxes.slice(1).reverse()]) {
    for (const [fx, fy] of [
      [0.2, 0.2],
      [0.5, 0.5],
      [0.8, 0.8],
    ]) {
      await page.mouse.move(box.x + box.w * fx, box.y + box.h * fy, { steps: 6 });
      await page.waitForTimeout(120);
    }
  }
  await page.mouse.up();

  // Still the board, not the error screen (the fixture fails on the console error too).
  await expect(page.getByTestId("widget-grid")).toBeVisible();
  await expect(board(page)).toHaveCount(boxes.length);
});

test("69b · a worker without finance sees no finance widget, not even through the API", async ({
  page,
  accounts,
}) => {
  const owner = await accounts.create({ label: "widgets-boss", mode: "tool" });
  const person = await accounts.create({ label: "widgets-seller" });
  const db = admin();

  const { data: worker, error: workerError } = await db
    .from("workers")
    .insert({
      owner_id: owner.id,
      user_id: person.id,
      name: "E2E Prodejce",
      email: person.email,
      status: "active",
    })
    .select("id")
    .single();
  if (workerError) throw workerError;
  const { error: grantError } = await db.from("worker_permission_grants").insert(
    [
      ["pipeline", "view"],
      ["calendar", "view"],
    ].map(([section, action]) => ({
      owner_id: owner.id,
      worker_id: worker.id,
      section,
      action,
      allowed: true,
    })),
  );
  if (grantError) throw grantError;

  const { error: incomeError } = await db.from("transactions").insert({
    user_id: owner.id,
    type: "income",
    amount: 4321,
    occurred_on: new Date().toISOString().slice(0, 10),
    description: "E2E Tajný příjem",
  });
  if (incomeError) throw incomeError;

  // The company's default: money first, then the pipeline.
  const item = (id: string, widget: string, size: string) => ({
    id,
    widget,
    size,
    x: 0,
    y: 0,
    settings: {},
  });
  const { error: defaultError } = await db.from("dashboard_defaults").insert({
    space_id: owner.id,
    target: "space",
    items: [
      item("f1", "financeMonth", "S"),
      item("f2", "capital", "L"),
      item("f3", "overdueInvoices", "S"),
      item("p1", "pipeline", "M"),
      item("m1", "meetings", "M"),
    ],
  });
  if (defaultError) throw defaultError;

  await signIn(page, person);
  await openApp(page, "/app");
  await expect.poll(() => order(page)).toEqual(["pipeline", "meetings"]);

  // The gallery never offers them.
  await page.getByTestId("board-edit").click();
  await page.getByTestId("board-add").click();
  const gallery = page.getByTestId("widget-gallery");
  await expect(
    gallery.locator('[data-testid="gallery-widget"][data-widget="pipeline"]'),
  ).toHaveCount(1);
  for (const key of ["financeMonth", "capital", "overdueInvoices"]) {
    await expect(
      gallery.locator(`[data-testid="gallery-widget"][data-widget="${key}"]`),
    ).toHaveCount(0);
  }

  // Nor does the database, asked directly with the worker's own session.
  await asUser(person, async (client) => {
    const transactions = await client.from("transactions").select("id").eq("user_id", owner.id);
    expect(transactions.error).toBeNull();
    expect(transactions.data).toEqual([]);
    const totals = await client.rpc("finance_totals_by_currency", {
      _from: new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10),
      _to: new Date().toISOString().slice(0, 10),
    });
    expect((totals.data ?? []) as unknown[]).toEqual([]);
    // The owner's defaults are not the worker's to read either.
    const defaults = await client.from("dashboard_defaults").select("id");
    expect(defaults.data).toEqual([]);
  });
});
