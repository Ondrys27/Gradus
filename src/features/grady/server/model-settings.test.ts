// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { clearGradyModelsCache, loadGradyModels, MODEL_SETTINGS_TTL_MS } = await import(
  "./model-settings"
);
const { AUTO } = await import("../model-settings");

function fakeAdmin(value: unknown) {
  const state = { value, reads: 0 };
  const admin = {
    from(table: string) {
      if (table !== "app_settings") throw new Error(`unexpected table ${table}`);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          state.reads += 1;
          return { data: state.value === null ? null : { value: state.value }, error: null };
        },
      };
      return chain;
    },
  };
  return { admin: admin as never, state };
}

beforeEach(() => {
  clearGradyModelsCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadGradyModels", () => {
  it("gives the defaults without a row: the chat automatic", async () => {
    const { admin } = fakeAdmin(null);
    const settings = await loadGradyModels(admin, { report: vi.fn() });
    expect(settings.source).toBe("default");
    expect(settings.features.chat).toBe(AUTO);
  });

  it("reuses what it read for 30 seconds, then reads again", async () => {
    const { admin, state } = fakeAdmin({ features: { chat: "haiku" }, economy: false, chat_large: null });
    let now = 1_000_000;
    expect((await loadGradyModels(admin, { now, report: vi.fn() })).features.chat).toBe("haiku");
    state.value = { features: { chat: "sonnet" }, economy: false, chat_large: null };
    now += MODEL_SETTINGS_TTL_MS;
    expect((await loadGradyModels(admin, { now, report: vi.fn() })).features.chat).toBe("haiku");
    now += 1;
    expect((await loadGradyModels(admin, { now, report: vi.fn() })).features.chat).toBe("sonnet");
    expect(state.reads).toBe(2);
    expect(MODEL_SETTINGS_TTL_MS).toBeLessThanOrEqual(60_000);
  });

  it("falls back to the default for an unknown model and reports it to the error log once", async () => {
    const { admin } = fakeAdmin({ features: { briefing: "gpt" }, economy: false, chat_large: null });
    const report = vi.fn();
    const first = await loadGradyModels(admin, { report, fresh: true });
    await loadGradyModels(admin, { report, fresh: true });
    expect(first.features.briefing).toBe("sonnet");
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith("unknown_model:briefing:gpt");
  });

  it("keeps the defaults when the row cannot be read", async () => {
    const admin = {
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: null, error: { message: "down" } }),
        };
        return chain;
      },
    } as never;
    expect((await loadGradyModels(admin, { report: vi.fn() })).source).toBe("default");
  });
});
