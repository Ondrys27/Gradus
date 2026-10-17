// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const track = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/analytics/track", () => ({ track }));
vi.mock("@/lib/site-origin", () => ({ siteOrigin: async () => "https://app.example.com" }));

const { alertOwner, createBudgetGuard } = await import("./budget");
const { clearAiCapsCache, CAPS_TTL_MS } = await import("./caps");

type Stored = { monthly_usd: number; per_user_usd: number | null; warn_percent: number };
type State = {
  caps: Stored | null;
  overrides: Map<string, { cap_usd: number | null; blocked: boolean }>;
  userSpend: Map<string, number>;
};

/**
 * The admin client as the budget sees it: this month's spend from the RPC,
 * the alert rows with a unique (day, kind), and the owner's address.
 */
function fakeAdmin(spentUsd: number, init: Partial<State> = {}) {
  const alerts = new Set<string>();
  const state: State = {
    caps: init.caps ?? null,
    overrides: init.overrides ?? new Map(),
    userSpend: init.userSpend ?? new Map(),
  };
  const admin = {
    rpc: vi.fn(async (name: string, args: Record<string, string>) => {
      if (name === "jarvis_user_month_spend") {
        return { data: state.userSpend.get(args._user_id) ?? 0, error: null };
      }
      return { data: [{ cost_usd: spentUsd, calls: 12 }], error: null };
    }),
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: "owner@example.com" } } }),
      },
    },
    from(table: string) {
      if (table === "app_settings") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({
            data: state.caps ? { value: state.caps } : null,
            error: null,
          }),
        };
        return chain;
      }
      if (table === "ai_user_caps") {
        let userId = "";
        const chain = {
          select: () => chain,
          eq: (_column: string, value: string) => {
            userId = value;
            return chain;
          },
          maybeSingle: async () => ({ data: state.overrides.get(userId) ?? null, error: null }),
        };
        return chain;
      }
      if (table === "user_roles") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: { user_id: "owner-id" }, error: null }),
        };
        return chain;
      }
      if (table === "user_settings") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: { locale: "cs" }, error: null }),
        };
        return chain;
      }
      if (table === "jarvis_budget_alerts") {
        return {
          // INSERT … ON CONFLICT DO NOTHING RETURNING: a row only when it was new.
          upsert: (row: { day: string; kind: string }) => ({
            select: async () => {
              const key = `${row.day}:${row.kind}`;
              if (alerts.has(key)) return { data: [], error: null };
              alerts.add(key);
              return { data: [{ day: row.day }], error: null };
            },
          }),
          delete: () => ({
            eq: (_c: string, day: string) => ({
              eq: async (_k: string, kind: string) => {
                alerts.delete(`${day}:${kind}`);
                return { error: null };
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { admin: admin as never, alerts, rpc: admin.rpc, state };
}

const NOW = new Date("2026-10-20T09:00:00Z");
const ok = () => vi.fn().mockResolvedValue({ ok: true, id: "mail" });

beforeEach(() => {
  track.mockClear();
  clearAiCapsCache();
  delete process.env.JARVIS_MONTHLY_BUDGET_USD;
});

describe("createBudgetGuard", () => {
  it("lets calls through under 80 % and sends nothing", async () => {
    const { admin, rpc } = fakeAdmin(40);
    const send = ok();
    const guard = createBudgetGuard(admin, { now: () => NOW, send });
    expect(await guard.check("chat")).toBe("ok");
    expect(rpc).toHaveBeenCalledWith("jarvis_month_spend", { _since: "2026-10-01T00:00:00.000Z" });
    expect(send).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it("stops calls over the budget, records the pause and mails the owner", async () => {
    const { admin } = fakeAdmin(90.5);
    const send = ok();
    const guard = createBudgetGuard(admin, { now: () => NOW, send });
    expect(await guard.check("chat")).toBe("paused");
    expect(track).toHaveBeenCalledWith(
      "jarvis_paused",
      { feature: "chat", reason: "budget" },
      expect.objectContaining({ userId: null }),
    );
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe("owner@example.com");
    expect(mail.text).toContain("https://app.example.com/admin/ai");
  });

  it("uses JARVIS_MONTHLY_BUDGET_USD while the administration has set nothing", async () => {
    process.env.JARVIS_MONTHLY_BUDGET_USD = "200";
    const { admin } = fakeAdmin(150);
    const send = ok();
    expect(await createBudgetGuard(admin, { now: () => NOW, send }).check("chat")).toBe("ok");
    expect(send).not.toHaveBeenCalled();
  });

  it("mails the owner at most once a day above 80 %, however many calls and requests", async () => {
    const { admin } = fakeAdmin(80);
    const send = ok();
    for (let request = 0; request < 3; request += 1) {
      const guard = createBudgetGuard(admin, { now: () => NOW, send });
      for (let call = 0; call < 3; call += 1) expect(await guard.check("chat")).toBe("ok");
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].subject).toContain("89");

    // The next day brings one more.
    const tomorrow = new Date("2026-10-21T09:00:00Z");
    await createBudgetGuard(admin, { now: () => tomorrow, send }).check("chat");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("stops after the API ran out of credit and mails the owner once a day", async () => {
    const { admin } = fakeAdmin(10);
    const send = ok();
    const guard = createBudgetGuard(admin, { now: () => NOW, send });
    expect(await guard.check("opportunity_scan")).toBe("ok");
    await guard.creditsExhausted("opportunity_scan", "billing_error");
    expect(track).toHaveBeenCalledWith(
      "jarvis_paused",
      { feature: "opportunity_scan", reason: "credits", error_code: "billing_error" },
      expect.objectContaining({ userId: null }),
    );
    expect(await guard.check("opportunity_scan")).toBe("paused");

    await createBudgetGuard(admin, { now: () => NOW, send }).creditsExhausted(
      "chat",
      "enforced_spend_limit_reached",
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].text).toContain("billing_error");
  });

  it("keeps Jarvis working when the spend cannot be read", async () => {
    const { admin, rpc } = fakeAdmin(0);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "down" } } as never);
    const guard = createBudgetGuard(admin, { now: () => NOW, send: ok() });
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    expect(await guard.check("chat")).toBe("ok");
  });
});

describe("caps from the administration", () => {
  const caps = (over: Partial<Stored> = {}): Stored => ({
    monthly_usd: 200,
    per_user_usd: null,
    warn_percent: 80,
    ...over,
  });

  it("takes the monthly cap from the database over JARVIS_MONTHLY_BUDGET_USD", async () => {
    process.env.JARVIS_MONTHLY_BUDGET_USD = "50";
    const { admin } = fakeAdmin(100, { caps: caps() });
    const send = ok();
    expect(await createBudgetGuard(admin, { now: () => NOW, send }).check("chat")).toBe("ok");
    expect(send).not.toHaveBeenCalled();
  });

  it("warns the owner from the threshold set there", async () => {
    const { admin } = fakeAdmin(100, { caps: caps({ warn_percent: 50 }) });
    const send = ok();
    expect(await createBudgetGuard(admin, { now: () => NOW, send }).check("chat")).toBe("ok");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].text).toContain("50");
  });

  it("stops every call with a monthly cap of 0", async () => {
    const { admin } = fakeAdmin(0, { caps: caps({ monthly_usd: 0 }) });
    expect(await createBudgetGuard(admin, { now: () => NOW, send: ok() }).check("chat")).toBe(
      "paused",
    );
  });

  it("stops a user at the per-user cap, without an e-mail, and lets others through", async () => {
    const { admin } = fakeAdmin(20, {
      caps: caps({ per_user_usd: 5 }),
      userSpend: new Map([
        ["heavy", 5],
        ["light", 4.99],
      ]),
    });
    const send = ok();
    const guard = createBudgetGuard(admin, { now: () => NOW, send });
    expect(await guard.check("chat", "heavy")).toBe("userLimit");
    expect(await guard.check("chat", "light")).toBe("ok");
    expect(await guard.check("briefing")).toBe("ok");
    expect(send).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith(
      "jarvis_paused",
      { feature: "chat", reason: "user_cap" },
      expect.objectContaining({ userId: "heavy" }),
    );
  });

  it("applies a user's own cap over the per-user cap, and blocking over everything", async () => {
    const { admin } = fakeAdmin(20, {
      caps: caps({ per_user_usd: 5 }),
      overrides: new Map([
        ["vip", { cap_usd: 50, blocked: false }],
        ["tight", { cap_usd: 1, blocked: false }],
        ["blocked", { cap_usd: null, blocked: true }],
      ]),
      userSpend: new Map([
        ["vip", 30],
        ["tight", 1.5],
      ]),
    });
    const guard = createBudgetGuard(admin, { now: () => NOW, send: ok() });
    expect(await guard.check("chat", "vip")).toBe("ok");
    expect(await guard.check("chat", "tight")).toBe("userLimit");
    expect(await guard.check("chat", "blocked")).toBe("userLimit");
    expect(track).toHaveBeenCalledWith(
      "jarvis_paused",
      { feature: "chat", reason: "user_blocked" },
      expect.objectContaining({ userId: "blocked" }),
    );
  });

  it("keeps the application-wide pause first, whatever the user's cap", async () => {
    const { admin } = fakeAdmin(250, {
      caps: caps(),
      overrides: new Map([["vip", { cap_usd: 500, blocked: false }]]),
    });
    const guard = createBudgetGuard(admin, { now: () => NOW, send: ok() });
    expect(await guard.check("chat", "vip")).toBe("paused");
  });

  it("applies a change within the cache time, at most a minute", async () => {
    const { admin, state } = fakeAdmin(100, { caps: caps() });
    let at = NOW.getTime();
    const now = () => new Date(at);
    expect(await createBudgetGuard(admin, { now, send: ok() }).check("chat")).toBe("ok");

    state.caps = caps({ monthly_usd: 90 });
    at += 1_000;
    // Still the copy this instance read a second ago.
    expect(await createBudgetGuard(admin, { now, send: ok() }).check("chat")).toBe("ok");
    at += CAPS_TTL_MS;
    expect(CAPS_TTL_MS).toBeLessThanOrEqual(60_000);
    expect(await createBudgetGuard(admin, { now, send: ok() }).check("chat")).toBe("paused");
  });
});

describe("alertOwner", () => {
  it("gives the day back when the e-mail fails, so a later call tries again", async () => {
    const { admin, alerts } = fakeAdmin(95);
    const failing = vi.fn().mockResolvedValue({ ok: false, error: "500" });
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    expect(
      await alertOwner(admin, "paused", null, { reason: "budget" }, { now: NOW, send: failing }),
    ).toBe("failed");
    expect(alerts.size).toBe(0);
    const send = ok();
    expect(await alertOwner(admin, "paused", null, { reason: "budget" }, { now: NOW, send })).toBe(
      "sent",
    );
    expect(await alertOwner(admin, "paused", null, { reason: "budget" }, { now: NOW, send })).toBe(
      "alreadySent",
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});
