/**
 * What a worker invite link says and offers (step 27.1). Pure, so the
 * registration page, the invites page and the tests share one rule:
 *
 *   * Opening a link never uses the invite up; only a finished registration
 *     or an acceptance does.
 *   * A link that no longer works says why: expired on a date, already used,
 *     declined, replaced by a newer invite, revoked by the owner, or unknown.
 *   * Signed out: the registration form, or (the invite's e-mail already has
 *     an account, or the invite waits for an account) "sign in and accept".
 *   * Signed in as the account the invite is for: accept there. As anybody
 *     else: "You are signed in as X. The invite is for Y." with Sign out and
 *     continue / Stay (and Accept as X when the invite names no e-mail).
 */

export const INVITE_LINK_STATES = [
  "open",
  "expired",
  "used",
  "declined",
  "replaced",
  "revoked",
  "unknown",
] as const;
export type InviteLinkState = (typeof INVITE_LINK_STATES)[number];
export type InviteLinkProblem = Exclude<InviteLinkState, "open">;

/** The invite row as the server reads it with the admin client. */
export type InviteLinkRow = {
  expires_at: string;
  accepted_at: string | null;
  declined_at: string | null;
  replaced_at: string | null;
};

/** A deleted invite's tombstone (worker_invite_tombstones). */
export type InviteTombstone = { reason: "revoked" | "replaced"; ended_at: string };

/** The worker record the invite is for; an ended record makes an open invite revoked. */
export type InviteWorker = { status: "invited" | "active" | "inactive"; user_id: string | null } | null;

export type InviteLinkStatus = {
  state: InviteLinkState;
  /** When it stopped working (expiry, use, replacement, revocation), for "expired on 12. 11. 2026". */
  since: string | null;
};

export function inviteLinkStatus(
  invite: InviteLinkRow | null,
  tombstone: InviteTombstone | null,
  worker: InviteWorker,
  now: Date,
): InviteLinkStatus {
  if (!invite) {
    return tombstone
      ? { state: tombstone.reason, since: tombstone.ended_at }
      : { state: "unknown", since: null };
  }
  if (invite.accepted_at) return { state: "used", since: invite.accepted_at };
  if (invite.declined_at) return { state: "declined", since: invite.declined_at };
  if (invite.replaced_at) return { state: "replaced", since: invite.replaced_at };
  // The record ended (the owner removed the person) or was taken some other way.
  if (!worker || worker.status !== "invited" || worker.user_id) return { state: "revoked", since: null };
  if (Date.parse(invite.expires_at) <= now.getTime()) {
    return { state: "expired", since: invite.expires_at };
  }
  return { state: "open", since: null };
}

/** Whether "Ask for a new one" makes sense: the owner is known and the link is not simply open. */
export function canRequestNewInvite(state: InviteLinkState): state is InviteLinkProblem {
  return state !== "open" && state !== "unknown";
}

const normalEmail = (value: string | null | undefined) => value?.trim().toLowerCase() || null;

export type InviteLinkView =
  /** Signed out, nobody has the invite's e-mail yet: the registration form. */
  | { kind: "register" }
  /** Signed out, but the invite belongs to an existing account: sign in and accept. */
  | { kind: "sign_in" }
  /** Signed in as the account the invite is for. */
  | { kind: "accept"; canDecline: boolean }
  /** Signed in as somebody else. */
  | { kind: "other_account"; canAcceptHere: boolean }
  | { kind: "problem"; state: InviteLinkProblem };

/**
 * What the page shows for a link. `invite` is what the server knows of the
 * open invite; `accountForEmail` whether an account has the invite's e-mail.
 */
export function inviteLinkView(input: {
  state: InviteLinkState;
  invite: { ownerId: string; email: string | null; inviteeId: string | null } | null;
  viewer: { id: string; email: string | null } | null;
  accountForEmail: boolean;
}): InviteLinkView {
  const { state, invite, viewer } = input;
  if (state !== "open" || !invite) {
    return { kind: "problem", state: state === "open" ? "unknown" : state };
  }
  const email = normalEmail(invite.email);
  if (!viewer) {
    return invite.inviteeId || input.accountForEmail ? { kind: "sign_in" } : { kind: "register" };
  }
  if (viewer.id === invite.ownerId) return { kind: "other_account", canAcceptHere: false };
  if (invite.inviteeId) {
    return invite.inviteeId === viewer.id
      ? { kind: "accept", canDecline: true }
      : { kind: "other_account", canAcceptHere: false };
  }
  if (email) {
    return email === normalEmail(viewer.email)
      ? { kind: "accept", canDecline: true }
      : { kind: "other_account", canAcceptHere: false };
  }
  // Nobody named: whoever holds the code may take it, like at the registration.
  return { kind: "other_account", canAcceptHere: true };
}

/**
 * The registration from an invite needs no second confirmation of the
 * e-mail when it is the very address the owner invited: the invite came
 * there. Any other registration follows the project's switch.
 */
export function registrationNeedsConfirmation(input: {
  confirmationRequired: boolean;
  workerInviteEmail: string | null | undefined;
  email: string;
}): boolean {
  if (!input.confirmationRequired) return false;
  const invited = normalEmail(input.workerInviteEmail);
  return !(invited && invited === normalEmail(input.email));
}

/** Where a link for an existing account continues after signing in. */
export function inviteAcceptPath(invitesPath: string, code: string): string {
  return `${invitesPath}?kod=${encodeURIComponent(code)}`;
}
