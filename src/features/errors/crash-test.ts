/**
 * A deliberate crash for the end-to-end test of the error page
 * (tests/e2e/25-error-page.spec.ts): /app/test-chyby throws while rendering,
 * but only for the internal test accounts (@gradus.local); everyone else gets
 * a 404, in every environment. With `?later=1` it waits for CRASH_TEST_EVENT.
 */
export const CRASH_TEST_PATH = "/app/test-chyby";
export const CRASH_TEST_MESSAGE = "Gradus crash test";
/** With `?later=1` the page crashes only when the window gets this event. */
export const CRASH_TEST_EVENT = "gradus:crash-test";

export function mayUseCrashTest(email: unknown): boolean {
  return typeof email === "string" && /^[^@\s]+@gradus\.local$/i.test(email.trim());
}
