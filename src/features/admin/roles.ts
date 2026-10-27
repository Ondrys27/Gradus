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
  /** The plan catalog: draft, publishing, bringing back a version; an admin reads it. */
  | "editPlans"
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
 * people. The audit export (`audit`) names people too.
 */
export const PERSONAL_DATA_EXPORTS: ReadonlySet<string> = new Set([
  "table.ai.top_users.csv",
  "audit",
]);

export function mayExport(role: AdminRole, target: string): boolean {
  return !PERSONAL_DATA_EXPORTS.has(target) || adminCan(role, "exportPersonalData");
}
