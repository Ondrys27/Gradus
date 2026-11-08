import { describe, expect, it } from "vitest";
import {
  availableSupportActions,
  roleMaySupport,
  confirmationLink,
  emailChangeLink,
  newEmailSchema,
  recoveryLink,
  SUPPORT_AUDIT_TARGET,
  supportAuditDetail,
  supportReasonSchema,
  trialState,
} from "./account-support";
import { accountSupportBlock, mayExport } from "./roles";

const ORIGIN = "https://gradus.example";

describe("support links", () => {
  it("lead through /auth/confirm to the new password page in the person's language", () => {
    const cs = new URL(recoveryLink(ORIGIN, "abc123", "cs"));
    expect(cs.origin + cs.pathname).toBe(`${ORIGIN}/auth/confirm`);
    expect(Object.fromEntries(cs.searchParams)).toEqual({
      token_hash: "abc123",
      type: "recovery",
      next: "/nove-heslo",
    });
    expect(new URL(recoveryLink(ORIGIN, "abc123", "en")).searchParams.get("next")).toBe(
      "/en/reset-password",
    );
  });

  it("confirm an unconfirmed address with a one-time sign-in link into the app", () => {
    const url = new URL(confirmationLink(ORIGIN, "h a/sh"));
    expect(url.searchParams.get("type")).toBe("magiclink");
    expect(url.searchParams.get("token_hash")).toBe("h a/sh");
    expect(url.searchParams.get("next")).toBe("/app");
  });

  it("send the new address to the change page in the person's language", () => {
    expect(emailChangeLink(ORIGIN, "a.b+c", "cs")).toBe(`${ORIGIN}/zmena-emailu?token=a.b%2Bc`);
    expect(emailChangeLink(ORIGIN, "x", "en")).toBe(`${ORIGIN}/en/change-email?token=x`);
  });
});

describe("what the Account card offers", () => {
  it("offers the confirmation only while the e-mail is unconfirmed", () => {
    expect(availableSupportActions({ email: "a@b.cz", emailConfirmed: true }, "owner")).toEqual([
      "passwordReset",
      "signOut",
      "emailChange",
    ]);
    expect(availableSupportActions({ email: "a@b.cz", emailConfirmed: false }, "owner")).toEqual([
      "passwordReset",
      "confirmation",
      "signOut",
      "emailChange",
    ]);
    expect(availableSupportActions({ email: null, emailConfirmed: false }, "owner")).toEqual([
      "signOut",
    ]);
  });

  it("leaves the e-mail change to the owner", () => {
    expect(availableSupportActions({ email: "a@b.cz", emailConfirmed: false }, "admin")).toEqual([
      "passwordReset",
      "confirmation",
      "signOut",
    ]);
    expect(roleMaySupport("admin", "emailChange")).toBe(false);
    expect(roleMaySupport("admin", "passwordReset")).toBe(true);
    expect(roleMaySupport("owner", "emailChange")).toBe(true);
  });

  it("lets owner and admin help ordinary accounts, never themselves or the owner", () => {
    const owner = { userId: "o", role: "owner" as const };
    const admin = { userId: "a", role: "admin" as const };
    expect(accountSupportBlock(owner, { id: "u", roles: [] })).toBeNull();
    expect(accountSupportBlock(admin, { id: "u", roles: [] })).toBeNull();
    expect(accountSupportBlock(owner, { id: "o", roles: ["owner"] })).toBe("self");
    expect(accountSupportBlock(admin, { id: "a", roles: ["admin"] })).toBe("self");
    expect(accountSupportBlock(admin, { id: "o", roles: ["owner"] })).toBe("privileged");
    // Another admin's account: the owner may, an admin may not (a takeover otherwise).
    expect(accountSupportBlock(owner, { id: "b", roles: ["admin"] })).toBeNull();
    expect(accountSupportBlock(admin, { id: "b", roles: ["admin"] })).toBe("privileged");
  });

  it("exports the accounts with e-mails to the owner only", () => {
    expect(mayExport("owner", "users")).toBe(true);
    expect(mayExport("admin", "users")).toBe(false);
  });
});

describe("the reason and the audit", () => {
  it("needs a short reason", () => {
    expect(supportReasonSchema.safeParse("").success).toBe(false);
    expect(supportReasonSchema.safeParse("  ab ").success).toBe(false);
    expect(supportReasonSchema.safeParse("Psal na podporu").success).toBe(true);
    expect(supportReasonSchema.safeParse("x".repeat(301)).success).toBe(false);
  });

  it("keeps only whom and why in the audit, never a link or an address", () => {
    expect(supportAuditDetail("u-1", "  Zapomněl heslo ")).toEqual({
      user: "u-1",
      reason: "Zapomněl heslo",
    });
    expect(Object.values(SUPPORT_AUDIT_TARGET)).toEqual([
      "users.password_reset",
      "users.confirmation_resend",
      "users.sign_out",
      "users.email_change",
    ]);
    for (const target of Object.values(SUPPORT_AUDIT_TARGET)) {
      expect(target).toMatch(/^[a-z0-9_.:-]{1,80}$/);
    }
  });

  it("normalizes the new e-mail", () => {
    expect(newEmailSchema.parse("  Jana.Nova@Example.COM ")).toBe("jana.nova@example.com");
    expect(newEmailSchema.safeParse("not an e-mail").success).toBe(false);
  });
});

describe("trialState", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  it("counts the days left of a running trial, rounded up", () => {
    expect(trialState({ status: "trialing", trialEndsAt: "2026-11-10T11:00:00Z" }, now)).toEqual({
      kind: "running",
      endsAt: "2026-11-10T11:00:00Z",
      daysLeft: 3,
    });
    expect(
      trialState({ status: "trialing", trialEndsAt: "2026-11-07T12:30:00Z" }, now),
    ).toMatchObject({ kind: "running", daysLeft: 1 });
  });

  it("knows an ended trial and an account without one", () => {
    expect(trialState({ status: "trialing", trialEndsAt: "2026-11-01T00:00:00Z" }, now)).toEqual({
      kind: "ended",
      endsAt: "2026-11-01T00:00:00Z",
    });
    expect(trialState({ status: "active", trialEndsAt: "2026-12-01T00:00:00Z" }, now).kind).toBe(
      "ended",
    );
    expect(trialState({ status: "active", trialEndsAt: null }, now)).toEqual({ kind: "none" });
    expect(trialState(null, now)).toEqual({ kind: "none" });
  });
});
