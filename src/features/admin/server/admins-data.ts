import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseAdminRole, type AdminRole } from "../roles";

/**
 * The Administrators section (owner only): the owner and every admin, active
 * or removed, with their sign-ins and admin sessions, and the invitations
 * still open. Read through the admin client after the owner's gate.
 */

const HISTORY_ROWS = 20;

export type AdminLogin = { at: string; ipPrefix: string | null; browser: string | null };
export type AdminSessionRow = {
  startedAt: string;
  lastSeenAt: string;
  endedAt: string | null;
};
export type AdminMember = {
  userId: string;
  role: AdminRole;
  active: boolean;
  addedAt: string;
  removedAt: string | null;
  lastLoginAt: string | null;
  logins30d: number;
  lastSeenAt: string | null;
  logins: AdminLogin[];
  sessions: AdminSessionRow[];
};
export type OpenInvite = {
  id: string;
  email: string | null;
  note: string | null;
  createdAt: string;
  expiresAt: string;
};

export async function loadAdminMembers(): Promise<AdminMember[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("admin_members");
  if (error) throw new Error(`admin_members: ${error.message}`);
  const members = (data ?? []).flatMap((row) => {
    const role = parseAdminRole(row.role);
    return role ? [{ ...row, role }] : [];
  });
  const ids = members.map((row) => row.user_id);
  if (!ids.length) return [];

  const [logins, sessions] = await Promise.all([
    admin
      .from("admin_audit")
      .select("user_id, created_at, ip_prefix, browser")
      .eq("kind", "login")
      .in("user_id", ids)
      .order("created_at", { ascending: false })
      .limit(HISTORY_ROWS * ids.length),
    admin
      .from("admin_sessions")
      .select("user_id, started_at, last_seen_at, ended_at")
      .in("user_id", ids)
      .order("started_at", { ascending: false })
      .limit(HISTORY_ROWS * ids.length),
  ]);
  if (logins.error) throw new Error(`admin_audit: ${logins.error.message}`);
  if (sessions.error) throw new Error(`admin_sessions: ${sessions.error.message}`);

  return members.map((row) => ({
    userId: row.user_id,
    role: row.role,
    active: row.active,
    addedAt: row.added_at,
    removedAt: row.removed_at,
    lastLoginAt: row.last_login_at,
    logins30d: row.logins_30d ?? 0,
    lastSeenAt: row.last_seen_at,
    logins: logins.data
      .filter((login) => login.user_id === row.user_id)
      .slice(0, HISTORY_ROWS)
      .map((login) => ({ at: login.created_at, ipPrefix: login.ip_prefix, browser: login.browser })),
    sessions: sessions.data
      .filter((session) => session.user_id === row.user_id)
      .slice(0, HISTORY_ROWS)
      .map((session) => ({
        startedAt: session.started_at,
        lastSeenAt: session.last_seen_at,
        endedAt: session.ended_at,
      })),
  }));
}

export async function loadOpenInvites(): Promise<OpenInvite[]> {
  const { data, error } = await createAdminClient()
    .from("admin_invites")
    .select("id, email, note, created_at, expires_at")
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`admin_invites: ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    email: row.email,
    note: row.note,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));
}
