/**
 * A deliberate crash for the end-to-end test of the error page
 * (tests/e2e/25-error-page.spec.ts): /app/test-chyby throws while rendering,
 * but only for the internal test accounts (@gradus.local); everyone else gets
 * a 404, in every environment. With `?later=1` it waits for CRASH_TEST_EVENT;
 * with `?server=1` it throws while the server renders it; `?tag=abc` (letters
 * only) is added to the message, so a test's error is its own (its own
 * fingerprint for the error e-mails, tests/e2e/29-error-alerts.spec.ts).
 */
export const CRASH_TEST_PATH = "/app/test-chyby";
export const CRASH_TEST_MESSAGE = "Gradus crash test";
/** With `?later=1` the page crashes only when the window gets this event. */
export const CRASH_TEST_EVENT = "gradus:crash-test";

/** The message of one crash: the fixed text, and the test's tag when it is plain letters. */
export function crashTestMessage(tag: unknown): string {
  return typeof tag === "string" && /^[a-z]{1,16}$/.test(tag)
    ? `${CRASH_TEST_MESSAGE} ${tag}`
    : CRASH_TEST_MESSAGE;
}

export function mayUseCrashTest(email: unknown): boolean {
  return typeof email === "string" && /^[^@\s]+@gradus\.local$/i.test(email.trim());
}
