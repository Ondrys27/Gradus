import "server-only";

/**
 * PUBLIC_SIGNUP_ENABLED, read only on the server.
 * true: anyone can register from the website and gets a 14-day trial.
 * false (default): registration needs an invite code; the website offers the waitlist.
 */
export function isPublicSignupEnabled(): boolean {
  return process.env.PUBLIC_SIGNUP_ENABLED?.trim().toLowerCase() === "true";
}
