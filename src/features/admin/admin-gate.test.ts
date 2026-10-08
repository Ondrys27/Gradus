// @vitest-environment node
//
// Who gets into the administration: the middleware, the server guard and the
// export route answer a stranger, a regular user and the owner without the
// second factor with the same 404, and let the owner with aal2 through. The
// database decision itself (admin_session_touch) is tested in PGlite in
// src/lib/supabase/admin-schema.test.ts; here the fake database follows it.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const OWNER = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

type Claims = { sub: string; aal: "aal1" | "aal2"; session_id: string; email: string };
const state = {
  claims: null as Claims | null,
  rpcCalls: [] as string[],
  audit: [] as Record<string, unknown>[],
  auditError: null as { message: string } | null,
};

function signIn(userId: string | null, aal: "aal1" | "aal2" = "aal1") {
  state.claims = userId
    ? { sub: userId, aal, session_id: "33333333-3333-4333-8333-333333333333", email: "a@b.cz" }
    : null;
}

/** The user's client: what admin_session_touch() decides for this token. */
function userClient() {
  return {
    auth: { getClaims: async () => ({ data: state.claims ? { claims: state.claims } : null }) },
    rpc: async (name: string) => {
      state.rpcCalls.push(name);
      const claims = state.claims;
      const ok = claims?.sub === OWNER && claims.aal === "aal2";
      return {
        data: ok
          ? { status: "ok", user_id: OWNER, expires_at: "2026-10-08T20:00:00Z" }
          : { status: "denied" },
        error: null,
      };
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => userClient() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => userClient() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        if (table === "admin_audit" && !state.auditError) state.audit.push(row);
        return { error: table === "admin_audit" ? state.auditError : null };
      },
      select: () => ({
        order: () => ({
          limit: async () => ({
            data: [
              {
                id: 1,
                created_at: "2026-10-08T10:00:00Z",
                user_id: OWNER,
                kind: "login",
                target: "sign_in",
                ip_hash: "0123456789abcdef",
              },
            ],
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret");

const { middleware } = await import("@/middleware");
const { requireAdmin } = await import("./server/guard");
const { GET: exportAudit } = await import("@/app/(admin)/admin/(secure)/audit/export/route");
const { ADMIN_NOT_FOUND_PATH } = await import("./access");

beforeEach(() => {
  state.claims = null;
  state.rpcCalls = [];
  state.audit = [];
  state.auditError = null;
});

async function visit(path: string) {
  return middleware(new NextRequest(new URL(path, "http://localhost:3000")));
}
function isNotFound(response: Response) {
  return (
    response.status === 404 &&
    (response.headers.get("x-middleware-rewrite") ?? "").includes(ADMIN_NOT_FOUND_PATH)
  );
}

describe("middleware", () => {
  for (const path of ["/admin", "/admin/audit", "/admin/audit/export"]) {
    it(`answers 404 to a stranger on ${path}`, async () => {
      signIn(null);
      expect(isNotFound(await visit(path))).toBe(true);
    });
  }

  it("answers 404 to a regular user, even with a second factor", async () => {
    signIn(USER, "aal2");
    expect(isNotFound(await visit("/admin"))).toBe(true);
  });

  it("answers 404 to the owner without the second factor, without asking the database", async () => {
    signIn(OWNER, "aal1");
    expect(isNotFound(await visit("/admin"))).toBe(true);
    expect(state.rpcCalls).toEqual([]);
  });

  it("lets the owner with aal2 through, marked noindex", async () => {
    signIn(OWNER, "aal2");
    const response = await visit("/admin/audit");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(state.rpcCalls).toEqual(["admin_session_touch"]);
  });

  it("shows the sign-in page without the gate, never indexed", async () => {
    signIn(null);
    const response = await visit("/admin/prihlaseni");
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("does not mistake other addresses for the administration", async () => {
    signIn(null);
    const response = await visit("/administrator");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("requireAdmin", () => {
  it("is a 404 for a regular user and for the owner without aal2", async () => {
    signIn(USER, "aal2");
    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
    signIn(OWNER, "aal1");
    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("returns the owner's context with aal2", async () => {
    signIn(OWNER, "aal2");
    await expect(requireAdmin()).resolves.toEqual({
      userId: OWNER,
      expiresAt: "2026-10-08T20:00:00Z",
    });
  });
});

describe("audit export", () => {
  it("is a 404 for a regular user and the owner without aal2, and writes nothing", async () => {
    signIn(USER, "aal2");
    expect((await exportAudit()).status).toBe(404);
    signIn(OWNER, "aal1");
    expect((await exportAudit()).status).toBe(404);
    expect(state.audit).toEqual([]);
  });

  it("is written to the audit with the owner and an IP fingerprint", async () => {
    signIn(OWNER, "aal2");
    const response = await exportAudit();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(await response.text()).toContain("sign_in");
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({ user_id: OWNER, kind: "export", target: "audit" });
    expect(state.audit[0].ip_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(state.audit[0])).not.toContain("203.0.113.7");
  });

  it("exports nothing when the audit cannot be written", async () => {
    signIn(OWNER, "aal2");
    state.auditError = { message: "down" };
    expect((await exportAudit()).status).toBe(503);
  });
});
