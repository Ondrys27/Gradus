import { describe, expect, it } from "vitest";
import { decideSignup, signupSource, wantsE2ePublicSignup } from "./signup-mode";

const base = {
  code: "",
  betaCodeMatches: false,
  workerInviteFound: false,
  betaCodeConfigured: true,
  publicSignup: false,
};

describe("decideSignup with public sign-up off (beta)", () => {
  it("still needs an invite code", () => {
    expect(decideSignup(base)).toEqual({
      kind: "error",
      field: "inviteCode",
      error: "inviteRequired",
    });
  });

  it("gives beta for the beta code and for a worker invite", () => {
    expect(decideSignup({ ...base, code: "beta", betaCodeMatches: true })).toEqual({
      kind: "beta",
    });
    expect(decideSignup({ ...base, code: "0f3a9c1b2d4e", workerInviteFound: true })).toEqual({
      kind: "worker",
    });
  });

  it("refuses a wrong code, and everything when no code is configured", () => {
    expect(decideSignup({ ...base, code: "nope" })).toMatchObject({ error: "invalidInvite" });
    expect(decideSignup({ ...base, code: "nope", betaCodeConfigured: false })).toEqual({
      kind: "error",
      error: "registrationClosed",
    });
  });
});

describe("decideSignup with public sign-up on", () => {
  const open = { ...base, publicSignup: true };

  it("starts a trial without a code", () => {
    expect(decideSignup(open)).toEqual({ kind: "trial" });
    expect(decideSignup({ ...open, code: "   " })).toEqual({ kind: "trial" });
  });

  it("keeps invites working unchanged", () => {
    expect(decideSignup({ ...open, code: "beta", betaCodeMatches: true }).kind).toBe("beta");
    expect(decideSignup({ ...open, code: "0f3a9c1b2d4e", workerInviteFound: true }).kind).toBe(
      "worker",
    );
  });

  it("does not turn a mistyped code into a trial", () => {
    expect(decideSignup({ ...open, code: "typo", betaCodeConfigured: false })).toMatchObject({
      error: "invalidInvite",
    });
  });
});

describe("signupSource", () => {
  it("names an invitation first, then a partner's code, then a pricing card", () => {
    expect(signupSource({ kind: "beta", promoCode: true, planPicked: true })).toBe("invite");
    expect(signupSource({ kind: "worker", promoCode: false, planPicked: false })).toBe("invite");
    expect(signupSource({ kind: "trial", promoCode: true, planPicked: true })).toBe("code");
    expect(signupSource({ kind: "trial", promoCode: false, planPicked: true })).toBe("pricing");
    expect(signupSource({ kind: "trial", promoCode: false, planPicked: false })).toBe("web");
  });
});

describe("wantsE2ePublicSignup", () => {
  const with_ = (value: string | null) => ({ get: () => value });
  it("needs the header and never works in production", () => {
    expect(wantsE2ePublicSignup(with_("public"), "preview")).toBe(true);
    expect(wantsE2ePublicSignup(with_("public"), undefined)).toBe(true);
    expect(wantsE2ePublicSignup(with_("public"), "production")).toBe(false);
    expect(wantsE2ePublicSignup(with_(null), undefined)).toBe(false);
    expect(wantsE2ePublicSignup(with_("yes"), undefined)).toBe(false);
  });
});
