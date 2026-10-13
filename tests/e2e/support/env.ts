import { loadEnvConfig } from "@next/env";

/**
 * Loads .env and .env.local the same way Next.js does, so the tests see the
 * same configuration as the dev server they run against. Values are only
 * read by code, never printed.
 */
loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

export function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function requiredEnv(...names: string[]): string {
  for (const name of names) {
    const value = env(name);
    if (value) return value;
  }
  throw new Error(`Missing environment variable: ${names.join(" or ")}`);
}

export const publicSignupEnabled = env("PUBLIC_SIGNUP_ENABLED")?.toLowerCase() === "true";
