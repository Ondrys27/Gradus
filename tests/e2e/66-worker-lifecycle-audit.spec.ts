import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import { admin, e2eEmail, e2ePassword, signIn } from "./support/accounts";
import { requiredEnv } from "./support/env";
import { test, watchConsole } from "./support/fixtures";
import { exact, text, type Locale } from "./support/i18n";
import { finishTour, openApp, waitForApp } from "./support/ui";

/**
 * The audit of a worker's whole life in a company (28.1), not a regression
 * test: every step leaves a screenshot in docs/audit-pozvanky/ and a line in
 * <variant>-steps.json, and a step that fails is written down and the walk
 * goes on. Run it on purpose against a production build:
 *
 *   NEXT_DIST_DIR=.next-e2e bun run build
 *   NEXT_DIST_DIR=.next-e2e bunx next start -p 3100
 *   AUDIT=1 E2E_BUILD=1 E2E_BASE_URL=http://localhost:3100 bunx playwright test 66
 *
 * Without AUDIT=1 it is skipped, so `bun run e2e` stays a regression run.
 */

const OUT = path.resolve(__dirname, "../../docs/audit-pozvanky");
/** File prefix: "po" (after 28.1) by default; the first walk of the code before 28.1 is "pred". */
const TAG = process.env.AUDIT_TAG || "po";

type Variant = { name: string; locale: Locale; width: number; height: number };
const VARIANTS: Variant[] = [
  { name: "cs-1440", locale: "cs", width: 1440, height: 900 },
  { name: "en-390", locale: "en", width: 390, height: 844 },
];

/** "Invite" in the dialog, before (22.5) and after (28.1) the choice step. */
const CREATE = /^(Pozvat|Invite|Vytvořit pozvánku|Create invite)$/;

type StepLog = { step: string; ok: boolean; note?: string };

test.skip(process.env.AUDIT !== "1", "The audit runs on purpose: AUDIT=1.");
test.use({ reducedMotion: "reduce" });

/** The mail the mock Resend kept for a test address (GET /api/e2e/outbox). */
async function outbox(page: Page, to: string) {
  const secret = requiredEnv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  const key = createHash("sha256").update(`gradus-e2e-outbox:${secret}`).digest("hex");
  const response = await page.request.get(`/api/e2e/outbox?to=${encodeURIComponent(to)}`, {
    headers: { "x-gradus-e2e-key": key },
  });
  if (response.status() !== 200) return [];
  return ((await response.json()) as { mail: { subject: string; text: string }[] }).mail;
}

async function newPage(browser: Browser, variant: Variant, errors: string[]) {
  const context = await browser.newContext({
    locale: variant.locale === "cs" ? "cs-CZ" : "en-GB",
    timezoneId: "Europe/Prague",
    viewport: { width: variant.width, height: variant.height },
    reducedMotion: "reduce",
  });
  watchConsole(context, errors);
  return { context, page: await context.newPage() };
}

