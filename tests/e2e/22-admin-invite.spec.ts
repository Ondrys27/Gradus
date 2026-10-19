import { createHash } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { admin, e2eEmail, e2ePassword, type Account } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { totp } from "./support/totp";

/**
 * Administrators (step 14.4): the owner invites someone, the link leads to a
 * new account, the authenticator and /admin. While the TOTP step is still
 * open, a second account cannot be created on the same link; once accepted,
 * the link fails altogether. The admin does not see the Administrators
 * section. Once removed, the admin is out on the very next request. An e-mail
 * that already exists is said only a few times before the attempt limit.
 *
 * Contexts that make failed attempts on purpose send their own address
 * (x-forwarded-for), so the pause they start never blocks the other tests.
 */

const L = "cs";

async function pinLocale(page: Page) {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000";
  await page.context().addCookies([{ name: "locale", value: L, url: baseURL }]);
}

async function inviteSignUp(page: Page, email: string, password: string) {
  await page.locator("#admin-email").fill(email);
  await page.locator("#admin-password").fill(password);
  // Waits for the answer of the server action, so an alert left from the
  // previous attempt is never mistaken for this one.
  await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().includes("/admin/pozvanka/"),
    ),
    page.getByRole("button", { name: exact(L, "admin.invite.submit.signup") }).click(),
  ]);
}

/** A fresh authenticator after the password: read the secret, enter a code, skip the backup. */
async function enrollAuthenticator(page: Page) {
  await expect(page.getByText(text(L, "admin.login.secretLabel"))).toBeVisible();
  const secret = (await page.locator("code").first().textContent())?.trim() ?? "";
  expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  await page.locator("#admin-code").fill(totp(secret));
  await page.getByRole("button", { name: exact(L, "admin.login.enrollSubmit") }).click();
  const skip = page.getByRole("button", { name: exact(L, "admin.login.backupSkip") });
  const nav = page.getByRole("link", { name: exact(L, "admin.shell.nav.ai") }).first();
  // The backup offer stays until it is skipped, then the sign-in goes on.
  await skip.click();
  await expect(nav).toBeVisible();
}

/**
 * The invited person's code: it accepts the invitation and sets the new
 * session cookies, so Next.js renders the link's page again in the same
 * answer. The backup step must survive that (not the neutral "link cannot be
 * used" message), and skipping it leads into /admin.
 */
async function acceptWithAuthenticator(page: Page) {
  await expect(page.getByText(text(L, "admin.login.secretLabel"))).toBeVisible();
  const secret = (await page.locator("code").first().textContent())?.trim() ?? "";
  expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  await page.locator("#admin-code").fill(totp(secret));
  const answer = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/admin/pozvanka/"),
  );
  await page.getByRole("button", { name: exact(L, "admin.login.enrollSubmit") }).click();
  await (await answer).finished();
  const backupTitle = page.getByRole("heading", { name: exact(L, "admin.login.backupTitle") });
  const invalidTitle = page.getByRole("heading", { name: exact(L, "admin.invite.invalidTitle") });
  await expect(backupTitle).toBeVisible();
  await expect(invalidTitle).toHaveCount(0);
  // Still there a moment later: the page rendered again and kept the step.
  await page.waitForTimeout(1_000);
  await expect(backupTitle).toBeVisible();
  await expect(invalidTitle).toHaveCount(0);
  await page.getByRole("button", { name: exact(L, "admin.login.backupSkip") }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("link", { name: exact(L, "admin.shell.nav.ai") }).first()).toBeVisible();
}

async function signInOwner(page: Page, owner: Account) {
  await pinLocale(page);
  await page.goto("/admin/prihlaseni");
  await page.locator("#admin-email").fill(owner.email);
  await page.locator("#admin-password").fill(owner.password);
  await page.getByRole("button", { name: exact(L, "admin.login.submit") }).click();
  await enrollAuthenticator(page);
}

/** A random documentation address (TEST-NET-2), different for each context. */
function randomIp() {
  return `198.51.100.${1 + Math.floor(Math.random() * 254)}`;
}

async function freshPage(browser: Browser, ip?: string) {
  const context = await browser.newContext({
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    ...(ip ? { extraHTTPHeaders: { "x-forwarded-for": ip } } : {}),
  });
  const page = await context.newPage();
  await pinLocale(page);
  return page;
}

