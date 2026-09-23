// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isValidInviteCode } from "./invite-code";
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
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(fieldErrorsFrom(bad.error)).toEqual({
        email: "invalidEmail",
        password: "passwordTooShort",
        inviteCode: "inviteRequired",
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
