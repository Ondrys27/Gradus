// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/features/jarvis/server/owner", () => ({
  ownerContact: async () => ({ email: "owner@gradus.cz", locale: "cs" }),
}));

const { dispatchErrorAlert, errorAdminUrl } = await import("./dispatch");

const EVENT = {
  code: "GR-7K3M9Q",
  source: "render",
  page: "/app/finance",
  action: "/app/finance",
  message: "TypeError: x is undefined",
  stack: "at a (app.js:1:2)",
  browser: "chrome",
  device: "desktop",
  viewport: null,
  app_version: "abc1234",
  user_id: "00000000-0000-4000-8000-000000000001",
  transport: "resend",
  created_at: "2026-10-27T13:03:05.000Z",
};

type Claim = {
  decision: string;
  send_id: string | null;
  recipients: string[] | null;
  since_last: number;
  day_count: number;
};

/** A stand-in for the admin client: the claim, the event, the user, and the updates it got. */
function fakeAdmin(claim: Claim, event: Record<string, unknown> = EVENT) {
  const updates: Record<string, unknown>[] = [];
  const rpc = vi.fn(async (name: string) => {
    if (name === "error_alert_claim") return { data: [claim], error: null };
    if (name === "admin_people") {
      return {
        data: [{ user_id: EVENT.user_id, display_name: "Jana", email: "jana@firma.cz" }],
        error: null,
      };
    }
    if (name === "current_plan")
      return { data: [{ plan_key: "beta", status: "active" }], error: null };
    return { data: null, error: null };
  });
  const from = (table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () =>
        table === "error_events"
          ? { data: event, error: null }
          : { data: { is_internal: true }, error: null },
      update: (values: Record<string, unknown>) => {
        updates.push({ table, ...values });
        return { eq: async () => ({ error: null }) };
      },
    };
    return query;
  };
  return { admin: { rpc, from } as never, updates, rpc };
}

const SEND: Claim = {
  decision: "send",
  send_id: "send-1",
  recipients: ["owner@gradus.cz", "dev@gradus.cz"],
  since_last: 0,
  day_count: 3,
};

describe("dispatchErrorAlert", () => {
  it("asks the database with the flood rules and sends to every address", async () => {
    const { admin, updates, rpc } = fakeAdmin(SEND);
    const send = vi.fn(async () => ({ ok: true as const, id: "re_1" }));
    expect(
      await dispatchErrorAlert("event-1", {
        admin,
        send,
        origin: "https://gradus.app",
        spacingMs: 0,
      }),
    ).toBe("send");
    expect(rpc).toHaveBeenCalledWith("error_alert_claim", {
      _event_id: "event-1",
      _fingerprint_minutes: 15,
      _hourly_limit: 30,
    });
    expect(send).toHaveBeenCalledTimes(2);
    const calls = send.mock.calls as unknown as [{ to: string; subject: string; text: string }][];
    expect(calls.map(([message]) => message.to)).toEqual(["owner@gradus.cz", "dev@gradus.cz"]);
    const [message] = calls[0]!;
    expect(message.subject).toBe("[Gradus] Chyba GR-7K3M9Q · /app/finance");
    expect(message.text).toContain("Jana · jana@firma.cz");
    expect(message.text).toContain("tarif beta (active) · interní: ano");
    expect(message.text).toContain("3× za posledních 24 h");
    expect(message.text).toContain("https://gradus.app/admin/zpetna-vazba?code=GR-7K3M9Q");
    expect(updates).toEqual([
      expect.objectContaining({ table: "error_alert_sends", status: "sent", failure: null }),
    ]);
  });

  it("sends nothing for an error the rules hold back", async () => {
    for (const decision of ["throttled", "digest", "suppressed", "off", "skip"]) {
      const { admin } = fakeAdmin({ ...SEND, decision, send_id: null });
      const send = vi.fn();
      expect(await dispatchErrorAlert("event-1", { admin, send })).toBe(decision);
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("keeps the tests' mock e-mail on the row instead of sending it", async () => {
    const { admin, updates } = fakeAdmin(SEND, { ...EVENT, transport: "mock" });
    const send = vi.fn();
    expect(await dispatchErrorAlert("event-1", { admin, send, origin: null })).toBe("send");
    expect(send).not.toHaveBeenCalled();
    expect(updates).toEqual([
      expect.objectContaining({
        table: "error_alert_sends",
        status: "sent",
        message: expect.objectContaining({
          to: SEND.recipients,
          subject: "[Gradus] Chyba GR-7K3M9Q · /app/finance",
        }),
      }),
    ]);
  });

  it("sends the one overflow e-mail", async () => {
    const { admin } = fakeAdmin({ ...SEND, decision: "overflow" });
    const send = vi.fn(async () => ({ ok: true as const, id: null }));
    expect(await dispatchErrorAlert("event-1", { admin, send, spacingMs: 0 })).toBe("overflow");
    const calls = send.mock.calls as unknown as [{ subject: string }][];
    expect(calls[0]![0].subject).toBe("[Gradus] Chyb je víc, podívej se do administrace");
  });

  it("only logs a refused e-mail and never throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin, updates } = fakeAdmin(SEND);
    const send = vi.fn(async () => ({
      ok: false as const,
      error: "403 validation_error You can only send testing emails",
    }));
    expect(await dispatchErrorAlert("event-1", { admin, send, spacingMs: 0 })).toBe("send");
    expect(updates).toEqual([
      expect.objectContaining({ status: "failed", failure: expect.stringMatching(/^2\/2: 403/) }),
    ]);
    const broken = { rpc: async () => ({ data: null, error: { code: "PGRST", message: "down" } }) };
    expect(await dispatchErrorAlert("event-1", { admin: broken as never, send })).toBe("failed");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("errorAdminUrl", () => {
  it("links the Feedback page's search for the code", () => {
    expect(errorAdminUrl("https://gradus.app", "GR-7K3M9Q")).toBe(
      "https://gradus.app/admin/zpetna-vazba?code=GR-7K3M9Q",
    );
    expect(errorAdminUrl(null, "GR-7K3M9Q")).toBeNull();
  });
});
