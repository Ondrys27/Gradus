import { describe, expect, it } from "vitest";
import {
  canRequestNewInvite,
  inviteAcceptPath,
  inviteLinkStatus,
  inviteLinkView,
  registrationNeedsConfirmation,
  type InviteLinkRow,
} from "./invite-link";

const now = new Date("2026-11-13T19:00:00Z");
const open: InviteLinkRow = {
  expires_at: "2026-11-20T19:00:00Z",
  accepted_at: null,
  declined_at: null,
  replaced_at: null,
};
const invited = { status: "invited" as const, user_id: null };

describe("inviteLinkStatus", () => {
  it("an open invite for a record still invited", () => {
    expect(inviteLinkStatus(open, null, invited, now)).toEqual({ state: "open", since: null });
  });

  it("says why it stopped working, with the date", () => {
    expect(inviteLinkStatus({ ...open, expires_at: "2026-11-12T10:00:00Z" }, null, invited, now)).toEqual({
      state: "expired",
      since: "2026-11-12T10:00:00Z",
    });
    expect(inviteLinkStatus({ ...open, accepted_at: "2026-11-13T19:15:31Z" }, null, invited, now).state).toBe(
      "used",
    );
    expect(inviteLinkStatus({ ...open, declined_at: "2026-11-13T10:00:00Z" }, null, invited, now).state).toBe(
      "declined",
    );
    expect(inviteLinkStatus({ ...open, replaced_at: "2026-11-13T19:16:16Z" }, null, invited, now)).toEqual({
      state: "replaced",
      since: "2026-11-13T19:16:16Z",
    });
    // Used beats expired: the person needs to sign in, not a new invite.
    expect(
      inviteLinkStatus(
        { ...open, accepted_at: "2026-11-01T00:00:00Z", expires_at: "2026-11-02T00:00:00Z" },
        null,
        invited,
        now,
      ).state,
    ).toBe("used");
  });

  it("a record the owner ended or removed makes the invite revoked", () => {
    expect(inviteLinkStatus(open, null, { status: "inactive", user_id: null }, now).state).toBe("revoked");
    expect(inviteLinkStatus(open, null, null, now).state).toBe("revoked");
  });

  it("a deleted invite speaks through its tombstone, else unknown", () => {
    expect(inviteLinkStatus(null, { reason: "replaced", ended_at: "2026-11-13T19:20:00Z" }, null, now)).toEqual({
      state: "replaced",
      since: "2026-11-13T19:20:00Z",
    });
    expect(inviteLinkStatus(null, { reason: "revoked", ended_at: "2026-11-13T19:20:00Z" }, null, now).state).toBe(
      "revoked",
    );
    expect(inviteLinkStatus(null, null, null, now)).toEqual({ state: "unknown", since: null });
  });
});

describe("canRequestNewInvite", () => {
  it("only when the owner is known and the link does not work", () => {
    expect(canRequestNewInvite("open")).toBe(false);
    expect(canRequestNewInvite("unknown")).toBe(false);
    for (const state of ["expired", "used", "declined", "replaced", "revoked"] as const) {
      expect(canRequestNewInvite(state)).toBe(true);
    }
  });
});

describe("inviteLinkView", () => {
  const owner = { id: "owner", email: "boss@example.com" };
  const invite = { ownerId: "owner", email: "Second@Example.com", inviteeId: null };

  it("signed out: the form, or sign in when an account has the e-mail or the invite names one", () => {
    expect(inviteLinkView({ state: "open", invite, viewer: null, accountForEmail: false })).toEqual({
      kind: "register",
    });
    expect(inviteLinkView({ state: "open", invite, viewer: null, accountForEmail: true })).toEqual({
      kind: "sign_in",
    });
    expect(
      inviteLinkView({ state: "open", invite: { ...invite, inviteeId: "x" }, viewer: null, accountForEmail: false }),
    ).toEqual({ kind: "sign_in" });
  });

  it("the owner who opened their own link sees whom it is for, never an accept", () => {
    expect(inviteLinkView({ state: "open", invite, viewer: owner, accountForEmail: false })).toEqual({
      kind: "other_account",
      canAcceptHere: false,
    });
    expect(
      inviteLinkView({ state: "open", invite: { ...invite, email: null }, viewer: owner, accountForEmail: false }),
    ).toEqual({ kind: "other_account", canAcceptHere: false });
  });

  it("the account the invite is for accepts; anybody else sees the notice", () => {
    const me = { id: "me", email: " second@example.com" };
    expect(inviteLinkView({ state: "open", invite, viewer: me, accountForEmail: true })).toEqual({
      kind: "accept",
      canDecline: true,
    });
    expect(
      inviteLinkView({ state: "open", invite, viewer: { id: "x", email: "other@example.com" }, accountForEmail: true }),
    ).toEqual({ kind: "other_account", canAcceptHere: false });
    const bound = { ...invite, inviteeId: "me" };
    expect(inviteLinkView({ state: "open", invite: bound, viewer: me, accountForEmail: true }).kind).toBe("accept");
    expect(
      inviteLinkView({ state: "open", invite: bound, viewer: { id: "x", email: "second@example.com" }, accountForEmail: true }),
    ).toEqual({ kind: "other_account", canAcceptHere: false });
  });

  it("an invite naming nobody can be accepted by whoever holds the code", () => {
    expect(
      inviteLinkView({
        state: "open",
        invite: { ...invite, email: null },
        viewer: { id: "x", email: "x@example.com" },
        accountForEmail: false,
      }),
    ).toEqual({ kind: "other_account", canAcceptHere: true });
  });

  it("a link that no longer works is a problem whoever opens it", () => {
    expect(inviteLinkView({ state: "used", invite, viewer: null, accountForEmail: false })).toEqual({
      kind: "problem",
      state: "used",
    });
    expect(inviteLinkView({ state: "open", invite: null, viewer: owner, accountForEmail: false })).toEqual({
      kind: "problem",
      state: "unknown",
    });
  });
});

describe("registrationNeedsConfirmation", () => {
  it("no second confirmation for the very address the owner invited", () => {
    expect(
      registrationNeedsConfirmation({ confirmationRequired: true, workerInviteEmail: "Second@Example.com", email: "second@example.com " }),
    ).toBe(false);
  });
  it("any other registration follows the switch", () => {
    expect(registrationNeedsConfirmation({ confirmationRequired: true, workerInviteEmail: null, email: "a@b.cz" })).toBe(true);
    expect(
      registrationNeedsConfirmation({ confirmationRequired: true, workerInviteEmail: "x@b.cz", email: "a@b.cz" }),
    ).toBe(true);
    expect(registrationNeedsConfirmation({ confirmationRequired: false, workerInviteEmail: null, email: "a@b.cz" })).toBe(
      false,
    );
  });
});

describe("inviteAcceptPath", () => {
  it("carries the code to the invites page", () => {
    expect(inviteAcceptPath("/app/pozvanky", "abc123")).toBe("/app/pozvanky?kod=abc123");
  });
});
