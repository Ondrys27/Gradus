import { integrationKeyState } from "@/features/scheduler/server/crypto";

/**
 * Which environment variables the server needs, for Administration → Health.
 * Presence only: a value, or its length, never leaves this module. A
 * variable may have alternatives (the older name of the same key); it counts
 * as set when any of them is.
 */

export type EnvCheck = {
  name: string;
  /** Key of `admin.health.env.purposes`. */
  purpose: string;
  /** A missing required one breaks the app; an optional one only a feature. */
  required: boolean;
  alternatives?: string[];
};

export const ENV_CHECKS: readonly EnvCheck[] = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", purpose: "supabaseUrl", required: true },
  {
    name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    purpose: "supabasePublic",
    required: true,
    alternatives: ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
  },
  {
    name: "SUPABASE_SECRET_KEY",
    purpose: "supabaseSecret",
    required: true,
    alternatives: ["SUPABASE_SERVICE_ROLE_KEY"],
  },
  { name: "NEXT_PUBLIC_SITE_URL", purpose: "siteUrl", required: true },
  { name: "CRON_SECRET", purpose: "cron", required: true },
  { name: "ANTHROPIC_API_KEY", purpose: "anthropic", required: true },
  { name: "RESEND_API_KEY", purpose: "resend", required: true },
  { name: "RESEND_FROM", purpose: "resendFrom", required: true },
  { name: "OWNER_EMAIL", purpose: "ownerEmail", required: true },
  { name: "INTEGRATIONS_ENCRYPTION_KEY", purpose: "encryption", required: true },
  { name: "GOOGLE_MAPS_API_KEY", purpose: "googleMaps", required: false },
  { name: "GOOGLE_CLIENT_ID", purpose: "googleClientId", required: false },
  { name: "GOOGLE_CLIENT_SECRET", purpose: "googleClientSecret", required: false },
  { name: "STRIPE_SECRET_KEY", purpose: "stripeSecret", required: false },
  { name: "STRIPE_WEBHOOK_SECRET", purpose: "stripeWebhook", required: false },
  { name: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", purpose: "stripePublishable", required: false },
];

export type EnvState = "ok" | "missing" | "invalid";

export type EnvRow = {
  name: string;
  purpose: string;
  required: boolean;
  state: EnvState;
};

const ENCRYPTION_KEY = "INTEGRATIONS_ENCRYPTION_KEY";

function present(env: Record<string, string | undefined>, name: string): boolean {
  return (env[name] ?? "").trim().length > 0;
}

/**
 * The state of every variable. The encryption key is also checked for shape
 * (`integrationKeyState` reads it from the process environment, which is
 * what `env` is on the server; a test passes `keyState`).
 */
export function envHealth(
  env: Record<string, string | undefined>,
  keyState: () => "ok" | "missing" | "invalid" = integrationKeyState,
): EnvRow[] {
  return ENV_CHECKS.map((check) => {
    const set = [check.name, ...(check.alternatives ?? [])].some((name) => present(env, name));
    let state: EnvState = set ? "ok" : "missing";
    if (check.name === ENCRYPTION_KEY) state = keyState();
    return { name: check.name, purpose: check.purpose, required: check.required, state };
  });
}
