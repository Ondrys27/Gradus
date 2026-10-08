// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSION_USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";

const state = {
  sessionUser: SESSION_USER as string | null,
  inserted: [] as Record<string, unknown>[],
  rpc: [] as { name: string; args: Record<string, unknown> }[],
  used: 0,
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: state.sessionUser ? { claims: { sub: state.sessionUser } } : null,
      }),
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpc.push({ name, args });
      if (name === "analytics_take_quota") {
        const limit = args._limit as number;
        const granted = Math.max(0, Math.min(args._units as number, limit - state.used));
        state.used += granted;
        return { data: granted, error: null };
      }
      return { data: "session-1", error: null };
    },
    from: () => ({
      insert: async (rows: Record<string, unknown>[]) => {
        state.inserted.push(...rows);
        return { error: null };
      },
    }),
  }),
}));

const { POST } = await import("./route");

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/t", {
      method: "POST",
      headers: { "user-agent": "Mozilla/5.0 (iPhone) Mobile Safari/604.1" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const view = {
  event: "page_viewed",
  props: { route: "/app", section: "dashboard", initial: false },
};

beforeEach(() => {
  state.sessionUser = SESSION_USER;
  state.inserted = [];
  state.rpc = [];
  state.used = 0;
});

describe("POST /api/t", () => {
  it("writes under the session's user with the device from the browser", async () => {
    const response = await post({ events: [view] });
    expect(response.status).toBe(200);
    expect(state.inserted).toEqual([
      {
        user_id: SESSION_USER,
        event: "page_viewed",
        props: view.props,
        session_id: "session-1",
        device: "mobile",
      },
    ]);
    expect(state.rpc.every((call) => call.args._user_id === SESSION_USER)).toBe(true);
  });

  it("does not take a user id from the body", async () => {
    expect((await post({ events: [view], user_id: OTHER_USER })).status).toBe(400);
    const response = await post({
      events: [{ ...view, props: { ...view.props, user_id: OTHER_USER } }],
    });
    expect(await response.json()).toEqual({ accepted: 0, rejected: 1, limited: 0 });
    expect(state.inserted).toEqual([]);
    expect(JSON.stringify(state.rpc)).not.toContain(OTHER_USER);
  });

  it("answers 401 without a session and 400 for a body that is not JSON", async () => {
    state.sessionUser = null;
    expect((await post({ events: [view] })).status).toBe(401);
    state.sessionUser = SESSION_USER;
    expect((await post("not json")).status).toBe(400);
  });

  it("stops at the per-minute limit", async () => {
    const batch = { events: Array.from({ length: 50 }, () => view) };
    for (let i = 0; i < 2; i++) expect((await post(batch)).status).toBe(200);
    expect(await (await post(batch)).json()).toEqual({ accepted: 20, rejected: 0, limited: 30 });
    expect((await post(batch)).status).toBe(429);
    expect(state.inserted).toHaveLength(120);
  });
});
