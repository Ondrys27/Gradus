// @vitest-environment node
//
// Who gets into the administration: the middleware and the server guard send
// a stranger, a regular user and the owner without the second factor (or with
// an ended admin session) to the sign-in with the page asked for, the export
// route answers them 404, and the owner with aal2 and a live session gets in. The
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
  /** What admin_session_touch() says to the owner with aal2. */
  ownerSession: "ok" as "ok" | "idle" | "expired" | "ended",
  adminPathHeader: null as string | null,
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
      const owner = claims?.sub === OWNER && claims.aal === "aal2";
      return {
        data:
          owner && state.ownerSession === "ok"
            ? { status: "ok", user_id: OWNER, expires_at: "2026-10-08T20:00:00Z" }
            : { status: owner ? state.ownerSession : "denied" },
        error: null,
      };
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => userClient() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => userClient() }));
vi.mock("next/headers", () => ({
  headers: async () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    if (state.adminPathHeader) headers.set("x-gradus-admin-path", state.adminPathHeader);
    return headers;
  },
}));
vi.mock("next/navigation", () => ({
  RedirectType: { push: "push", replace: "replace" },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
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
const { ADMIN_PATH_HEADER } = await import("./access");

beforeEach(() => {
  state.claims = null;
  state.rpcCalls = [];
  state.audit = [];
  state.auditError = null;
  state.ownerSession = "ok";
  state.adminPathHeader = null;
});

async function visit(path: string, init?: { method?: string; headers?: Record<string, string> }) {
  return middleware(new NextRequest(new URL(path, "http://localhost:3000"), init));
}
/** Where a redirect leads, as a path with its query. */
function redirectTarget(response: Response): string | null {
  const location = response.headers.get("location");
  if (!location || response.status < 300 || response.status >= 400) return null;
  const url = new URL(location);
  return url.pathname + url.search;
}

describe("middleware", () => {
  for (const [path, target] of [
    ["/admin", "/admin/prihlaseni"],
    ["/admin/audit", "/admin/prihlaseni?next=%2Fadmin%2Faudit"],
    ["/admin/uzivatele?q=1", "/admin/prihlaseni?next=%2Fadmin%2Fuzivatele%3Fq%3D1"],
    ["/admin/audit/export", "/admin/prihlaseni?next=%2Fadmin%2Faudit%2Fexport"],
  ] as const) {
    it(`sends a stranger on ${path} to the sign-in`, async () => {
      signIn(null);
      const response = await visit(path);
      expect(redirectTarget(response)).toBe(target);
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    });
  }

  it("sends a regular user to the sign-in, even with a second factor", async () => {
    signIn(USER, "aal2");
    expect(redirectTarget(await visit("/admin/ai"))).toBe("/admin/prihlaseni?next=%2Fadmin%2Fai");
  });

  it("sends the owner without the second factor to the sign-in, without asking the database", async () => {
    signIn(OWNER, "aal1");
    expect(redirectTarget(await visit("/admin/ai"))).toBe("/admin/prihlaseni?next=%2Fadmin%2Fai");
    expect(state.rpcCalls).toEqual([]);
  });

  for (const status of ["idle", "expired", "ended"] as const) {
    it(`sends the owner with an ${status} admin session back to the sign-in`, async () => {
      signIn(OWNER, "aal2");
      state.ownerSession = status;
      expect(redirectTarget(await visit("/admin/rust"))).toBe(
        "/admin/prihlaseni?next=%2Fadmin%2Frust",
      );
    });
  }

  it("tells a server action of an ended session where to go instead of failing", async () => {
    signIn(OWNER, "aal2");
    state.ownerSession = "idle";
    const response = await visit("/admin/ai", {
      method: "POST",
      headers: { "next-action": "abc123" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-action-redirect")).toBe(
      "/admin/prihlaseni?next=%2Fadmin%2Fai;replace",
    );
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });

  it("lets the owner with aal2 through, marked noindex, with the page for the guard", async () => {
    signIn(OWNER, "aal2");
    const response = await visit("/admin/audit?range=7d", {
      headers: { [ADMIN_PATH_HEADER]: "/admin/spoofed" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get(`x-middleware-request-${ADMIN_PATH_HEADER}`)).toBe(
      "/admin/audit?range=7d",
    );
    expect(state.rpcCalls).toEqual(["admin_session_touch"]);
  });

  it("shows the sign-in page to anyone, never indexed", async () => {
    for (const who of [null, USER, OWNER]) {
      signIn(who);
      const response = await visit("/admin/prihlaseni?next=%2Fadmin%2Fai");
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    }
  });

  it("does not mistake other addresses for the administration", async () => {
    signIn(null);
    const response = await visit("/administrator");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("X-Robots-Tag")).toBeNull();
  });
});

describe("requireAdmin", () => {
  it("sends a regular user and the owner without aal2 to the sign-in with the page", async () => {
    state.adminPathHeader = "/admin/uzivatele/abc";
    signIn(USER, "aal2");
    await expect(requireAdmin()).rejects.toThrow(
      "NEXT_REDIRECT /admin/prihlaseni?next=%2Fadmin%2Fuzivatele%2Fabc",
    );
    signIn(OWNER, "aal1");
    await expect(requireAdmin()).rejects.toThrow(
      "NEXT_REDIRECT /admin/prihlaseni?next=%2Fadmin%2Fuzivatele%2Fabc",
    );
  });

  it("sends an expired session to the sign-in, and to /admin when the page is unknown", async () => {
    signIn(OWNER, "aal2");
    state.ownerSession = "expired";
    await expect(requireAdmin()).rejects.toThrow(/^NEXT_REDIRECT \/admin\/prihlaseni$/);
    state.adminPathHeader = "https://evil.example/admin";
    await expect(requireAdmin()).rejects.toThrow(/^NEXT_REDIRECT \/admin\/prihlaseni$/);
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
