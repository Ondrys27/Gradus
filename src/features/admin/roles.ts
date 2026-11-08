/**
 * Who may do what in the administration. Both roles pass the same gate
 * (password, TOTP, live admin session); a few things stay with the owner.
 * The database checks the same in its admin_* functions; this decides what
 * the pages show, so an admin never sees a control they cannot use.
 * The full table is in docs/admin-roles.md.
 */

export type AdminRole = "owner" | "admin";

export type OwnerOnly =
  /** The Administrators section: invitations, removal, history. */
  | "manageAdmins"
  /** AI caps and per-user exceptions; an admin reads them. */
  | "editAiCaps"
  /** The connection test of Jarvis and the rules' "Try it" (one paid model call each); an admin does not see them. */
  | "testJarvis"
  /** Jarvis's rules (switches, timing, the owner's instructions); an admin reads them. */
  | "editJarvisRules"
  /** The plan catalog: draft, publishing, bringing back a version; an admin reads it. */
  | "editPlans"
  /** An account's subscription set by hand (until payments exist); an admin reads it. */
  | "editSubscriptions"
  /** Partner payouts approved and marked paid; an admin reads them. */
  | "managePayouts"
  /**
   * A changed sign-in e-mail of an account (support): with a password reset
   * after it, it hands the account to whoever owns the new address, so only
   * the owner starts it; an admin sends resets and confirmations.
   */
  | "changeEmails"
  /** Where the error e-mails go and how often, the test e-mail; an admin reads it. */
  | "editErrorAlerts"
  /** Exports whose rows name people (names, e-mails, account ids). */
  | "exportPersonalData";

export function parseAdminRole(value: unknown): AdminRole | null {
  return value === "owner" || value === "admin" ? value : null;
}

/** Owner-only things are the owner's; everything else in the administration is both roles'. */
export function adminCan(role: AdminRole, what: OwnerOnly): boolean {
  void what;
  return role === "owner";
}

/**
 * Chart and table exports (`table.<page>.<table>.csv`) whose rows name
 * people. The audit export (`audit`), the list of accounts with their
 * e-mails (`users`) and the payouts of a promo code with its partner
 * (`promo_payouts`) name people too.
 */
export const PERSONAL_DATA_EXPORTS: ReadonlySet<string> = new Set([
  "table.ai.top_users.csv",
  // The owners of the costliest spaces, by name.
  "table.ai.top_spaces.csv",
  "audit",
  "users",
  // Partner payouts for the accountant: the partner's name and e-mail.
  "promo_payouts",
]);

export function mayExport(role: AdminRole, target: string): boolean {
  return !PERSONAL_DATA_EXPORTS.has(target) || adminCan(role, "exportPersonalData");
}

/**
 * Why the support actions of a user's detail (password reset, a new
 * confirmation link, sign out everywhere, a changed e-mail) are not offered
 * for an account, or null when they are. Both roles may help an ordinary
 * account; nobody helps themselves this way (their own settings do it), and
 * an account that enters the administration is the owner's to help, never
 * another admin's: whoever changes an e-mail and resets a password could
 * take the account over.
 */
export type AccountSupportBlock = "self" | "privileged";

export function accountSupportBlock(
  actor: { userId: string; role: AdminRole },
  target: { id: string; roles: readonly AdminRole[] },
): AccountSupportBlock | null {
  if (actor.userId === target.id) return "self";
  if (target.roles.includes("owner")) return "privileged";
  if (target.roles.includes("admin") && actor.role !== "owner") return "privileged";
  return null;
}
