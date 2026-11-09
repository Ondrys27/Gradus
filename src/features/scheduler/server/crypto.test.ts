// @vitest-environment node
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { decryptSecret, encryptSecret, hasEncryptionKey, IntegrationKeyError } =
  await import("./crypto");

const KEY = randomBytes(32).toString("base64");
const URL_SECRET =
  "https://calendar.google.com/calendar/ical/x%40gmail.com/private-abc123/basic.ics";

afterEach(() => vi.unstubAllEnvs());

describe("integration secrets", () => {
  it("round trips and uses a fresh iv every time", () => {
    vi.stubEnv("INTEGRATIONS_ENCRYPTION_KEY", KEY);
    expect(hasEncryptionKey()).toBe(true);
    const a = encryptSecret(URL_SECRET);
    const b = encryptSecret(URL_SECRET);
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
    expect(a).not.toContain("google");
    expect(decryptSecret(a)).toBe(URL_SECRET);
    expect(decryptSecret(b)).toBe(URL_SECRET);
  });

  it("refuses a tampered token", () => {
    vi.stubEnv("INTEGRATIONS_ENCRYPTION_KEY", KEY);
    const token = encryptSecret(URL_SECRET);
    const parts = token.split(".");
    const cipher = Buffer.from(parts[3], "base64url");
    cipher[0] ^= 1;
    parts[3] = cipher.toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow(IntegrationKeyError);
    expect(() => decryptSecret("v1.nonsense")).toThrow(IntegrationKeyError);
    expect(() => decryptSecret("v2.a.b.c")).toThrow(IntegrationKeyError);
  });

  it("refuses another key", () => {
    vi.stubEnv("INTEGRATIONS_ENCRYPTION_KEY", KEY);
    const token = encryptSecret(URL_SECRET);
    vi.stubEnv("INTEGRATIONS_ENCRYPTION_KEY", randomBytes(32).toString("base64url"));
    expect(() => decryptSecret(token)).toThrow(IntegrationKeyError);
  });

  it("without a key nothing is sealed or opened", () => {
    vi.stubEnv("INTEGRATIONS_ENCRYPTION_KEY", "");
    expect(hasEncryptionKey()).toBe(false);
    expect(() => encryptSecret("x")).toThrow(/not configured/);
    vi.stubEnv("INTEGRATIONS_ENCRYPTION_KEY", "too-short");
    expect(hasEncryptionKey()).toBe(false);
    vi.stubEnv("INTEGRATIONS_ENCRYPTION_KEY", randomBytes(16).toString("base64"));
    expect(hasEncryptionKey()).toBe(false);
  });

  it("accepts a hex and a base64url key", () => {
    vi.stubEnv("INTEGRATIONS_ENCRYPTION_KEY", randomBytes(32).toString("hex"));
    expect(decryptSecret(encryptSecret("ok"))).toBe("ok");
    vi.stubEnv("INTEGRATIONS_ENCRYPTION_KEY", randomBytes(32).toString("base64url"));
    expect(decryptSecret(encryptSecret("ok"))).toBe("ok");
  });
});
