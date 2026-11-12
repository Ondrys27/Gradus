// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { limitReached, logAiUsage, planLimits } = await import("./usage");

describe("planLimits", () => {
  it("reads the numbers of current_plan()", () => {
    expect(
      planLimits({ ai_calls_limit: 1000, file_uploads_limit: 100, read_only: false }),
    ).toEqual({ aiCalls: 1000, fileUploads: 100 });
    expect(limitReached({ used: 0, limit: 1000 })).toBe(false);
  });

  it("leaves nothing after the trial and nothing when the plan cannot be read", () => {
    const expired = planLimits({ ai_calls_limit: 0, file_uploads_limit: 0, read_only: true });
    expect(limitReached({ used: 0, limit: expired.aiCalls })).toBe(true);
    expect(planLimits(null)).toEqual({ aiCalls: 0, fileUploads: 0 });
  });
});

describe("logAiUsage", () => {
  const entry = {
    userId: "u1",
    conversationId: "c1",
    feature: "chat" as const,
    model: "claude-sonnet-5-5" as const,
    tokens: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
    durationMs: 1200,
  };

  function adminWith(results: Record<string, { code: string } | null>[]) {
    const inserts: { table: string; row: Record<string, unknown> }[] = [];
    let call = 0;
    const admin = {
      from: (table: string) => ({
        insert: async (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          const errors = results[call++] ?? {};
          return { error: errors[table] ?? null };
        },
      }),
    };
    return { admin: admin as never, inserts };
  }

  it("writes one row", async () => {
    const { admin, inserts } = adminWith([]);
    await logAiUsage(admin, entry);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ table: "ai_usage", row: { user_id: "u1", conversation_id: "c1" } });
  });

  it("keeps the cost when the account was deleted during the call", async () => {
    const missing = { code: "23503" };
    const { admin, inserts } = adminWith([{ ai_usage: missing }, { ai_usage: missing }]);
    await logAiUsage(admin, entry);
    expect(inserts.map((insert) => insert.table)).toEqual(["ai_usage", "ai_usage", "ai_usage_retired"]);
    expect(inserts[1].row.conversation_id).toBeNull();
    expect(inserts[2].row.cost_usd).toBe(inserts[0].row.cost_usd);
    expect(inserts[2].row).not.toHaveProperty("user_id");
  });

  it("writes the row without a conversation that was deleted during the call", async () => {
    const { admin, inserts } = adminWith([{ ai_usage: { code: "23503" } }]);
    await logAiUsage(admin, entry);
    expect(inserts.map((insert) => insert.table)).toEqual(["ai_usage", "ai_usage"]);
  });
});
