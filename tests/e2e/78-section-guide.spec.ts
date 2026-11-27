import type { Page } from "@playwright/test";
import { admin, signIn, skipCompanyTutorial } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { text } from "./support/i18n";
import { dismissCelebrationsAutomatically, openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

/**
 * Same as src/features/grady/server/e2e-model.ts: the guide stand-in answers
 * the guide's call with this JSON (base64) as if the model wrote it, for e2e
 * accounts outside production; the server then checks it against the catalog
 * of controls and the account's rights exactly as a real answer.
 */
const E2E_MODEL_HEADER = "x-gradus-e2e-model";
const E2E_GUIDE_HEADER = "x-gradus-e2e-guide";

test.use({ reducedMotion: "reduce" });

/** Every guide question of this page gets `answer` from the stand-in model. */
async function scriptGuide(page: Page, answer: unknown) {
  await page.route("**/api/grady", async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { kind?: string } | null;
    if (request.method() !== "POST" || body?.kind !== "guideAnswer") return route.continue();
    await route.continue({
      headers: {
        ...request.headers(),
        [E2E_MODEL_HEADER]: "guide-script",
        [E2E_GUIDE_HEADER]: Buffer.from(JSON.stringify(answer)).toString("base64"),
      },
    });
  });
}

async function askGuide(page: Page, question: string) {
  await page.getByTestId("guide-button").first().click();
  const menu = page.getByTestId("guide-menu");
  await expect(menu).toBeVisible();
  await menu.getByTestId("guide-question").fill(question);
  await menu.getByTestId("guide-ask").click();
  return page.getByTestId("guide-answer");
}

const ADD_DEAL = {
  kind: "steps",
  answer: "Obchod přidáš v Pipeline tlačítkem Nový obchod. Vyplníš název a uložíš.",
  steps: [
    { key: "pipeline-new-deal", action: "click", say: "Klikni na Nový obchod." },
    { key: "deal-form", action: "fill", say: "Napiš, o jaký obchod jde." },
    { key: "deal-create", action: "wait", say: "A ulož ho." },
  ],
};

test("78 · Grady's own guide: a question → steps across two sections → the user finishes the action", async ({
  page,
  accounts,
}) => {
  const account = await accounts.create({ label: "guide-owner" });
  await signIn(page, account);
  await scriptGuide(page, ADD_DEAL);
  await dismissCelebrationsAutomatically(page, L);
  await openApp(page, "/app");

  const card = await askGuide(page, "Jak přidám nový obchod?");
  await expect(card.getByTestId("guide-answer-text")).toHaveAttribute("data-guide-kind", "steps");
  await expect(card).toContainText(ADD_DEAL.answer);
  await card.getByTestId("guide-show").click();

  // 1. The deal is in another section: Grady leads there ("Do it for me").
  const step = page.getByTestId("guide-step");
  await expect(step).toHaveAttribute("data-guide-action", "go");
  await page.getByTestId("guide-do-for-me").click();
  await expect(page).toHaveURL(/\/app\/pipeline/);

  // 2. Click here: the user presses New deal.
  await expect(step).toHaveAttribute("data-guide-action", "click");
  await expect(step).toContainText("Klikni na Nový obchod.");
  await page.locator('[data-tutorial="pipeline-new-deal"]').first().click();

  // 3. Fill in: the user types the deal's name.
  await expect(step).toHaveAttribute("data-guide-action", "fill");
  const title = "E2E Obchod z průvodce";
  await page.locator('[data-tutorial="deal-form"] input').first().fill(title);

  // 4. Wait until it is saved: the user saves, the guide ends by itself.
  await expect(step).toHaveAttribute("data-guide-action", "wait");
  await page.locator('[data-tutorial="deal-create"]').first().click();
  await expect(step).toHaveCount(0);

  const { data, error } = await admin()
    .from("deals")
    .select("id")
    .eq("user_id", account.id)
    .eq("title", title);
  if (error) throw error;
  expect(data).toHaveLength(1);
});

test("78 · a worker without the right gets an explanation instead of steps", async ({ page, accounts }) => {
  const owner = await accounts.create({ label: "guide-boss" });
  const person = await accounts.create({ label: "guide-worker" });
  const db = admin();
  const { data: worker, error } = await db
    .from("workers")
    .insert({ owner_id: owner.id, user_id: person.id, name: "E2E Průvodce", email: person.email, status: "active" })
    .select("id")
    .single();
  if (error) throw error;
  const grants = await db
    .from("worker_permission_grants")
    .insert({ owner_id: owner.id, worker_id: worker.id, section: "pipeline", action: "view", allowed: true });
  if (grants.error) throw grants.error;
  await skipCompanyTutorial(person.id, owner.id);

  await signIn(page, person);
  await scriptGuide(page, {
    kind: "steps",
    answer: "Fakturu vystavíš ve Financích na záložce Faktury.",
    steps: [
      { key: "invoice-new", action: "click" },
      { key: "invoice-customer", action: "fill" },
      { key: "invoice-issue", action: "click" },
    ],
  });
  await openApp(page, "/app/pipeline");

  const card = await askGuide(page, "Jak vystavím fakturu?");
  await expect(card.getByTestId("guide-answer-text")).toHaveAttribute("data-guide-kind", "noRight");
  await expect(card).toContainText(
    t("tutorial.guide.noRightAnswer", { sections: t("tutorial.guides.invoices.name") }),
  );
  await expect(card.getByTestId("guide-show")).toHaveCount(0);
  await expect(card.getByTestId("guide-ask-owner")).toHaveAttribute("href", `/app/zpravy?to=${owner.id}`);
});
