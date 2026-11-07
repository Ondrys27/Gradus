import { describe, expect, it } from "vitest";
import {
  createEmailChangeToken,
  EMAIL_CHANGE_TTL_SECONDS,
  emailChangeStillApplies,
  readEmailChangeToken,
} from "./email-change-token";

const SECRET = "test-secret-key";
const NOW = 1_800_000_000;
const CLAIM = {
  userId: "0b7c1f2e-1111-4222-8333-444455556666",
  oldEmail: "Jana@Example.com",
  newEmail: " Jana.Nova@Example.com ",
  requestedBy: "1c8d2f3e-1111-4222-8333-444455556666",
};

describe("the e-mail change link", () => {
  it("carries the change, normalized, until it expires", () => {
    const token = createEmailChangeToken(CLAIM, SECRET, NOW);
    expect(readEmailChangeToken(token, SECRET, NOW + 60)).toEqual({
      userId: CLAIM.userId,
      oldEmail: "jana@example.com",
      newEmail: "jana.nova@example.com",
      requestedBy: CLAIM.requestedBy,
      expiresAt: NOW + EMAIL_CHANGE_TTL_SECONDS,
    });
    expect(readEmailChangeToken(token, SECRET, NOW + EMAIL_CHANGE_TTL_SECONDS)).toBeNull();
  });

  it("refuses another key, a changed body and garbage", () => {
    const token = createEmailChangeToken(CLAIM, SECRET, NOW);
    expect(readEmailChangeToken(token, "another-key", NOW)).toBeNull();
    const [body, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), n: "evil@example.com" }),
    ).toString("base64url");
    expect(readEmailChangeToken(`${forged}.${signature}`, SECRET, NOW)).toBeNull();
    expect(readEmailChangeToken(`${body}.`, SECRET, NOW)).toBeNull();
    expect(readEmailChangeToken(`${token}.x`, SECRET, NOW)).toBeNull();
    expect(readEmailChangeToken("", SECRET, NOW)).toBeNull();
    expect(readEmailChangeToken(null, SECRET, NOW)).toBeNull();
    expect(readEmailChangeToken("x".repeat(3000), SECRET, NOW)).toBeNull();
  });

  it("is spent once the account's e-mail is no longer the old one", () => {
    const claim = readEmailChangeToken(createEmailChangeToken(CLAIM, SECRET, NOW), SECRET, NOW)!;
    expect(emailChangeStillApplies(claim, " JANA@example.com")).toBe(true);
    expect(emailChangeStillApplies(claim, "jana.nova@example.com")).toBe(false);
    expect(emailChangeStillApplies(claim, null)).toBe(false);
  });
});
