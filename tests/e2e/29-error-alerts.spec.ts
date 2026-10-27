import type { Page } from "@playwright/test";
import { admin, signIn, type Account } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { exact } from "./support/i18n";

/**
 * E-mail to the owner about every error (step 16.2): an error in the browser
 * and an error of a server component are both stored in error_events (the
 * page without ids, the message, the session's user, the browser class) and
 * then handed to the e-mail with the expected subject and content. The test
 * accounts outside production get the mock transport: the message is kept
 * on its error_alert_sends row instead of going to Resend, so the owner's
 * real inbox and the real flood limits stay untouched. A tag in the message
 * gives every run its own fingerprint (no 15-minute hold from an earlier run).
 */

const L = "cs";
const CRASH_PATH = "/app/test-chyby";
const CRASH_MESSAGE = "Gradus crash test";

test.use({ reducedMotion: "reduce" });

type EventRow = {
  id: string;
  code: string;
  source: string;
  page: string;
  message: string;
  digest: string | null;
  user_id: string | null;
  browser: string | null;
  device: string | null;
  transport: string;
  alert: string;
};
type SendRow = {
  kind: string;
  transport: string;
  status: string;
  recipients: number;
  message: { to: string[]; subject: string; text: string } | null;
};

const EVENT_COLUMNS =
  "id, code, source, page, message, digest, user_id, browser, device, transport, alert";

