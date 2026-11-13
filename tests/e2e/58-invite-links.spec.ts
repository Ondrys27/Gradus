import type { Browser, Page } from "@playwright/test";
import { admin, e2eEmail, e2ePassword, signIn, type Account } from "./support/accounts";
import { expect, test, watchConsole } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { openApp } from "./support/ui";

/**
 * 27.1: a worker invite link is used up only by a finished registration or
 * an acceptance, never by opening it. The paths from the meeting of 13. 11.:
 * opened by the owner who is signed in, by another signed-in account, twice,
 * by an e-mail scanner before the person, after the owner invited the same
 * e-mail again, and for an e-mail that already has an account. A link that
 * no longer works says why and can ask the owner for a new one.
 */

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

test.use({ reducedMotion: "reduce" });

/** "Invite a worker" with an e-mail; returns the link the dialog shows (empty for an account). */
async function invite(page: Page, name: string, email: string): Promise<string> {
  await openApp(page, "/app/firma");
  await page
    .getByRole("button", { name: exact(L, "workers.add") })
    .first()
    .click();
  const form = page.getByRole("dialog", { name: t("workers.form.newTitle") });
  await form.locator("#worker-name").fill(name);
  await form.locator("#worker-email").fill(email);
  await form.getByRole("button", { name: exact(L, "workers.form.create") }).click();
  const ready = page.getByRole("dialog", { name: t("workers.form.inviteReady") });
  const sent = page.getByRole("dialog", { name: t("workers.form.inviteSent") });
  await expect(ready.or(sent)).toBeVisible();
  let link = "";
  if (await ready.isVisible()) {
    link = await ready.getByRole("textbox", { name: t("workers.invite.link") }).inputValue();
    expect(link).toMatch(/invite=[0-9a-f]{12,32}$/);
    await ready.getByRole("button", { name: exact(L, "workers.form.done") }).click();
  } else {
    await sent.getByRole("button", { name: exact(L, "workers.form.done") }).click();
  }
  return link;
}

const codeOf = (link: string) => new URL(link).searchParams.get("invite")!;

/** A link as a path on the test server (the dialog's origin may be the configured site). */
const pathOf = (link: string) => {
  const url = new URL(link);
  return `${url.pathname}${url.search}`;
};

async function inviteRow(code: string) {
  const { data, error } = await admin()
    .from("worker_invites")
    .select("accepted_at, accepted_by, replaced_at, worker_id")
    .eq("code", code)
    .single();
  if (error) throw error;
  return data;
}

async function freshContext(browser: Browser, consoleErrors: string[]) {
  const context = await browser.newContext({ locale: "cs-CZ", timezoneId: "Europe/Prague", reducedMotion: "reduce" });
  watchConsole(context, consoleErrors);
  return context;
}

