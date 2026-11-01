import "server-only";
import { supabasePublicKey, supabaseUrl } from "@/lib/supabase/env";

/**
 * Whether Supabase asks new accounts to confirm their e-mail (Authentication →
 * Sign In / Providers → Confirm email). Read from the public Auth settings, so
 * the switch in Supabase is the only place to turn it on; cached for a minute.
 * When the settings cannot be read, confirmation counts as required: an
 * account is never confirmed by mistake.
 */
const CACHE_MS = 60_000;
let cached: { required: boolean; at: number } | null = null;

export async function isEmailConfirmationRequired(): Promise<boolean> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.required;
  try {
    const response = await fetch(`${supabaseUrl()}/auth/v1/settings`, {
      headers: { apikey: supabasePublicKey() },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`auth settings ${response.status}`);
    const body = (await response.json()) as { mailer_autoconfirm?: unknown };
    cached = { required: body.mailer_autoconfirm !== true, at: Date.now() };
    return cached.required;
  } catch (error) {
    console.error("[auth] reading the confirmation setting failed", error);
    return true;
  }
}

/** For tests: forget the cached setting. */
export function resetEmailConfirmationCache() {
  cached = null;
}