test("22 · an invitation makes a new admin, works once, and removal locks them out", async ({
  page,
  browser,
  accounts,
}) => {
  const owner = await accounts.create({ label: "invowner" });
  const { error: roleError } = await admin()
    .from("user_roles")
    .insert({ user_id: owner.id, role: "owner" });
  if (roleError) throw roleError;

  // The owner creates the invitation; the link is shown once.
  await signInOwner(page, owner);
  await page.getByRole("link", { name: exact(L, "admin.shell.nav.admins") }).first().click();
  await expect(page).toHaveURL(/\/admin\/administratori$/);
  await page.getByRole("button", { name: exact(L, "admin.admins.invite.open") }).click();
  const adminEmail = e2eEmail("invadmin");
  accounts.register(adminEmail);
  await page.locator("#invite-email").fill(adminEmail);
  await page.getByRole("button", { name: exact(L, "admin.admins.invite.create") }).click();
  const link = page.getByTestId("admin-invite-link");
  await expect(link).toBeVisible();
  await expect(page.getByText(text(L, "admin.admins.invite.emailHint"))).toBeVisible();
  const invitePath = new URL((await link.textContent())?.trim() ?? "").pathname;
  expect(invitePath).toMatch(/^\/admin\/pozvanka\/[A-Za-z0-9_-]{43}$/);

  // The invited person: a new account, the authenticator, then /admin.
  const invited = await freshPage(browser);
  await invited.goto(invitePath);
  await expect(
    invited.getByRole("heading", { name: exact(L, "admin.invite.title", { appName: "Gradus" }) }),
  ).toBeVisible();
  await inviteSignUp(invited, adminEmail, e2ePassword());
  await expect(invited.getByText(text(L, "admin.login.secretLabel"))).toBeVisible();

  // Before the invited person finishes the code, the link still opens, but a
  // second new account on it is refused with the neutral message.
  const tokenHash = createHash("sha256").update(invitePath.split("/").pop() ?? "").digest("hex");
  const claimed = await admin()
    .from("admin_invites")
    .select("claimed_by, accepted_at")
    .eq("token_hash", tokenHash)
    .single();
  if (claimed.error) throw claimed.error;
  expect(claimed.data.claimed_by).not.toBeNull();
  expect(claimed.data.accepted_at).toBeNull();
  const intruder = await freshPage(browser, randomIp());
  const intruderEmail = e2eEmail("invintruder");
  accounts.register(intruderEmail);
  await intruder.goto(invitePath);
  await inviteSignUp(intruder, intruderEmail, e2ePassword());
  await expect(intruder.getByText(text(L, "admin.login.errors.inviteInvalid"))).toBeVisible();
  await expect(intruder.getByText(text(L, "admin.login.secretLabel"))).toHaveCount(0);
  await intruder.context().close();
  const after = await admin()
    .from("admin_invites")
    .select("claimed_by")
    .eq("token_hash", tokenHash)
    .single();
  expect(after.data?.claimed_by).toBe(claimed.data.claimed_by);

  // An e-mail that already exists (on a second, unclaimed link): said a few times, then the pause.
  const taken = await accounts.create({ label: "invtaken" });
  await page.goto("/admin/administratori");
  await page.getByRole("button", { name: exact(L, "admin.admins.invite.open") }).click();
  await page.getByRole("button", { name: exact(L, "admin.admins.invite.create") }).click();
  const secondLink = page.getByTestId("admin-invite-link");
  await expect(secondLink).toBeVisible();
  const secondPath = new URL((await secondLink.textContent())?.trim() ?? "").pathname;
  const secondHash = createHash("sha256").update(secondPath.split("/").pop() ?? "").digest("hex");
  try {
    const prober = await freshPage(browser, randomIp());
    await prober.goto(secondPath);
    const emailTaken = prober.getByText(text(L, "admin.login.errors.emailTaken"));
    const lockedPrefix = text(L, "admin.login.errors.locked").split("{")[0];
    const locked = prober.getByText(lockedPrefix);
    // Five failures start the pause: four answers say the e-mail exists, the fifth is the pause.
    for (let attempt = 1; attempt <= 4; attempt++) {
      await inviteSignUp(prober, taken.email, e2ePassword());
      await expect(emailTaken).toBeVisible();
    }
    await inviteSignUp(prober, taken.email, e2ePassword());
    await expect(locked).toBeVisible();
    await expect(emailTaken).toHaveCount(0);
    await prober.context().close();
  } finally {
    // Nobody is meant to use the second link; close it.
    await admin()
      .from("admin_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", secondHash)
      .is("accepted_at", null);
  }

  await acceptWithAuthenticator(invited);

  // The admin does not see the Administrators section, and its address is a 404.
  await expect(invited.getByRole("link", { name: exact(L, "admin.shell.nav.admins") })).toHaveCount(0);
  const hidden = await invited.goto("/admin/administratori");
  expect(hidden?.status()).toBe(404);

  // The same link a second time: one neutral message.
  const second = await freshPage(browser);
  await second.goto(invitePath);
  await expect(second.getByRole("heading", { name: exact(L, "admin.invite.invalidTitle") })).toBeVisible();
  await expect(second.locator("#admin-email")).toHaveCount(0);
  await second.context().close();

  // The owner sees the new admin and removes them.
  await page.goto("/admin/administratori");
  const row = page.getByTestId("admin-member").filter({ hasText: adminEmail });
  await expect(row).toContainText(text(L, "admin.admins.role.admin"));
  await expect(row).toContainText(text(L, "admin.admins.status.active"));
  // Removing sits at the end of the member's history, so the history opens first.
  await row.locator("summary").click();
  await row.getByRole("button", { name: exact(L, "admin.admins.remove.open") }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: exact(L, "admin.admins.remove.confirm") })
    .click();
  await expect(row).toContainText(text(L, "admin.admins.status.removed"));

  // The removed admin's next request leads out of the administration.
  await invited.goto("/admin/rust");
  await expect(invited).toHaveURL(/\/admin\/prihlaseni/);
  await invited.context().close();
});
