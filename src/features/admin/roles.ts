/**
 * Who may do what in the administration. Everyone passes the same gate
 * (password, TOTP, live admin session). The owner may do everything; an
 * administrator has a level (step 27.2): a full one may do everything the
 * owner may except the Administrators section, a limited one reads what the
 * full one changes. The database checks the same in its admin_* functions
 * (admin_require_owner() = owner or full administrator,
 * admin_require_sole_owner() = the owner); this decides what the pages
 * show, so nobody sees a control they cannot use.
 * The full table is in docs/admin-roles.md.
 */

export type AdminRole = "owner" | "admin";
export type AdminLevel = "full" | "limited";

/** Who is acting: the role and, for an administrator, the level (the owner is always full). */
export type AdminActor = { role: AdminRole; level: AdminLevel };

export type AdminPower =
  /** The Administrators section: invitations, levels, removal, history. The owner's alone. */
  | "manageAdmins"
  /** AI caps and per-user exceptions; a limited admin reads them. */
  | "editAiCaps"
  /** The connection test of Grady and the rules' "Try it" (one paid model call each). */
  | "testGrady"
  /** Grady's rules (switches, timing, the owner's instructions); a limited admin reads them. */
  | "editGradyRules"
  /** The plan catalog: draft, publishing, bringing back a version; a limited admin reads it. */
  | "editPlans"
  /** An account's subscription set by hand, "Sync with Stripe"; a limited admin reads it. */
  | "editSubscriptions"
  /** Partner payouts approved and marked paid; a limited admin reads them. */
  | "managePayouts"
  /**
   * A changed sign-in e-mail of an account (support): with a password reset
   * after it, it hands the account to whoever owns the new address; a
   * limited admin sends resets and confirmations only.
   */
  | "changeEmails"
  /** Where the error e-mails go and how often, the test e-mail; a limited admin reads it. */
  | "editErrorAlerts"
  /** Exports whose rows name people (names, e-mails, account ids). */
  | "exportPersonalData"
  /** The screenshot attached to a bug report (it may show anything on the user's screen). */
  | "viewScreenshots"
  /** The e-mails "X changed …" between the owner and the full admins, and switching them off. */
  | "peerNotices";

/** The powers that stay with the owner whatever an administrator's level. */
const OWNER_ALONE: ReadonlySet<AdminPower> = new Set(["manageAdmins"]);

export function parseAdminRole(value: unknown): AdminRole | null {
  return value === "owner" || value === "admin" ? value : null;
}

/** An administrator without a stored level is limited; the owner is always full. */
export function parseAdminLevel(role: AdminRole | null, value: unknown): AdminLevel {
  if (role === "owner") return "full";
  return value === "full" ? "full" : "limited";
}

/** The owner may everything; a full administrator everything but the owner's own; a limited one none of these. */
export function adminCan(actor: AdminActor | null | undefined, what: AdminPower): boolean {
  if (!actor) return false;
  if (actor.role === "owner") return true;
  if (OWNER_ALONE.has(what)) return false;
  return actor.role === "admin" && actor.level === "full";
}

/** Which of the three standings an actor has, for labels and the table in docs/admin-roles.md. */
export function adminStanding(actor: AdminActor): "owner" | "full" | "limited" {
  return actor.role === "owner" ? "owner" : actor.level;
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

export function mayExport(actor: AdminActor | null | undefined, target: string): boolean {
  return !PERSONAL_DATA_EXPORTS.has(target) || adminCan(actor, "exportPersonalData");
}

/**
 * Why the support actions of a user's detail (password reset, a new
 * confirmation link, sign out everywhere, a changed e-mail) are not offered
 * for an account, or null when they are. Both roles may help an ordinary
 * account; nobody helps themselves this way (their own settings do it), and
 * an account that enters the administration is the owner's to help, never
 * another admin's, whatever their level (managing administrators is the
 * owner's alone): whoever changes an e-mail and resets a password could
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