test("58a · owner, another account, twice and a scanner: opening never uses the invite; registration does", async ({
  page,
  request,
  browser,
  accounts,
  consoleErrors,
}) => {
  const boss = await accounts.create({ label: "links-boss" });
  const other = await accounts.create({ label: "links-other" });
  const newEmail = e2eEmail("links-new");
  accounts.register(newEmail);

  await signIn(page, boss);
  const link = await invite(page, "E2E Odkaz", newEmail);
  const code = codeOf(link);

  // An e-mail client's preview or security scan visits the link first, twice, with HEAD too.
  for (const method of ["GET", "GET", "HEAD"] as const) {
    // The test's own request context: no cookies, like a scanner.
    const response = await request.fetch(pathOf(link), {
      method,
      maxRedirects: 0,
      headers: { "user-agent": "Mozilla/5.0 (compatible; SafeLinksPreview/1.0)" },
    });
    expect(response.status()).toBeLessThan(500);
  }
  expect((await inviteRow(code)).accepted_at).toBeNull();

  // The owner, still signed in, opens their own link: whose it is, nothing used up.
  await page.goto(pathOf(link));
  await expect(page).toHaveURL(/\/app\/pozvanky\?kod=/);
  const notice = page.getByTestId("invite-other-account");
  await expect(notice.getByTestId("invite-other-current")).toHaveText(t("auth.inviteLink.otherTitle", { current: boss.email }));
  await expect(notice.getByTestId("invite-other-target")).toHaveText(t("auth.inviteLink.otherFor", { target: newEmail }));
  await notice.getByTestId("invite-stay").click();
  await expect(page).toHaveURL(/\/app\/pozvanky$/);
  expect((await inviteRow(code)).accepted_at).toBeNull();

  // Another signed-in account: the same notice; Sign out and continue leads to the registration.
  const otherContext = await freshContext(browser, consoleErrors);
  const otherPage = await otherContext.newPage();
  try {
    await signIn(otherPage, other);
    await otherPage.goto(pathOf(link));
    const otherNotice = otherPage.getByTestId("invite-other-account");
    await expect(otherNotice.getByTestId("invite-other-current")).toContainText(other.email);
    await otherNotice.getByTestId("invite-sign-out-continue").click();
    await expect(otherPage).toHaveURL(/\/registrace\?invite=/);
    await expect(otherPage.locator("#register-email")).toHaveValue(newEmail);
    // Opened twice: the form both times.
    await otherPage.reload();
    await expect(otherPage.locator("#register-email")).toHaveValue(newEmail);
    expect((await inviteRow(code)).accepted_at).toBeNull();

    // The registration uses it up.
    await otherPage.locator("#register-password").fill(e2ePassword());
    await otherPage.getByTestId("register-terms").click();
    await otherPage.locator("form button[type=submit]").click();
    await expect(otherPage).toHaveURL(/\/app(\/?$|\?)/, { timeout: 60_000 });
  } finally {
    await otherContext.close();
  }
  const used = await inviteRow(code);
  expect(used.accepted_at).not.toBeNull();
  const { data: worker } = await admin().from("workers").select("status, user_id").eq("id", used.worker_id).single();
  expect(worker).toEqual({ status: "active", user_id: used.accepted_by });

  // Afterwards the link says it was used, offers to sign in and to ask for a new one.
  const lateContext = await freshContext(browser, consoleErrors);
  const latePage = await lateContext.newPage();
  try {
    await latePage.goto(pathOf(link));
    const problem = latePage.getByTestId("invite-problem");
    await expect(problem).toHaveAttribute("data-state", "used");
    await expect(problem.getByTestId("invite-problem-text")).toHaveText(t("auth.inviteLink.problem.used"));
    await problem.getByTestId("invite-request-new").click();
    await expect(problem.getByTestId("invite-request-answer")).toHaveText(t("auth.inviteLink.requested"));
  } finally {
    await lateContext.close();
  }
  const { data: notes } = await admin()
    .from("account_notifications")
    .select("kind")
    .eq("user_id", boss.id)
    .eq("kind", "invite_requested");
  expect(notes).toHaveLength(1);
});

test("58b · a new invite to the same e-mail replaces the old one, and the old link says so", async ({
  page,
  browser,
  accounts,
  consoleErrors,
}) => {
  const boss = await accounts.create({ label: "links-again" });
  const email = e2eEmail("links-twice");
  accounts.register(email);
  await signIn(page, boss);
  const first = await invite(page, "E2E Poprvé", email);

  // Again to the same address: the dialog says the earlier one stopped working.
  await openApp(page, "/app/firma");
  await page
    .getByRole("button", { name: exact(L, "workers.add") })
    .first()
    .click();
  const form = page.getByRole("dialog", { name: t("workers.form.newTitle") });
  await form.locator("#worker-name").fill("E2E Podruhé");
  await form.locator("#worker-email").fill(email);
  await form.getByRole("button", { name: exact(L, "workers.form.create") }).click();
  const ready = page.getByRole("dialog", { name: t("workers.form.inviteReady") });
  await expect(ready.getByTestId("invite-replaced-old")).toHaveText(t("workers.invite.replacedOld"));
  const second = await ready.getByRole("textbox", { name: t("workers.invite.link") }).inputValue();
  await ready.getByRole("button", { name: exact(L, "workers.form.done") }).click();
  expect(codeOf(second)).not.toBe(codeOf(first));
  expect((await inviteRow(codeOf(first))).replaced_at).not.toBeNull();

  // The owner sees why among the ended people.
  await openApp(page, "/app/firma?status=ended");
  await expect(page.locator('[data-testid="seat-chip"][data-seat="replaced"]')).toHaveText(
    t("workers.company.seat.replaced"),
  );

  const visitor = await freshContext(browser, consoleErrors);
  const visitorPage = await visitor.newPage();
  try {
    await visitorPage.goto(pathOf(first));
    const problem = visitorPage.getByTestId("invite-problem");
    await expect(problem).toHaveAttribute("data-state", "replaced");
    await expect(problem.getByTestId("invite-problem-text")).toHaveText(t("auth.inviteLink.problem.replaced"));
    await visitorPage.goto(pathOf(second));
    await expect(visitorPage.locator("#register-email")).toHaveValue(email);
  } finally {
    await visitor.close();
  }
});

