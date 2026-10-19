import { describe, expect, it } from "vitest";
import {
  adminLoginUrl,
  ADMIN_HEARTBEAT_MS,
  ADMIN_IDLE_MS,
  ADMIN_LOCKOUT_MS,
  claimsMayEnterAdmin,
  idleStep,
  isAdminLoginPath,
  isAdminPath,
  isFreshInviteAcceptance,
  isFreshPasswordSession,
  isFreshTotpSession,
  lockedUntil,
  minutesLeft,
  parseSessionStatus,
  safeAdminNextPath,
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

describe("next after the admin sign-in", () => {
  it("keeps relative paths inside the administration", () => {
    expect(safeAdminNextPath("/admin/ai")).toBe("/admin/ai");
    expect(safeAdminNextPath("/admin/uzivatele/abc?tab=ai#caps")).toBe(
      "/admin/uzivatele/abc?tab=ai#caps",
    );
  });

  it("falls back to /admin for anything else", () => {
    for (const next of [
      null,
      undefined,
      "",
      "admin/ai",
      "/app",
      "/app/nastaveni",
      "/administrator",
      "/admin/../app",
      "/admin/prihlaseni",
      "/admin/prihlaseni/?next=/admin/ai",
      "//evil.example/admin",
      "/\\evil.example/admin",
      "https://evil.example/admin/ai",
      "javascript:alert(1)",
    ]) {
      expect(safeAdminNextPath(next), String(next)).toBe("/admin");
    }
  });

  it("builds the sign-in address, with next only when it says more than /admin", () => {
    expect(adminLoginUrl("/admin")).toBe("/admin/prihlaseni");
    expect(adminLoginUrl(null)).toBe("/admin/prihlaseni");
    expect(adminLoginUrl("//evil.example")).toBe("/admin/prihlaseni");
    expect(adminLoginUrl("/admin/rust?range=30d")).toBe(
      "/admin/prihlaseni?next=%2Fadmin%2Frust%3Frange%3D30d",
    );
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
      role: null,
      expiresAt: "x",
    });
    expect(
      parseSessionStatus({ status: "ok", user_id: "u", role: "admin", expires_at: "x" }).role,
    ).toBe("admin");
    expect(parseSessionStatus({ status: "ok", user_id: "u", role: "user" }).role).toBeNull();
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

describe("isFreshInviteAcceptance", () => {
  const me = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  const accepted = (by: string | null, at: Date | null) => ({
    accepted_by: by,
    accepted_at: at ? at.toISOString() : null,
  });

  it("holds only for this account, a moment after it accepted", () => {
    expect(isFreshInviteAcceptance(accepted(me, minutesAgo(0)), me, now.getTime())).toBe(true);
    expect(isFreshInviteAcceptance(accepted(me, minutesAgo(9)), me, now.getTime())).toBe(true);
  });

  it("is false for someone else's, an open, an old or a missing invitation", () => {
    expect(isFreshInviteAcceptance(accepted(other, minutesAgo(1)), me, now.getTime())).toBe(false);
    expect(isFreshInviteAcceptance(accepted(null, null), me, now.getTime())).toBe(false);
    expect(isFreshInviteAcceptance(accepted(me, minutesAgo(11)), me, now.getTime())).toBe(false);
    expect(isFreshInviteAcceptance(null, me, now.getTime())).toBe(false);
    expect(isFreshInviteAcceptance(accepted(me, minutesAgo(1)), "", now.getTime())).toBe(false);
    expect(
      isFreshInviteAcceptance({ accepted_by: me, accepted_at: "not a date" }, me, now.getTime()),
    ).toBe(false);
  });
});
