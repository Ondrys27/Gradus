import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { toSiteLocale, type SiteLocale } from "@/lib/routes";
import { parseAdminRole, type AdminRole } from "../roles";

/**
 * The Account card of a user's detail (support, step 22.1): the sign-in
 * e-mail, when the account was made and last signed in, the device of its
 * last visit, and what the support actions need (roles, language). Read on
 * the server after the guard; the e-mail is shown to the administration only.
 */

export type UserAccount = {
  email: string | null;
  emailConfirmed: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  /** The newest app session: device and browser classes, never the User-Agent. */
  lastDevice: { device: string; browser: string; at: string } | null;
  roles: AdminRole[];
  locale: SiteLocale;
};

export async function loadUserAccount(userId: string): Promise<UserAccount | null> {
  const admin = createAdminClient();
  const [user, session, roles, settings] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin
      .from("app_sessions")
      .select("device, browser, last_seen_at")
      .eq("user_id", userId)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadAdminRoles(userId),
    admin.from("user_settings").select("locale").eq("user_id", userId).maybeSingle(),
  ]);
  const account = user.data.user;
  if (user.error || !account) return null;
  const metadataLocale = (account.user_metadata as Record<string, unknown> | null)?.locale;
  return {
    email: account.email?.trim() || null,
    emailConfirmed: Boolean(account.email_confirmed_at),
    createdAt: account.created_at,
    lastSignInAt: account.last_sign_in_at ?? null,
    lastDevice: session.data
      ? { device: session.data.device, browser: session.data.browser, at: session.data.last_seen_at }
      : null,
    roles,
    locale: toSiteLocale(
      settings.data?.locale ?? (typeof metadataLocale === "string" ? metadataLocale : null),
    ),
  };
}

/** The account's roles in the administration, from user_roles. */
export async function loadAdminRoles(userId: string): Promise<AdminRole[]> {
  const { data, error } = await createAdminClient()
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(`user_roles: ${error.message}`);
  return (data ?? []).flatMap((row) => {
    const role = parseAdminRole(row.role);
    return role ? [role] : [];
  });
}

export type UserReport = {
  id: string;
  kind: string;
  status: string;
  code: string | null;
  description: string | null;
  createdAt: string;
};

/** The account's own bug reports and ideas from the Report a problem dialog, newest first. */
export async function loadUserReports(userId: string, limit = 20): Promise<UserReport[]> {
  const { data, error } = await createAdminClient()
    .from("bug_reports")
    .select("id, kind, status, error_code, description, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`bug_reports: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    code: row.error_code,
    description: row.description,
    createdAt: row.created_at,
  }));
}