test("58c · an invite to an e-mail that has an account: sign in and accept, no registration", async ({
  page,
  browser,
  accounts,
  consoleErrors,
}) => {
  const boss = await accounts.create({ label: "links-acct-boss" });
  const person: Account = await accounts.create({ label: "links-acct-person" });
  const named = await admin().from("profiles").update({ company_name: "E2E Firma Odkaz" }).eq("id", boss.id);
  if (named.error) throw named.error;
  await signIn(page, boss);
  // The address has an account: the invite waits in that account's app, there is no link to copy.
  expect(await invite(page, "E2E Má účet", person.email)).toBe("");
  const { data: row, error } = await admin()
    .from("worker_invites")
    .select("code")
    .eq("owner_id", boss.id)
    .eq("invitee_id", person.id)
    .single();
  if (error) throw error;

  // Its code link (an older e-mail, a forwarded link) opened signed out: sign in, not register.
  const visitor = await freshContext(browser, consoleErrors);
  const visitorPage = await visitor.newPage();
  try {
    await visitorPage.goto(`/registrace?invite=${row.code}`);
    await expect(visitorPage.getByTestId("invite-sign-in")).toBeVisible();
    await expect(visitorPage.locator("#register-email")).toHaveCount(0);
    await visitorPage.getByTestId("invite-sign-in-link").click();
    await visitorPage.locator("#login-email").fill(person.email);
    await visitorPage.locator("#login-password").fill(person.password);
    await visitorPage.locator("form button[type=submit]").click();
    await expect(visitorPage).toHaveURL(/\/app\/pozvanky\?kod=/, { timeout: 30_000 });
    await expect(visitorPage.getByTestId("invite-link-accept")).toContainText("E2E Firma Odkaz");
    await visitorPage.getByTestId("invite-link-accept-button").click();
    await expect(visitorPage.getByTestId("invite-accepted")).toBeVisible();
  } finally {
    await visitor.close();
  }
  const { data: accepted } = await admin()
    .from("worker_invites")
    .select("accepted_by")
    .eq("code", row.code)
    .single();
  expect(accepted?.accepted_by).toBe(person.id);
});

test("58d · an unknown or cancelled link says so without the registration form", async ({ page, accounts }) => {
  const boss = await accounts.create({ label: "links-revoke" });
  const email = e2eEmail("links-revoked");
  await signIn(page, boss);
  const link = await invite(page, "E2E Zrušený", email);
  const { worker_id } = await inviteRow(codeOf(link));
  // The owner deletes the record: its link is revoked.
  const removed = await admin().from("workers").delete().eq("id", worker_id);
  if (removed.error) throw removed.error;

  const context = page.context();
  await context.clearCookies();
  await page.goto(pathOf(link));
  await expect(page.getByTestId("invite-problem")).toHaveAttribute("data-state", "revoked");
  await expect(page.locator("#register-email")).toHaveCount(0);
  await page.goto("/registrace?invite=ffffffffffffffffffff");
  await expect(page.getByTestId("invite-problem")).toHaveAttribute("data-state", "unknown");
  await expect(page.getByTestId("invite-request-new")).toHaveCount(0);
});
