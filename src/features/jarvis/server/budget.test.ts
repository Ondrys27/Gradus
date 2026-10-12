// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const track = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/analytics/track", () => ({ track }));
vi.mock("@/lib/site-origin", () => ({ siteOrigin: async () => "https://app.example.com" }));

const { alertOwner, createBudgetGuard } = await import("./budget");

/**
 * The admin client as the budget sees it: this month's spend from the RPC,
 * the alert rows with a unique (day, kind), and the owner's address.
 */
function fakeAdmin(spentUsd: number) {
  const alerts = new Set<string>();
  const admin = {
    rpc: vi.fn(async () => ({ data: [{ cost_usd: spentUsd, calls: 12 }], error: null })),
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: "owner@example.com" } } }),
      },
    },
    from(table: string) {
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
  return { admin: admin as never, alerts, rpc: admin.rpc };
}

const NOW = new Date("2026-10-20T09:00:00Z");
const ok = () => vi.fn().mockResolvedValue({ ok: true, id: "mail" });

beforeEach(() => {
  track.mockClear();
  delete process.env.JARVIS_MONTHLY_BUDGET_USD;
});

describe("createBudgetGuard", () => {
  it("lets calls through under 80 % and sends nothing", async () => {
    const { admin, rpc } = fakeAdmin(40);
    const send = ok();
    const guard = createBudgetGuard(admin, { now: () => NOW, send });
    expect(await guard.allows("chat")).toBe(true);
    expect(rpc).toHaveBeenCalledWith("jarvis_month_spend", { _since: "2026-10-01T00:00:00.000Z" });
    expect(send).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it("stops calls over the budget, records the pause and mails the owner", async () => {
    const { admin } = fakeAdmin(90.5);
    const send = ok();
    const guard = createBudgetGuard(admin, { now: () => NOW, send });
    expect(await guard.allows("chat")).toBe(false);
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

  it("uses JARVIS_MONTHLY_BUDGET_USD", async () => {
    process.env.JARVIS_MONTHLY_BUDGET_USD = "200";
    const { admin } = fakeAdmin(150);
    const send = ok();
    expect(await createBudgetGuard(admin, { now: () => NOW, send }).allows("chat")).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("mails the owner at most once a day above 80 %, however many calls and requests", async () => {
    const { admin } = fakeAdmin(80);
    const send = ok();
    for (let request = 0; request < 3; request += 1) {
      const guard = createBudgetGuard(admin, { now: () => NOW, send });
      for (let call = 0; call < 3; call += 1) expect(await guard.allows("chat")).toBe(true);
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].subject).toContain("89");

    // The next day brings one more.
    const tomorrow = new Date("2026-10-21T09:00:00Z");
    await createBudgetGuard(admin, { now: () => tomorrow, send }).allows("chat");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("stops after the API ran out of credit and mails the owner once a day", async () => {
    const { admin } = fakeAdmin(10);
    const send = ok();
    const guard = createBudgetGuard(admin, { now: () => NOW, send });
    expect(await guard.allows("opportunity_scan")).toBe(true);
    await guard.creditsExhausted("opportunity_scan", "billing_error");
    expect(track).toHaveBeenCalledWith(
      "jarvis_paused",
      { feature: "opportunity_scan", reason: "credits", error_code: "billing_error" },
      expect.objectContaining({ userId: null }),
    );
    expect(await guard.allows("opportunity_scan")).toBe(false);

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
    expect(await guard.allows("chat")).toBe(true);
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
