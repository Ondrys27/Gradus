import { describe, expect, it } from "vitest";
import { decideSignup } from "./signup-mode";

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
