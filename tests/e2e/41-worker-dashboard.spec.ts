import sharp from "sharp";
import { admin, signIn } from "./support/accounts";
import { expect, test, watchConsole } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { mainNav, openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

test.use({ reducedMotion: "reduce" });

/** A small square photo, large enough for the cropper. */
async function photo() {
  return sharp({
    create: { width: 320, height: 320, channels: 3, background: { r: 124, g: 92, b: 255 } },
  })
    .png()
    .toBuffer();
}

/** A tiny but real PDF. */
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

/**
 * 19.3: the owner opens a worker's dashboard → changes the photo and the job
 * title → gives the "Obchodník" template → the worker signs in and sees their
 * own deal but not the owner's, nor finance → the owner uploads a document →
 * removes the worker, handing their deals to the owner.
 */
test("41 · worker dashboard: photo and title → Obchodník → what the worker sees → document → remove", async ({
  page,
  browser,
  accounts,
  consoleErrors,
}) => {
  const owner = await accounts.create({ label: "dash-owner" });
  const person = await accounts.create({ label: "dash-worker" });
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

  const { data: stage, error: stageError } = await db
    .from("pipeline_stages")
    .select("id")
    .eq("user_id", owner.id)
    .eq("is_won", false)
    .eq("is_lost", false)
    .order("position")
    .limit(1)
    .single();
  if (stageError) throw stageError;
  const { data: deals, error: dealsError } = await db
    .from("deals")
    .insert([
      { user_id: owner.id, stage_id: stage.id, title: "E2E Obchod prodejce", assignee_id: person.id },
      { user_id: owner.id, stage_id: stage.id, title: "E2E Obchod majitele", assignee_id: owner.id },
    ])
    .select("id, title");
  if (dealsError) throw dealsError;
  const sellersDeal = deals.find((deal) => deal.title === "E2E Obchod prodejce")!;
  const { error: incomeError } = await db.from("transactions").insert({
    user_id: owner.id,
    type: "income",
    amount: 1234,
    occurred_on: new Date().toISOString().slice(0, 10),
    description: "E2E Tajný příjem",
  });
  if (incomeError) throw incomeError;

  const workerRow = async () => {
    const { data, error } = await db
      .from("workers")
      .select("job_title, avatar_url, status")
      .eq("id", worker.id)
      .single();
    if (error) throw error;
    return data;
  };

  // The owner opens the dashboard from the list.
  await signIn(page, owner);
  await openApp(page, "/app/firma");
  await page.locator(`[data-company-row="${worker.id}"]`).getByText("E2E Prodejce").click();
  const dashboard = page.getByTestId("worker-dashboard");
  await expect(dashboard).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`worker=${worker.id}`));

  // Photo: pick, crop, save.
  await dashboard.getByTestId("worker-photo-input").setInputFiles({
    name: "foto.png",
    mimeType: "image/png",
    buffer: await photo(),
  });
  const crop = page.getByRole("dialog", {
    name: t("workers.dashboard.photo.cropTitle", { name: "E2E Prodejce" }),
  });
  await crop.getByRole("button", { name: exact(L, "profile.avatar.save") }).click();
  await expect(crop).toHaveCount(0);
  await expect
    .poll(async () => (await workerRow()).avatar_url ?? "")
    .toContain(`/worker-avatars/${owner.id}/${worker.id}/`);

  // Job title in place.
  const title = dashboard.getByTestId("worker-job-title");
  await title.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Obchodník");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await workerRow()).job_title).toBe("Obchodník");

  // Rights: the Obchodník template in one click.
  await dashboard.getByTestId("worker-tab-rights").click();
  await dashboard.getByTestId("rights-template-sales").click();
  await expect
    .poll(async () => {
      const { data } = await db
        .from("worker_permission_grants")
        .select("section, action")
        .eq("worker_id", worker.id)
        .eq("allowed", true);
      return (data ?? []).map((row) => `${row.section}.${row.action}`).sort();
    })
    .toEqual(
      expect.arrayContaining(["pipeline.create", "pipeline.view", "contacts.view", "company.view"]),
    );
  const { data: finance } = await db
    .from("worker_permission_grants")
    .select("allowed")
    .eq("worker_id", worker.id)
    .eq("section", "finance")
    .eq("action", "view")
    .maybeSingle();
  expect(finance?.allowed ?? false).toBe(false);

  // The worker signs in: their deal, not the owner's; no finance.
  const workerContext = await browser.newContext({ locale: "cs-CZ", timezoneId: "Europe/Prague" });
  watchConsole(workerContext, consoleErrors);
  const workerPage = await workerContext.newPage();
  try {
    await signIn(workerPage, person);
    const nav = mainNav(workerPage, L);
    await expect(nav.getByRole("link", { name: t("nav.pipeline") })).toBeVisible();
    await expect(nav.getByRole("link", { name: t("nav.finance") })).toHaveCount(0);
    await openApp(workerPage, "/app/pipeline");
    await expect(workerPage.getByText("E2E Obchod prodejce").first()).toBeVisible();
    await expect(workerPage.getByText("E2E Obchod majitele")).toHaveCount(0);
    await workerPage.goto("/app/finance");
    await expect(workerPage).toHaveURL(/\/app$/);
    await expect(workerPage.getByText("E2E Tajný příjem")).toHaveCount(0);

    // A document from the owner.
    await dashboard.getByTestId("worker-tab-documents").click();
    await dashboard.getByTestId("worker-documents-input").setInputFiles({
      name: "Smlouva.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await expect(dashboard.getByTestId("worker-document-row")).toContainText("Smlouva.pdf");
    const { data: documents } = await db
      .from("worker_documents")
      .select("name, mime")
      .eq("worker_id", worker.id);
    expect(documents).toEqual([{ name: "Smlouva.pdf", mime: "application/pdf" }]);

    // Remove from the company, the deals to the owner.
    await dashboard.getByTestId("worker-tab-overview").click();
    await dashboard.getByTestId("worker-remove").click();
    await page.getByTestId("worker-remove-assignee").click();
    await page.getByRole("option", { name: /\(majitel\)$/ }).click();
    await page.getByTestId("worker-remove-confirm").click();
    await expect.poll(async () => (await workerRow()).status).toBe("inactive");
    const { data: handed } = await db
      .from("deals")
      .select("assignee_id")
      .eq("id", sellersDeal.id)
      .single();
    expect(handed?.assignee_id).toBe(owner.id);

    // The access ended: back in their own account, the owner's deals gone.
    await workerPage.reload();
    await openApp(workerPage, "/app/pipeline");
    await expect(workerPage.getByText("E2E Obchod prodejce")).toHaveCount(0);
  } finally {
    await workerContext.close();
  }
});
