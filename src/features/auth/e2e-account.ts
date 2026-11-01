const E2E_EMAIL = /^e2e-[a-z0-9-]+@gradus\.local$/i;

/**
 * The end-to-end tests' own accounts (e2e-…@gradus.local) outside production.
 * They have no inbox, so they are confirmed at sign-up even while Supabase asks
 * new accounts to confirm their e-mail; in production they are like any other.
 */
export function isE2eTestAccount(
  email: string,
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
): boolean {
  return vercelEnv !== "production" && E2E_EMAIL.test(email.trim());
}
