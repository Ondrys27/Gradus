import { describe, expect, it } from "vitest";
import {
  ADMIN_HEARTBEAT_MS,
  ADMIN_IDLE_MS,
  ADMIN_LOCKOUT_MS,
  claimsMayEnterAdmin,
  idleStep,
  isAdminLoginPath,
  isAdminPath,
  isFreshPasswordSession,
  isFreshTotpSession,
  lockedUntil,
  minutesLeft,
  parseSessionStatus,
  toCsv,
} from "./access";

const now = new Date("2026-10-08T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const fail = (m: number) => ({ at: minutesAgo(m), success: false });

describe("admin paths", () => {
  it("covers /admin and everything under it, nothing else", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/audit")).toBe(true);
    expect(isAdminPath("/administrace")).toBe(false);
    expect(isAdminPath("/app/admin")).toBe(false);
    expect(isAdminLoginPath("/admin/prihlaseni")).toBe(true);
    expect(isAdminLoginPath("/admin/prihlaseni/")).toBe(true);
    expect(isAdminLoginPath("/admin/prihlaseni/x")).toBe(false);
  });
});

describe("claims", () => {
  const seconds = Math.floor(now.getTime() / 1000);
  it("let only an aal2 token with a session near the database", () => {
    expect(claimsMayEnterAdmin(null)).toBe(false);
    expect(claimsMayEnterAdmin({ sub: "u", aal: "aal1", session_id: "s" })).toBe(false);
    expect(claimsMayEnterAdmin({ sub: "u", aal: "aal2" })).toBe(false);
    expect(claimsMayEnterAdmin({ sub: "u", aal: "aal2", session_id: "s" })).toBe(true);
  });

  it("know a fresh password and a fresh code", () => {
    const claims = {
      sub: "u",
      aal: "aal2",
      amr: [
        { method: "totp", timestamp: seconds - 30 },
        { method: "password", timestamp: seconds - 120 },
      ],
    };
    expect(isFreshPasswordSession(claims, seconds)).toBe(true);
    expect(isFreshTotpSession(claims, seconds)).toBe(true);
    expect(isFreshPasswordSession(claims, seconds + 11 * 60)).toBe(false);
    expect(isFreshTotpSession({ ...claims, aal: "aal1" }, seconds)).toBe(false);
    expect(isFreshPasswordSession({ sub: "u", amr: ["password"] }, seconds)).toBe(false);
    expect(
      isFreshPasswordSession({ sub: "u", amr: [{ method: "otp", timestamp: seconds }] }, seconds),
    ).toBe(false);
  });

  it("read anything unexpected from the database as denied", () => {
    expect(parseSessionStatus(null).status).toBe("denied");
    expect(parseSessionStatus({ status: "maybe" }).status).toBe("denied");
    expect(parseSessionStatus({ status: "ok", user_id: "u", expires_at: "x" })).toEqual({
      status: "ok",
      userId: "u",
      expiresAt: "x",
    });
  });
});

describe("lockedUntil", () => {
  it("allows four wrong attempts", () => {
    expect(lockedUntil([fail(4), fail(3), fail(2), fail(1)], now)).toBeNull();
  });

  it("pauses for 15 minutes after the fifth", () => {
    const until = lockedUntil([fail(5), fail(4), fail(3), fail(2), fail(1)], now);
    expect(until?.getTime()).toBe(minutesAgo(1).getTime() + ADMIN_LOCKOUT_MS);
    expect(minutesLeft(until!, now)).toBe(14);
  });

  it("ends the pause after 15 minutes", () => {
    expect(lockedUntil([fail(20), fail(19), fail(18), fail(17), fail(16)], now)).toBeNull();
  });

  it("does not count failures spread over more than 15 minutes", () => {
    expect(lockedUntil([fail(40), fail(30), fail(20), fail(10), fail(1)], now)).toBeNull();
  });

  it("starts counting again after a complete sign-in", () => {
    const attempts = [
      fail(6),
      fail(5),
      fail(4),
      { at: minutesAgo(3), success: true },
      fail(2),
      fail(1),
    ];
    expect(lockedUntil(attempts, now)).toBeNull();
  });

  it("starts counting again after a pause", () => {
    const attempts = [
      fail(50),
      fail(49),
      fail(48),
      fail(47),
      fail(46),
      fail(10),
      fail(9),
      fail(8),
      fail(7),
    ];
    expect(lockedUntil(attempts, now)).toBeNull();
    expect(lockedUntil([...attempts, fail(6)], now)).not.toBeNull();
  });
});

describe("idleStep", () => {
  const base = now.getTime();
  const expiresAt = base + 60 * 60_000;
  it("ends after 30 minutes without input", () => {
    expect(
      idleStep({
        now: base,
        lastActivity: base - ADMIN_IDLE_MS,
        lastHeartbeat: base - 1,
        expiresAt,
      }),
    ).toBe("end");
  });
  it("ends at the 8-hour limit even while active", () => {
    expect(
      idleStep({ now: expiresAt, lastActivity: expiresAt, lastHeartbeat: expiresAt, expiresAt }),
    ).toBe("end");
  });
  it("reports recent input every few minutes, and nothing without input", () => {
    const lastHeartbeat = base - ADMIN_HEARTBEAT_MS;
    expect(idleStep({ now: base, lastActivity: base - 1000, lastHeartbeat, expiresAt })).toBe(
      "heartbeat",
    );
    expect(
      idleStep({ now: base, lastActivity: lastHeartbeat - 1000, lastHeartbeat, expiresAt }),
    ).toBe("wait");
    expect(idleStep({ now: base, lastActivity: base, lastHeartbeat: base - 1000, expiresAt })).toBe(
      "wait",
    );
  });
});

describe("toCsv", () => {
  it("quotes, escapes and defuses formulas", () => {
    expect(
      toCsv(
        ["a", "b"],
        [
          ["x,y", 'say "hi"'],
          ["=SUM(A1)", null],
          [-5, "-5"],
        ],
      ),
    ).toBe('a,b\r\n"x,y","say ""hi"""\r\n\'=SUM(A1),\r\n-5,\'-5\r\n');
  });
});