function randomTag() {
  return Array.from({ length: 10 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join("");
}

/** The configured addresses; without one nothing is sent and the e-mail part cannot be checked. */
async function alertSettings(): Promise<{ emails: string[]; mode: string }> {
  const { data, error } = await admin()
    .from("app_settings")
    .select("value")
    .eq("key", "error_alerts")
    .maybeSingle();
  if (error) throw error;
  const value = (data?.value ?? {}) as { emails?: string[]; mode?: string };
  return { emails: value.emails ?? [], mode: value.mode ?? "every" };
}

async function pollEvents(
  filter: (query: ReturnType<typeof eventsQuery>) => ReturnType<typeof eventsQuery>,
) {
  let found: EventRow[] = [];
  await expect
    .poll(
      async () => {
        const { data, error } = await filter(eventsQuery());
        if (error) throw error;
        found = (data ?? []) as EventRow[];
        return found.length;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  return found;
}
function eventsQuery() {
  return admin().from("error_events").select(EVENT_COLUMNS);
}

async function pollSend(eventId: string): Promise<SendRow> {
  let found: SendRow | null = null;
  await expect
    .poll(
      async () => {
        const { data, error } = await admin()
          .from("error_alert_sends")
          .select("kind, transport, status, recipients, message")
          .eq("event_id", eventId)
          .maybeSingle();
        if (error) throw error;
        found = (data as SendRow | null) ?? null;
        return found?.status ?? "none";
      },
      { timeout: 30_000 },
    )
    .toBe("sent");
  return found!;
}

/** The checks of one mock e-mail: subject, the error's facts, the user, nothing missing. */
function expectAlert(
  send: SendRow,
  emails: string[],
  event: EventRow,
  account: Account,
  tag: string,
) {
  expect(send).toMatchObject({ kind: "error", transport: "mock", recipients: emails.length });
  expect(send.message?.to).toEqual(emails);
  expect(send.message?.subject).toBe(`[Gradus] ${subjectWord()} ${event.code} · ${CRASH_PATH}`);
  const text = send.message?.text ?? "";
  for (const part of [
    event.code,
    CRASH_PATH,
    `${CRASH_MESSAGE} ${tag}`,
    "Europe/Prague",
    "UTC",
    account.email,
    account.id,
  ]) {
    expect(text, part).toContain(part);
  }
}

let ownerLocale: string | null = null;
/** "Chyba" or "Error": the e-mail is in the owner's language. */
function subjectWord() {
  return ownerLocale === "en" ? "Error" : "Chyba";
}
async function readOwnerLocale() {
  const db = admin();
  const { data: role } = await db
    .from("user_roles")
    .select("user_id")
    .eq("role", "owner")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!role) return null;
  const { data } = await db
    .from("user_settings")
    .select("locale")
    .eq("user_id", role.user_id)
    .maybeSingle();
  return data?.locale ?? null;
}

async function cleanUp(codes: string[]) {
  if (!codes.length) return;
  const db = admin();
  const { data } = await db.from("error_events").select("id").in("code", codes);
  const ids = (data ?? []).map((row) => row.id);
  if (ids.length) {
    await db.from("error_alert_sends").delete().in("event_id", ids);
    await db.from("error_events").delete().in("id", ids);
  }
}

async function crashCode(page: Page) {
  await expect(page.getByRole("heading", { name: exact(L, "errorPage.title") })).toBeVisible();
  const code = (await page.getByTestId("error-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^GR-[A-Z0-9]{6}$/);
  return code;
}

/** The crash is the point of the test: its own console messages are expected, nothing else. */
function dropExpectedCrashErrors(errors: string[]) {
  for (let index = errors.length - 1; index >= 0; index -= 1) {
    const error = errors[index]!;
    if (error.includes(CRASH_MESSAGE) || error.includes(CRASH_PATH)) errors.splice(index, 1);
  }
}

test("29 · a browser error is recorded and e-mailed with its facts", async ({
  page,
  accounts,
  consoleErrors,
}) => {
  const settings = await alertSettings();
  test.skip(settings.emails.length === 0, "no addresses in app_settings.error_alerts");
  test.skip(settings.mode !== "every", "the digest mode may hold the e-mail for the summary");
  ownerLocale = await readOwnerLocale();
  const account = await accounts.create({ label: "error-alerts" });
  const tag = randomTag();
  const codes: string[] = [];
  try {
    await signIn(page, account);
    await page.goto(`${CRASH_PATH}?tag=${tag}`);
    const code = await crashCode(page);
    codes.push(code);

    // The record: the session's user, the page, the browser class, the mock transport.
    const [event] = await pollEvents((query) => query.eq("code", code));
    expect(event).toMatchObject({
      code,
      source: "boundary",
      page: CRASH_PATH,
      message: `Error: ${CRASH_MESSAGE} ${tag}`,
      user_id: account.id,
      browser: "chrome",
      device: "desktop",
      transport: "mock",
    });

    // The e-mail, as it would have gone to Resend.
    const send = await pollSend(event!.id);
    expectAlert(send, settings.emails, event!, account, tag);
    const { data: after } = await admin()
      .from("error_events")
      .select("alert")
      .eq("id", event!.id)
      .single();
    expect(after?.alert).toBe("sent");
  } finally {
    dropExpectedCrashErrors(consoleErrors);
    await cleanUp(codes);
  }
});

test("29 · a server component's error is recorded by the server and e-mailed once", async ({
  page,
  accounts,
  consoleErrors,
}) => {
  const settings = await alertSettings();
  test.skip(settings.emails.length === 0, "no addresses in app_settings.error_alerts");
  test.skip(settings.mode !== "every", "the digest mode may hold the e-mail for the summary");
  ownerLocale = await readOwnerLocale();
  const account = await accounts.create({ label: "error-alerts-server" });
  const tag = randomTag();
  const codes: string[] = [];
  try {
    await signIn(page, account);
    await page.goto(`${CRASH_PATH}?server=1&tag=${tag}`);
    codes.push(await crashCode(page));

    // instrumentation.ts recorded the render error with the user from the cookies.
    const events = await pollEvents((query) =>
      query.eq("source", "render").eq("message", `Error: ${CRASH_MESSAGE} ${tag}`),
    );
    codes.push(...events.map((row) => row.code));
    const [event] = events;
    expect(event).toMatchObject({ page: CRASH_PATH, user_id: account.id, transport: "mock" });
    expect(event!.digest).toMatch(/^[A-Za-z0-9_@-]+$/);

    const send = await pollSend(event!.id);
    expectAlert(send, settings.emails, event!, account, tag);
  } finally {
    dropExpectedCrashErrors(consoleErrors);
    // The browser's own copy (same digest) goes with it.
    const { data } = await admin().from("error_events").select("code").eq("user_id", account.id);
    await cleanUp([...codes, ...(data ?? []).map((row) => row.code)]);
  }
});
