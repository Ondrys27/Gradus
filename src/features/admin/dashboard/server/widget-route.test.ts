// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The data route of the overview's widgets (29.2): only an administrator
 * with a live admin session, a widget they may not use is the same 404 as
 * an unknown one (a limited admin and the Money widgets), the view of the
 * top bar reaches the loader, and no audit row is written per widget.
 */

vi.mock("server-only", () => ({}));

const context = vi.hoisted(() => ({
  current: null as null | { userId: string; role: "owner" | "admin"; level: "full" | "limited"; expiresAt: string },
}));
const loaded = vi.hoisted(() => ({ calls: [] as { key: string; period: string; plan?: string }[] }));
const audit = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/features/admin/server/guard", () => ({
  adminAccess: async () => context.current,
  adminNotFound: () => new Response("Not Found", { status: 404 }),
}));
vi.mock("@/features/admin/server/audit", () => ({
  logAdminAction: async () => {
    audit.calls += 1;
    return true;
  },
}));
vi.mock("@/features/admin/dashboard/server/widget-data", () => ({
  loadAdminWidget: async (key: string, q: { view: { period: string; segment: { plan?: string } } }) => {
    loaded.calls.push({ key, period: q.view.period, plan: q.view.segment.plan });
    return key === "quickActions" ? null : { figures: [] };
  },
}));

const { GET } = await import("@/app/api/admin/widgets/[key]/route");

function call(key: string, search = "") {
  return GET(new Request(`http://localhost/api/admin/widgets/${key}${search}`), {
    params: Promise.resolve({ key }),
  });
}

const ADMIN = { userId: "u", expiresAt: "2026-12-01T00:00:00Z" };

describe("GET /api/admin/widgets/<key>", () => {
  beforeEach(() => {
    loaded.calls = [];
    audit.calls = 0;
  });

  it("is a 404 without an admin session", async () => {
    context.current = null;
    expect((await call("errors")).status).toBe(404);
    expect(loaded.calls).toEqual([]);
  });

  it("is a 404 for a limited admin asking for money, and for an unknown widget", async () => {
    context.current = { ...ADMIN, role: "admin", level: "limited" };
    for (const key of ["revenue", "margin", "payingByPlan", "subscriptions", "failedPayments", "promo", "nope"]) {
      expect((await call(key)).status, key).toBe(404);
    }
    expect(loaded.calls).toEqual([]);
    expect((await call("errors")).status).toBe(200);
  });

  it("gives the owner and a full admin the money, for the view of the bar, without an audit row", async () => {
    for (const actor of [
      { role: "owner" as const, level: "full" as const },
      { role: "admin" as const, level: "full" as const },
    ]) {
      context.current = { ...ADMIN, ...actor };
      const response = await call("revenue", "?period=7d&plan=pro");
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(loaded.calls).toEqual([
      { key: "revenue", period: "7d", plan: "pro" },
      { key: "revenue", period: "7d", plan: "pro" },
    ]);
    expect(audit.calls).toBe(0);
  });

  it("is a 404 for the quick actions, which have no data", async () => {
    context.current = { ...ADMIN, role: "owner", level: "full" };
    expect((await call("quickActions")).status).toBe(404);
  });
});
