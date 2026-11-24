// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const logAiUsage = vi.fn(async () => {});
vi.mock("./usage", () => ({ logAiUsage }));

const { canBatch, collectBatches, customIdFor, submitBatch, CUSTOM_ID } = await import("./batch");

type Row = Record<string, unknown>;

/** grady_batches in memory, with the few query shapes batch.ts uses. */
function fakeAdmin() {
  const rows: Row[] = [];
  const from = (table: string) => {
    expect(table).toBe("grady_batches");
    const filters: [string, unknown][] = [];
    let patch: Row | null = null;
    const matching = () => rows.filter((row) => filters.every(([key, value]) => row[key] === value));
    const query = {
      insert: async (row: Row) => {
        rows.push({ id: `row-${rows.length + 1}`, status: "submitted", created_at: new Date().toISOString(), ...row });
        return { error: null };
      },
      select: () => query,
      update: (values: Row) => {
        patch = values;
        return query;
      },
      eq: (key: string, value: unknown) => {
        filters.push([key, value]);
        return query;
      },
      order: () => query,
      limit: () => query,
      then: (resolve: (value: unknown) => void) => {
        const found = matching();
        if (patch) for (const row of found) Object.assign(row, patch);
        resolve({ data: found.map((row) => ({ ...row })), error: null });
      },
    };
    return query;
  };
  return { rows, client: { from } as never };
}

function fakeClient(results: { custom_id: string; text?: string; type?: string }[]) {
  const created: { requests: { custom_id: string; params: { model: string; max_tokens: number } }[] }[] = [];
  const batch = {
    id: "msgbatch_1",
    processing_status: "ended",
    created_at: "2026-11-24T05:00:00Z",
    ended_at: "2026-11-24T05:02:00Z",
    request_counts: { succeeded: 1, errored: 0, canceled: 0, expired: 0, processing: 0 },
  };
  const client = {
    messages: {
      stream: () => {
        throw new Error("no direct calls here");
      },
      batches: {
        create: vi.fn(async (params: (typeof created)[number]) => {
          created.push(params);
          return batch;
        }),
        retrieve: vi.fn(async () => batch),
        cancel: vi.fn(async () => batch),
        results: vi.fn(async () =>
          (async function* () {
            for (const result of results) {
              yield {
                custom_id: result.custom_id,
                result:
                  result.type && result.type !== "succeeded"
                    ? { type: result.type }
                    : {
                        type: "succeeded",
                        message: {
                          model: "claude-haiku-5-5",
                          stop_reason: "end_turn",
                          content: [{ type: "text", text: result.text ?? "" }],
                          usage: { input_tokens: 1000, output_tokens: 100 },
                        },
                      },
              };
            }
          })(),
        ),
      },
    },
  };
  return { client: client as never, created };
}

const request = (userId: string) => ({
  customId: customIdFor("watch", userId),
  userId,
  feature: "opportunity_scan" as const,
  instructions: "Look.",
  context: "<changes>…</changes>",
  messages: [{ role: "user" as const, content: "Answer." }],
  meta: { at: "2026-11-24T10:00:00.000Z" },
});

describe("Grady's batches", () => {
  it("makes custom ids the API accepts", () => {
    expect(customIdFor("watch", "6f1c2a3e-0000-4000-8000-000000000001")).toMatch(CUSTOM_ID);
    expect(customIdFor("briefing", "6f1c2a3e-0000-4000-8000-000000000001")).toHaveLength(34);
  });

  it("leaves the job to direct calls without the Batches API", async () => {
    const admin = fakeAdmin();
    const client = { messages: { stream: () => null } } as never;
    expect(canBatch(client)).toBe(false);
    const sent = await submitBatch({ client, admin: admin.client, kind: "watch", requests: [request("u1")] });
    expect(sent.batchId).toBeNull();
    expect(sent.direct).toHaveLength(1);
  });

  it("plans every request like a direct call, sends one batch and records it", async () => {
    const admin = fakeAdmin();
    const { client, created } = fakeClient([]);
    expect(canBatch(client)).toBe(true);
    const sent = await submitBatch({
      client,
      admin: admin.client,
      kind: "watch",
      requests: [request("6f1c2a3e-0000-4000-8000-000000000001"), request("6f1c2a3e-0000-4000-8000-000000000002")],
    });
    expect(sent.batchId).toBe("msgbatch_1");
    expect(created[0].requests).toHaveLength(2);
    expect(created[0].requests[0].params.model).toBe("claude-haiku-5-5");
    expect(created[0].requests[0].params.max_tokens).toBe(1024);
    expect(admin.rows).toHaveLength(1);
    expect(admin.rows[0]).toMatchObject({ kind: "watch", batch_id: "msgbatch_1", status: "submitted" });
  });

  it("collects an ended batch once: half the price in ai_usage, every answer to the job", async () => {
    const admin = fakeAdmin();
    const userId = "6f1c2a3e-0000-4000-8000-000000000001";
    const { client } = fakeClient([
      { custom_id: customIdFor("watch", userId), text: '{"suggestions": []}' },
    ]);
    await submitBatch({ client, admin: admin.client, kind: "watch", requests: [request(userId)] });
    const handle = vi.fn(async () => {});
    const first = await collectBatches({ client, admin: admin.client, kind: "watch", handle });
    expect(first).toMatchObject({ batches: 1, answered: 1, failed: 0 });
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: userId, feature: "opportunity_scan" }),
      { ok: true, text: '{"suggestions": []}' },
    );
    expect(logAiUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ batch: true, feature: "opportunity_scan", durationMs: 120_000 }),
    );
    expect(admin.rows[0].status).toBe("collected");
    const again = await collectBatches({ client, admin: admin.client, kind: "watch", handle });
    expect(again.batches).toBe(0);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("hands errored requests to the job without logging a cost", async () => {
    logAiUsage.mockClear();
    const admin = fakeAdmin();
    const userId = "6f1c2a3e-0000-4000-8000-000000000003";
    const { client } = fakeClient([{ custom_id: customIdFor("watch", userId), type: "errored" }]);
    await submitBatch({ client, admin: admin.client, kind: "watch", requests: [request(userId)] });
    const handle = vi.fn(async () => {});
    const summary = await collectBatches({ client, admin: admin.client, kind: "watch", handle });
    expect(summary.failed).toBe(1);
    expect(handle).toHaveBeenCalledWith(expect.anything(), { ok: false, reason: "errored" });
    expect(logAiUsage).not.toHaveBeenCalled();
  });
});
