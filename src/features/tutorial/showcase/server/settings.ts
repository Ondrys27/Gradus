import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { mayPresent, showcaseRole, type ShowcaseRole } from "../access";

type Client = SupabaseClient<Database>;

/**
 * The administration's switch "Showcase mode" (app_settings 'showcase_mode',
 * `{ "enabled": true }`), off when there is no row. Read by the server only
 * (admin client) and kept 30 seconds per instance like the other settings;
 * the instance that saved a change forgets its copy at once.
 */
export const SHOWCASE_SETTING_KEY = "showcase_mode";
const TTL_MS = 30_000;

let cache: { at: number; enabled: boolean } | null = null;

export function clearShowcaseSettingCache() {
  cache = null;
}

export function readShowcaseSetting(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    (value as Record<string, unknown>).enabled === true
  );
}

export async function loadShowcaseEnabled(
  admin: Client = createAdminClient(),
  now = Date.now(),
): Promise<boolean> {
  if (cache && now - cache.at <= TTL_MS) return cache.enabled;
  const { data, error } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", SHOWCASE_SETTING_KEY)
    .maybeSingle();
  if (error) {
    // A failed read keeps the mode off; it is never a reason to show it.
    console.error("[showcase] reading the switch failed", error.code);
    return false;
  }
  const enabled = readShowcaseSetting(data?.value);
  cache = { at: now, enabled };
  return enabled;
}

export const isProduction = () => process.env.VERCEL_ENV === "production";

export type ShowcaseAccess = {
  role: ShowcaseRole;
  userId: string;
  email: string;
  appMetadata: Record<string, unknown>;
};

/**
 * The signed-in account's place in the showcase, or null (then the mode does
 * not exist for it: 404). Roles come from user_roles through the user's own
 * client; the switch is read only for an account that could present.
 */
export async function loadShowcaseAccess(): Promise<ShowcaseAccess | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const email = typeof claims.email === "string" ? claims.email : "";
  const appMetadata = (claims.app_metadata ?? {}) as Record<string, unknown>;
  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", claims.sub);
  const roles = (roleRows ?? []).map((row) => row.role as string);
  const stage = appMetadata.showcase_stage === true;
  const switchOn = stage || mayPresent(roles) ? await loadShowcaseEnabled() : false;
  const role = showcaseRole({ roles, email, appMetadata, switchOn, production: isProduction() });
  return role ? { role, userId: claims.sub, email, appMetadata } : null;
}

/** For the app's session (loadAccount): the same answer from what it already read. */
export async function showcaseRoleFor(input: {
  roles: readonly string[];
  email: string;
  appMetadata: unknown;
}): Promise<ShowcaseRole | null> {
  const stage =
    !!input.appMetadata &&
    typeof input.appMetadata === "object" &&
    (input.appMetadata as Record<string, unknown>).showcase_stage === true;
  if (!stage && !mayPresent(input.roles)) return null;
  const switchOn = await loadShowcaseEnabled();
  return showcaseRole({ ...input, switchOn, production: isProduction() });
}
