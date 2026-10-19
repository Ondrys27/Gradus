// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ADMIN_INVITE_TTL_DAYS,
  generateInviteToken,
  hashInviteToken,
  inviteExpiresAt,
  inviteState,
  isWellFormedInviteToken,
} from "./invite-token";
import { adminCan, mayExport, parseAdminRole } from "./roles";
import { browserLabel, splitBrowserLabel, truncateIp } from "./client-info";

describe("invitation tokens", () => {
  it("are 32 random bytes in base64url, different every time", () => {
    const tokens = new Set(Array.from({ length: 200 }, generateInviteToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
      expect(isWellFormedInviteToken(token)).toBe(true);
    }
  });

  it("refuse anything else before the database is asked", () => {
    for (const bad of [undefined, null, 42, "", "short", `${generateInviteToken()}x`, "a".repeat(42) + "=", "../" + "a".repeat(40)]) {
      expect(isWellFormedInviteToken(bad)).toBe(false);
    }
  });

  it("are stored as a hex SHA-256 only", () => {
    const token = generateInviteToken();
    const hash = hashInviteToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hash).not.toContain(token);
    expect(hashInviteToken(generateInviteToken())).not.toBe(hash);
  });
});

describe("invitation state", () => {
  const created = new Date("2026-10-19T10:00:00Z");
  const expires = inviteExpiresAt(created).toISOString();

  it("lasts seven days", () => {
    expect(ADMIN_INVITE_TTL_DAYS).toBe(7);
    expect(expires).toBe("2026-10-26T10:00:00.000Z");
  });

  it("is open until the very end, then expired", () => {
    const row = { accepted_at: null, revoked_at: null, expires_at: expires };
    expect(inviteState(row, new Date("2026-10-26T09:59:59Z"))).toBe("open");
    expect(inviteState(row, new Date("2026-10-26T10:00:00Z"))).toBe("expired");
  });

  it("used or revoked wins over the date", () => {
    const at = "2026-10-20T10:00:00Z";
    expect(inviteState({ accepted_at: at, revoked_at: null, expires_at: expires }, created)).toBe("accepted");
    expect(inviteState({ accepted_at: null, revoked_at: at, expires_at: expires }, created)).toBe("revoked");
  });
});

describe("roles", () => {
  it("leave the owner-only things to the owner", () => {
    expect(adminCan("owner", "manageAdmins")).toBe(true);
    expect(adminCan("admin", "manageAdmins")).toBe(false);
    expect(adminCan("admin", "editAiCaps")).toBe(false);
    expect(adminCan("admin", "exportPersonalData")).toBe(false);
  });

  it("let an admin export numbers but not people", () => {
    expect(mayExport("admin", "chart.ai.cost.csv")).toBe(true);
    expect(mayExport("admin", "table.ai.top_users.csv")).toBe(false);
    expect(mayExport("admin", "audit")).toBe(false);
    expect(mayExport("owner", "table.ai.top_users.csv")).toBe(true);
  });

  it("parse only the two roles", () => {
    expect(parseAdminRole("owner")).toBe("owner");
    expect(parseAdminRole("admin")).toBe("admin");
    expect(parseAdminRole("user")).toBeNull();
    expect(parseAdminRole(undefined)).toBeNull();
  });
});

describe("sign-in origin", () => {
  it("cuts IPv4 to /24 and IPv6 to /48", () => {
    expect(truncateIp("203.0.113.57")).toBe("203.0.113.0/24");
    expect(truncateIp("::ffff:198.51.100.7")).toBe("198.51.100.0/24");
    expect(truncateIp("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe("2001:db8:85a3::/48");
    expect(truncateIp("2001:db8::1")).toBe("2001:db8:0::/48");
    expect(truncateIp("::1")).toBe("0:0:0::/48");
  });

  it("keeps nothing it cannot read", () => {
    for (const bad of ["unknown", "", null, "300.1.1.1", "1.2.3", "2001:db8::1::2", "fe80::1%eth0"]) {
      expect(truncateIp(bad)).toBeNull();
    }
  });

  it("names the browser and device class only", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
    expect(browserLabel(ua)).toBe("chrome/desktop");
    expect(browserLabel(null)).toBe("other/desktop");
    expect(splitBrowserLabel("safari/mobile")).toEqual({ browser: "safari", device: "mobile" });
    expect(splitBrowserLabel(null)).toBeNull();
  });
});
