import path from "node:path";
import { admin, signIn } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

/** Same as src/features/jarvis/server/e2e-model.ts: the echo stand-in instead of Anthropic. */
const E2E_MODEL_HEADER = "x-gradus-e2e-model";
const E2E_ECHO_NOTES = "echo-notes";
const OPML = path.resolve(__dirname, "../fixtures/mindmap/sample.opml");

// Nodes glide in and Jarvis's button bobs; with reduced motion both hold still.
test.use({ reducedMotion: "reduce" });

/**
 * 20.3: a note that is a mind map. A new map is typed with Tab and Enter,
 * survives a reload, takes an OPML file and reaches Jarvis as its indented
 * outline inside <user_notes>.
 */
test("44 · mind map note: Tab/Enter → reload → import OPML → Jarvis sees the outline", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "notes-map" });
  await signIn(page, account);
  await page.goto("/app/poznamky");

  // New note → Mind map: the centre waits for its text.
  await page.getByTestId("note-new-menu").click();
  await page.getByTestId("note-new-map").click();
  const field = page.getByTestId("note-map-input");
  await expect(field).toBeFocused();
  await page.keyboard.type("E2E Konkurence");
  await page.keyboard.press("Tab");
  await expect(field).toBeFocused();
  await page.keyboard.type("Kavárny");
  await page.keyboard.press("Tab");
  await page.keyboard.type("U Rohu");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Café Nero");
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);

  const status = page.getByTestId("note-save-status");
  await expect(status).toHaveAttribute("data-status", "saved");
  const row = page.getByTestId("note-row").filter({ hasText: "E2E Konkurence" });
  await expect(row).toBeVisible();
  await expect(row.getByTestId("note-kind-mindmap")).toBeVisible();

  const outline = ["E2E Konkurence", "  Kavárny", "    U Rohu", "    Café Nero"].join("\n");
  const db = admin();
  const stored = async () => {
    const { data, error } = await db
      .from("notes")
      .select("id, kind, title, content_text")
      .eq("user_id", account.id)
      .eq("title", "E2E Konkurence")
      .single();
    if (error) throw error;
    return data;
  };
  await expect.poll(async () => (await stored()).content_text).toBe(outline);
  expect((await stored()).kind).toBe("mindmap");

  // After a reload the map is there, node by node.
  await page.reload();
  await row.click();
  const nodes = page.getByTestId("note-map-node");
  for (const title of ["E2E Konkurence", "Kavárny", "U Rohu", "Café Nero"]) {
    await expect(nodes.filter({ hasText: title }).first()).toBeVisible();
  }

  // Import an OPML file into it: its branches join the centre.
  await page.getByTestId("note-more").click();
  await page.getByTestId("note-map-import").click();
  const dialog = page.getByRole("dialog", { name: t("notes.map.import.title") });
  await dialog.getByLabel(t("milestones.mapIo.fileLabel")).setInputFiles(OPML);
  await expect(dialog.getByTestId("note-map-import-summary")).toContainText("9");
  await dialog.getByTestId("note-map-import-submit").click();
  await expect(dialog).toBeHidden();
  await expect(nodes.filter({ hasText: "Úprava fotek" })).toBeVisible();
  await expect(status).toHaveAttribute("data-status", "saved");
  await expect
    .poll(async () => (await stored()).content_text)
    .toContain("  Produkty\n    Vybrat dodavatele\n    Nafotit produkty\n      Pozadí a světlo");
  expect((await stored()).content_text.startsWith(outline)).toBe(true);

  // Jarvis gets the map as its indented outline (the echo model answers with his context).
  await page.route("**/api/jarvis", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.continue({
      headers: { ...route.request().headers(), [E2E_MODEL_HEADER]: E2E_ECHO_NOTES },
    });
  });
  await page.getByRole("button", { name: exact(L, "jarvis.open") }).click();
  const panel = page.getByRole("dialog", { name: t("jarvis.title") });
  await panel.getByRole("textbox", { name: t("jarvis.inputLabel") }).fill("Co mám v mapě Konkurence?");
  await panel.getByRole("button", { name: exact(L, "jarvis.send") }).click();
  const answer = panel.locator(".border-teal.whitespace-pre-wrap").last();
  await expect(answer).toContainText("<user_notes>", { timeout: 30_000 });
  await expect(answer).toContainText('kind="mind map"');
  // Whitespace is folded in the comparison; the order of the lines still shows.
  await expect(answer).toContainText("E2E Konkurence Kavárny U Rohu Café Nero");
});
