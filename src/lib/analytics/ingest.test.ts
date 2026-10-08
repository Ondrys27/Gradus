import { describe, expect, it } from "vitest";
import { CLIENT_RATE_LIMIT, ingest, type IngestDeps, type IngestRow } from "./ingest";

const SESSION_USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";

/** The browser's side as /api/t sees it, with an in-memory per-minute allowance. */
function fakeDeps(userId: string | null = SESSION_USER) {
  const used = new Map<string, number>();
  const stored: { userId: string; sessionId: string | null; rows: IngestRow[] }[] = [];
  let touches = 0;
  const deps: IngestDeps = {
    userId,
    takeQuota: async (user, units) => {
      const before = used.get(user) ?? 0;
      const granted = Math.max(0, Math.min(units, CLIENT_RATE_LIMIT - before));
      used.set(user, before + granted);
      return granted;
    },
    touchSession: async () => {
      touches += 1;
      return "session-1";
    },
    insert: async (user, sessionId, rows) => {
      stored.push({ userId: user, sessionId, rows });
    },
  };
  return { deps, stored, touches: () => touches };
}

const view = {
  event: "page_viewed",
  props: { route: "/app", section: "dashboard", initial: false },
};

describe("ingest", () => {
  it("stores catalog events under the session's user", async () => {
    const { deps, stored } = fakeDeps();
    const result = await ingest({ events: [view] }, deps);
    expect(result).toEqual({ status: 200, body: { accepted: 1, rejected: 0, limited: 0 } });
    expect(stored).toEqual([
      {
        userId: SESSION_USER,
        sessionId: "session-1",
        rows: [{ event: "page_viewed", props: view.props }],
      },
    ]);
  });

  it("does not accept another user's id anywhere in the body", async () => {
    const { deps, stored } = fakeDeps();
    // Next to the events: the whole request is refused.
    expect(await ingest({ events: [view], user_id: OTHER_USER }, deps)).toEqual({
      status: 400,
      body: { error: "invalid" },
    });
    // On an event or in its props: that event is refused.
    const result = await ingest(
      {
        events: [
          { ...view, user_id: OTHER_USER },
          { event: "timer_started", props: { user_id: OTHER_USER } },
          view,
        ],
      },
      deps,
    );
    expect(result.body).toEqual({ accepted: 1, rejected: 2, limited: 0 });
    expect(stored.every((batch) => batch.userId === SESSION_USER)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(OTHER_USER);
  });

  it("needs a signed-in user", async () => {
    const { deps, stored } = fakeDeps(null);
    expect(await ingest({ events: [view] }, deps)).toEqual({
      status: 401,
      body: { error: "unauthorized" },
    });
    expect(stored).toEqual([]);
  });

  it("refuses unknown events, server-only events and text in place of codes", async () => {
    const { deps, stored } = fakeDeps();
    const result = await ingest(
      {
        events: [
          { event: "contact_name_typed", props: { name: "Jan Novák" } },
          { event: "account_registered", props: { method: "beta" } },
          { event: "settings_changed", props: { setting: "theme", value: "my favourite one" } },
          "page_viewed",
        ],
      },
      deps,
    );
    expect(result).toEqual({ status: 200, body: { accepted: 0, rejected: 4, limited: 0 } });
    expect(stored).toEqual([]);
  });

  it(`lets through at most ${CLIENT_RATE_LIMIT} events a minute per user`, async () => {
    const { deps, stored } = fakeDeps();
    const batch = { events: Array.from({ length: 50 }, () => view) };
    expect((await ingest(batch, deps)).body).toMatchObject({ accepted: 50, limited: 0 });
    expect((await ingest(batch, deps)).body).toMatchObject({ accepted: 50, limited: 0 });
    expect((await ingest(batch, deps)).body).toMatchObject({
      accepted: CLIENT_RATE_LIMIT - 100,
      limited: 100 + 50 - CLIENT_RATE_LIMIT,
    });
    const blocked = await ingest(batch, deps);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ accepted: 0, limited: 50 });
    expect(stored.flatMap((entry) => entry.rows)).toHaveLength(CLIENT_RATE_LIMIT);
  });

  it("counts the heartbeat, extends the session and stores nothing for it", async () => {
    const { deps, stored, touches } = fakeDeps();
    expect(await ingest({ events: [], heartbeat: true }, deps)).toEqual({
      status: 200,
      body: { accepted: 0, rejected: 0, limited: 0 },
    });
    expect(touches()).toBe(1);
    expect(stored).toEqual([]);
  });

  it("refuses batches that are too big or not a batch", async () => {
    const { deps } = fakeDeps();
    expect((await ingest({ events: Array.from({ length: 51 }, () => view) }, deps)).status).toBe(
      400,
    );
    expect((await ingest([view], deps)).status).toBe(400);
    expect((await ingest(null, deps)).status).toBe(400);
  });
});
