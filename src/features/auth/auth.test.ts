// @vitest-environment node
import { describe, expect, it } from "vitest";
import { inviteEmailMatches, isValidInviteCode, looksLikeWorkerInvite } from "./invite-code";
import { authErrorKey, fieldErrorsFrom, newPasswordSchema, signUpSchema } from "./schemas";

describe("isValidInviteCode", () => {
  it("accepts the configured code, ignoring surrounding spaces", () => {
    expect(isValidInviteCode(" beta-2026 ", "beta-2026")).toBe(true);
  });

  it("rejects wrong codes and closes registration when no code is configured", () => {
    expect(isValidInviteCode("beta-2025", "beta-2026")).toBe(false);
    expect(isValidInviteCode("", "beta-2026")).toBe(false);
    expect(isValidInviteCode("anything", undefined)).toBe(false);
    expect(isValidInviteCode("", "")).toBe(false);
  });
});

describe("sign-up validation", () => {
  it("normalises the e-mail and reports every invalid field", () => {
    const ok = signUpSchema.safeParse({
      displayName: " Ondřej ",
      email: " Ondra@Example.com ",
      password: "12345678",
      inviteCode: "x",
    });
    expect(ok.success && ok.data.email).toBe("ondra@example.com");

    const bad = signUpSchema.safeParse({
      displayName: "",
      email: "nope",
      password: "123",
      inviteCode: "",
    });
    // The invite code is checked by the server (decideSignup), not the schema.
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(fieldErrorsFrom(bad.error)).toEqual({
        email: "invalidEmail",
        password: "passwordTooShort",
      });
    }
  });

  it("requires the confirmation to match", () => {
    const result = newPasswordSchema.safeParse({ password: "12345678", confirm: "12345679" });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(fieldErrorsFrom(result.error)).toEqual({ confirm: "passwordsDontMatch" });
  });
});

describe("authErrorKey", () => {
  it("maps Supabase codes to messages", () => {
    expect(authErrorKey({ code: "invalid_credentials" })).toBe("invalidCredentials");
    expect(authErrorKey({ code: "email_exists" })).toBe("emailTaken");
    expect(authErrorKey({ status: 429 })).toBe("rateLimited");
    expect(authErrorKey({ code: "something_new" })).toBe("generic");
  });
});

describe("worker invites", () => {
  it("recognises codes the database makes and nothing else", () => {
    expect(looksLikeWorkerInvite("0f3a9c1b2d4e5f60718a")).toBe(true);
    expect(looksLikeWorkerInvite(" 0f3a9c1b2d4e ")).toBe(true);
    expect(looksLikeWorkerInvite("beta-2026")).toBe(false);
    expect(looksLikeWorkerInvite("0F3A9C1B2D4E5F60718A")).toBe(false);
    expect(looksLikeWorkerInvite("0f3a9c1b2d4e' or 1=1")).toBe(false);
  });

  it("requires the invited e-mail when the owner gave one", () => {
    expect(inviteEmailMatches(null, "anyone@example.com")).toBe(true);
    expect(inviteEmailMatches("Jana@Example.com", " jana@example.com")).toBe(true);
    expect(inviteEmailMatches("jana@example.com", "pepa@example.com")).toBe(false);
  });
});
