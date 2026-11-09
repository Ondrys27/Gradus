// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  bookingTokenHash,
  isBookingToken,
  managePath,
  manageTokenFor,
  newHoldToken,
} from "./tokens";

describe("booking tokens", () => {
  it("a hold's secret is 32 random bytes in base64url, never the same twice", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => newHoldToken()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(isBookingToken(token)).toBe(true);
  });

  it("the link of a booking is the same for the same booking and key, different otherwise", () => {
    const id = "6f1c4f0e-1b8b-4b5e-9a6e-2e3c1a0b9d11";
    const other = "0b0e7a4a-5d7c-4d47-8a3a-3a8f6f5f6b22";
    const token = manageTokenFor(id, "key-a");
    expect(isBookingToken(token)).toBe(true);
    expect(manageTokenFor(id, "key-a")).toBe(token);
    expect(manageTokenFor(id, "key-b")).not.toBe(token);
    expect(manageTokenFor(other, "key-a")).not.toBe(token);
    expect(() => manageTokenFor(id, "")).toThrow();
  });

  it("the database keeps only a hex SHA-256, which differs from the token", () => {
    const token = newHoldToken();
    const hash = bookingTokenHash(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(bookingTokenHash(token));
    expect(hash).not.toContain(token);
    expect(bookingTokenHash(newHoldToken())).not.toBe(hash);
  });

  it("anything that is not a token's shape is refused before a lookup", () => {
    for (const bad of ["", "short", "x".repeat(44), `${"a".repeat(42)}=`, "../../etc/passwd", 42, null]) {
      expect(isBookingToken(bad)).toBe(false);
    }
  });

  it("the guest's page is /s/r/<token>", () => {
    expect(managePath("abc")).toBe("/s/r/abc");
  });
});