for (const variant of VARIANTS) {
  test(`66 · audit of a worker's life (${variant.name})`, async ({ browser, accounts }) => {
    test.setTimeout(15 * 60_000);
    const L = variant.locale;
    const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);
    const log: StepLog[] = [];
    const errors: string[] = [];
    mkdirSync(OUT, { recursive: true });
    let shot = 0;

    async function snap(page: Page, name: string) {
      // The screen as a person sees it once it settled: no request in flight, no skeleton left.
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      await expect(page.locator('[data-slot="skeleton"]:visible'))
        .toHaveCount(0, { timeout: 10_000 })
        .catch(() => undefined);
      await page.waitForTimeout(300);
      shot += 1;
      const file = `${TAG}-${variant.name}-${String(shot).padStart(2, "0")}-${name}.jpg`;
      await page.screenshot({ path: path.join(OUT, file), type: "jpeg", quality: 55 }).catch(() => undefined);
    }
    /** One step: what it does, a screenshot, and a written failure instead of a stop. */
    async function step(name: string, page: Page, run: () => Promise<string | void>) {
      try {
        const note = await run();
        log.push({ step: name, ok: true, ...(note ? { note } : {}) });
      } catch (error) {
        log.push({ step: name, ok: false, note: String((error as Error).message ?? error).split("\n")[0] });
      }
      await snap(page, name);
    }

    const db = admin();
    const owner = await accounts.create({ label: `audit-owner-${variant.locale}`, locale: L });
    const existing = await accounts.create({ label: `audit-existing-${variant.locale}`, locale: L });
    const otherOwner = await accounts.create({ label: `audit-other-${variant.locale}`, locale: L });
    const company = variant.locale === "cs" ? "E2E Audit s.r.o." : "E2E Audit Ltd";
    await db.from("profiles").update({ company_name: company, display_name: "E2E Majitel" }).eq("id", owner.id);
    await db.from("profiles").update({ company_name: "E2E Druhá firma" }).eq("id", otherOwner.id);
    const handle = `e2e_audit_${Date.now().toString(36)}`.slice(0, 20);
    await db.from("profiles").update({ display_name: "E2E Existující", username: handle }).eq("id", existing.id);
    const { data: existingProfile } = await db.from("profiles").select("public_id").eq("id", existing.id).single();

    const boss = await newPage(browser, variant, errors);
    const ownerPage = boss.page;
    await signIn(ownerPage, owner);

    // 1 · A new person by e-mail (with capitals and spaces around it).
    const workerEmail = e2eEmail(`audit-new-${variant.locale}`);
    accounts.register(workerEmail);
    let inviteLink: string | null = null;
    await step("invite-new-by-email", ownerPage, async () => {
      await openApp(ownerPage, "/app/firma");
      await ownerPage.getByRole("button", { name: exact(L, "workers.add") }).first().click();
      const form = ownerPage.getByRole("dialog", { name: t("workers.form.newTitle") });
      await snap(ownerPage, "invite-dialog-open");
      const choice = form.locator('[data-tutorial="worker-invite-new"]');
      if (await choice.isVisible().catch(() => false)) await choice.click();
      await form.locator("#worker-name").fill("E2E Nováček");
      await form.locator("#worker-email").fill(`  ${workerEmail.toUpperCase()}  `);
      await snap(ownerPage, "invite-dialog-filled");
      await form.getByRole("button", { name: CREATE }).click();
      const ready = ownerPage.getByRole("dialog", { name: t("workers.form.inviteReady") });
      await expect(ready).toBeVisible();
      inviteLink = await ready.getByRole("textbox", { name: t("workers.invite.link") }).inputValue();
      const emailed = await ready.getByTestId("invite-emailed").isVisible().catch(() => false);
      await snap(ownerPage, "invite-ready");
      await ready.getByRole("button", { name: exact(L, "workers.form.done") }).click();
      return emailed ? "the dialog says it went by e-mail" : "the dialog does not say it went by e-mail";
    });

    // 2 · The e-mail of the mock Resend, and its link.
    await step("invite-email", ownerPage, async () => {
      const mail = await outbox(ownerPage, workerEmail);
      if (mail.length === 0) throw new Error("no invite e-mail in the outbox");
      const link = /https?:\/\/\S+invite=\S+/.exec(mail[mail.length - 1]!.text)?.[0];
      if (link) inviteLink = link;
      return `subject: ${mail[mail.length - 1]!.subject}`;
    });

    // 3 · Registration from the link → first sign-in.
    const workerSide = await newPage(browser, variant, errors);
    const workerPage = workerSide.page;
    const workerPassword = e2ePassword();
    await step("register-from-link", workerPage, async () => {
      if (!inviteLink) throw new Error("no link");
      const url = new URL(inviteLink);
      await workerPage.goto(`${url.pathname}${url.search}`);
      await snap(workerPage, "register-page");
      await expect(workerPage.locator("#register-email")).toHaveValue(workerEmail);
      await workerPage.locator("#register-password").fill(workerPassword);
      await workerPage.getByTestId("register-terms").click();
      await workerPage.locator("form button[type=submit]").click();
      await expect(workerPage).toHaveURL(/\/app(\?|$)/, { timeout: 60_000 });
      await waitForApp(workerPage);
    });
    await step("first-view", workerPage, async () => {
      await snap(workerPage, "first-view-raw");
      await finishTour(workerPage, L);
    });

    // 4 · What the worker sees: menu, overview, empty states.
    for (const [name, route] of [
      ["worker-dashboard", "/app"],
      ["worker-tasks", "/app/ukoly-crm"],
      ["worker-messages", "/app/zpravy"],
      ["worker-company", "/app/firma"],
      ["worker-rewards", "/app/odmeny"],
    ] as const) {
      await step(name, workerPage, async () => {
        await openApp(workerPage, route);
      });
    }
    await step("worker-switcher", workerPage, async () => {
      const current = workerPage.getByTestId("space-current");
      if (await current.isVisible().catch(() => false)) {
        await expect(current).toHaveText(company);
        await workerPage.getByTestId("space-switcher").click();
      } else {
        return "switcher not visible at this width";
      }
    });
    await workerPage.keyboard.press("Escape");

    const { data: workerRow } = await db
      .from("workers")
      .select("id, user_id, status")
      .eq("owner_id", owner.id)
      .eq("name", "E2E Nováček")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // 5 · A task from the owner → done by the worker.
    await step("owner-assigns-task", ownerPage, async () => {
      if (!workerRow) throw new Error("no worker record");
      await openApp(ownerPage, `/app/firma?worker=${workerRow.id}`);
      const dashboard = ownerPage.getByTestId("worker-dashboard");
      await expect(dashboard).toBeVisible();
      await dashboard.getByRole("button", { name: exact(L, "workers.dashboard.assignTask") }).click();
      await ownerPage.locator("#worker-task-title").fill("E2E Úkol od majitele");
      await ownerPage.locator("#worker-task-title").press("Enter");
    });
    await step("worker-completes-task", workerPage, async () => {
      await openApp(workerPage, "/app/ukoly-crm");
      await workerPage
        .getByRole("checkbox", { name: t("crmTasks.row.complete", { title: "E2E Úkol od majitele" }) })
        .click();
      await expect(
        workerPage.getByRole("checkbox", { name: t("crmTasks.row.reopen", { title: "E2E Úkol od majitele" }) }),
      ).toBeVisible();
    });

    // 6 · A message from the worker to the owner.
    await step("worker-writes", workerPage, async () => {
      await openApp(workerPage, "/app/zpravy");
      await workerPage.locator(`[data-testid="chat-person"][data-member="${owner.id}"]`).click();
      await workerPage.getByTestId("chat-input").fill("E2E Ahoj, úkol je hotový.");
      await workerPage.getByTestId("chat-input").press("Enter");
    });
    await step("owner-reads", ownerPage, async () => {
      await openApp(ownerPage, "/app/zpravy");
    });

    // 7 · An existing account by @username (or short id), accepted.
    await step("invite-existing", ownerPage, async () => {
      await openApp(ownerPage, "/app/firma");
      await ownerPage.getByRole("button", { name: exact(L, "workers.add") }).first().click();
      const form = ownerPage.getByRole("dialog", { name: t("workers.form.newTitle") });
      const choice = form.locator('[data-tutorial="worker-invite-existing"]');
      if (await choice.isVisible().catch(() => false)) {
        await choice.click();
        await form.locator("#worker-account").fill(`@${handle}`);
        await form.getByTestId("worker-find").click();
        await expect(form.getByTestId("invite-found-card")).toBeVisible();
        await snap(ownerPage, "invite-existing-card");
      } else {
        await form.locator("#worker-name").fill("E2E Existující");
        await form.locator("#worker-email").fill(existingProfile!.public_id!);
      }
      await form.getByRole("button", { name: CREATE }).click();
      const sent = ownerPage.getByRole("dialog", { name: t("workers.form.inviteSent") });
      await expect(sent).toBeVisible();
      await sent.getByRole("button", { name: exact(L, "workers.form.done") }).click();
    });
    const existingSide = await newPage(browser, variant, errors);
    const existingPage = existingSide.page;
    await signIn(existingPage, existing);
    await step("existing-sees-invite", existingPage, async () => {
      await expect(existingPage.getByTestId("inbox-count")).toHaveText("1");
      const mail = await outbox(existingPage, existing.email);
      return mail.length ? `e-mail: ${mail[mail.length - 1]!.subject}` : "no e-mail in the outbox";
    });
    await step("existing-accepts", existingPage, async () => {
      await openApp(existingPage, "/app/pozvanky");
      await existingPage.getByTestId("invite-card").getByTestId("invite-accept").click();
      await expect(existingPage.getByTestId("invite-accepted")).toBeVisible();
    });

    // 8 · A second company invites the same person, who owns a company too → declined.
    await step("second-company-invites", existingPage, async () => {
      const other = await newPage(browser, variant, errors);
      try {
        await signIn(other.page, otherOwner);
        await openApp(other.page, "/app/firma");
        await other.page.getByRole("button", { name: exact(L, "workers.add") }).first().click();
        const form = other.page.getByRole("dialog", { name: t("workers.form.newTitle") });
        const choice = form.locator('[data-tutorial="worker-invite-existing"]');
        if (await choice.isVisible().catch(() => false)) {
          await choice.click();
          await form.locator("#worker-account").fill(existingProfile!.public_id!);
          await form.getByTestId("worker-find").click();
        } else {
          await form.locator("#worker-name").fill("E2E Existující");
          await form.locator("#worker-email").fill(existingProfile!.public_id!);
        }
        await form.getByRole("button", { name: CREATE }).click();
        await expect(other.page.getByRole("dialog", { name: t("workers.form.inviteSent") })).toBeVisible();
      } finally {
        await other.context.close();
      }
      await openApp(existingPage, "/app/pozvanky");
      await existingPage
        .getByTestId("invite-card")
        .first()
        .getByTestId("invite-decline")
        .or(existingPage.getByTestId("invite-card").first().getByRole("button", { name: exact(L, "invites.decline") }))
        .click();
      const confirm = existingPage.locator('[data-tutorial="confirm-dialog-confirm"]');
      if (await confirm.isVisible().catch(() => false)) await confirm.click();
    });

    // 9 · Rights changed while the worker works: a section appears without signing out.
    await step("rights-live", workerPage, async () => {
      if (!workerRow) throw new Error("no worker record");
      await openApp(ownerPage, `/app/firma?worker=${workerRow.id}&wtab=rights`);
      await ownerPage.getByTestId("rights-template-sales").click();
      await openApp(workerPage, "/app");
      await expect(workerPage.getByRole("link", { name: t("nav.pipeline") }).first()).toBeVisible({ timeout: 40_000 });
    });

    // 10 · Under another manager.
    await step("move-under-manager", ownerPage, async () => {
      await openApp(ownerPage, "/app/firma");
      await ownerPage
        .getByRole("button", { name: t("workers.company.actions", { name: "E2E Nováček" }) })
        .first()
        .click();
      await ownerPage.getByRole("menuitem", { name: t("workers.company.moveMenu") }).click();
      await ownerPage.getByRole("radio", { name: /E2E Existující/ }).click();
      await snap(ownerPage, "move-dialog");
      await ownerPage.getByRole("dialog").getByRole("button", { name: /.+/ }).last().click();
    });

    // 11 · The worker leaves on their own.
    await step("worker-leaves", workerPage, async () => {
      await openApp(workerPage, "/app/nastaveni/ucet");
      await workerPage.getByTestId("leave-company").first().click();
      await snap(workerPage, "leave-confirm");
      await workerPage.locator('[data-tutorial="confirm-dialog-confirm"]').click();
      await waitForApp(workerPage);
    });

    // 12 · The owner removes the other one.
    await step("owner-removes", ownerPage, async () => {
      const { data: row } = await db
        .from("workers")
        .select("id")
        .eq("owner_id", owner.id)
        .eq("user_id", existing.id)
        .maybeSingle();
      if (!row) throw new Error("no record of the existing account");
      await openApp(ownerPage, `/app/firma?worker=${row.id}`);
      await ownerPage.getByTestId("worker-dashboard").getByTestId("worker-remove").click();
      await snap(ownerPage, "remove-dialog");
      await ownerPage.getByTestId("worker-remove-confirm").click();
    });

    // 13 · What stays: tasks, messages, rewards, the former people.
    for (const [name, route] of [
      ["after-company", "/app/firma"],
      ["after-ended", "/app/firma?status=ended"],
      ["after-rewards", "/app/firma?tab=rewards"],
      ["after-groups", "/app/firma?tab=groups"],
      ["after-messages", "/app/zpravy"],
      ["after-tasks", "/app/ukoly-crm"],
    ] as const) {
      await step(name, ownerPage, async () => {
        await openApp(ownerPage, route);
      });
    }
    await step("after-rewards-former", ownerPage, async () => {
      await openApp(ownerPage, "/app/firma?tab=rewards");
      const former = ownerPage.getByTestId("rewards-show-former");
      if (!(await former.isVisible().catch(() => false))) return "no Show former switch";
      await former.click();
      await expect(ownerPage.getByTestId("worker-former").first()).toBeVisible();
    });

    // 14 · The same person invited again.
    await step("reinvite-same-email", ownerPage, async () => {
      await openApp(ownerPage, "/app/firma");
      await ownerPage.getByRole("button", { name: exact(L, "workers.add") }).first().click();
      const form = ownerPage.getByRole("dialog", { name: t("workers.form.newTitle") });
      const choice = form.locator('[data-tutorial="worker-invite-new"]');
      if (await choice.isVisible().catch(() => false)) await choice.click();
      await form.locator("#worker-name").fill("E2E Nováček");
      await form.locator("#worker-email").fill(workerEmail);
      await form.getByRole("button", { name: CREATE }).click();
      await expect(
        ownerPage
          .getByRole("dialog", { name: t("workers.form.inviteSent") })
          .or(ownerPage.getByRole("dialog", { name: t("workers.form.inviteReady") })),
      ).toBeVisible();
    });

    writeFileSync(
      path.join(OUT, `${TAG}-${variant.name}-steps.json`),
      `${JSON.stringify({ log, consoleErrors: errors.slice(0, 40) }, null, 2)}\n`,
    );
    for (const side of [boss, workerSide, existingSide]) await side.context.close();
  });
}
