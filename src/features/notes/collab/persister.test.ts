// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteDraft } from "../document";
import { CollabPersister, type CollabSaveResult, type CollabStore, type PersisterIO } from "./persister";

const draft = (text: string): NoteDraft => ({
  kind: "text",
  title: text,
  content: { type: "doc", content: [] },
  content_text: text,
});

function setup(results: CollabSaveResult[], absorb: "merged" | "replaced" = "merged") {
  const calls: { base: number; text: string }[] = [];
  let text = "a";
  const store: CollabStore = {
    encodeState: () => new Uint8Array([1, 2, 3]),
    draft: () => draft(text),
    absorb: vi.fn(() => absorb),
  };
  const events: string[] = [];
  let online = true;
  const io: PersisterIO = {
    save: vi.fn(async ({ base, draft: d }): Promise<CollabSaveResult> => {
      calls.push({ base, text: d.content_text });
      return results.shift() ?? { status: "saved", version: base + 1 };
    }),
    isOnline: () => online,
    onSaved: (version) => events.push(`saved:${version}`),
    onReplaced: () => events.push("replaced"),
    onGone: (why) => events.push(`gone:${why}`),
  };
  const persister = new CollabPersister(store, io, { version: 4, retryDelaysMs: [1_000] });
  return {
    persister,
    store,
    calls,
    events,
    setText: (next: string) => (text = next),
    setOnline: (next: boolean) => (online = next),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("saving a live note", () => {
  it("saves 2 s after the last own change, once", async () => {
    const { persister, calls } = setup([]);
    persister.localChange("me");
    await vi.advanceTimersByTimeAsync(1_500);
    persister.localChange("me");
    await vi.advanceTimersByTimeAsync(1_500);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(600);
    expect(calls).toEqual([{ base: 4, text: "a" }]);
    expect(persister.status).toBe("saved");
    expect(persister.version).toBe(5);
  });

  it("saves at least every 10 s during long typing", async () => {
    const { persister, calls } = setup([]);
    for (let i = 0; i < 12; i++) {
      persister.localChange("me");
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it("never saves over a newer state: it merges the stored one and saves on its version", async () => {
    const { persister, calls, store, events } = setup([
      { status: "conflict", version: 9, state: new Uint8Array([9]), kind: "text" },
    ]);
    persister.localChange("me");
    await vi.advanceTimersByTimeAsync(2_100);
    expect(store.absorb).toHaveBeenCalledOnce();
    expect(calls.map((call) => call.base)).toEqual([4, 9]);
    expect(persister.version).toBe(10);
    expect(events).toEqual(["saved:10"]);
  });

  it("opens the note again when the stored state is another generation", async () => {
    const { persister, events, calls } = setup(
      [{ status: "conflict", version: 9, state: null, kind: "text" }],
      "replaced",
    );
    persister.localChange("me");
    await vi.advanceTimersByTimeAsync(2_100);
    expect(events).toEqual(["replaced"]);
    expect(calls).toHaveLength(1);
  });

  it("waits offline and saves when the connection is back", async () => {
    const { persister, calls, setOnline } = setup([]);
    setOnline(false);
    persister.localChange("me");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(persister.status).toBe("offline");
    expect(calls).toHaveLength(0);
    setOnline(true);
    persister.online();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(persister.status).toBe("saved");
  });

  it("keeps trying a note not stored yet and stops for good when access is gone", async () => {
    const { persister, calls, events } = setup([{ status: "missing" }, { status: "denied" }]);
    persister.localChange("me");
    await vi.advanceTimersByTimeAsync(2_100);
    expect(persister.status).toBe("pending");
    await vi.advanceTimersByTimeAsync(1_100);
    expect(calls).toHaveLength(2);
    expect(persister.status).toBe("denied");
    expect(events).toEqual(["gone:denied"]);
    persister.localChange("me");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(2);
  });

  it("leaves changes of others to their author unless the author never saves them", async () => {
    const { persister, calls } = setup([]);
    persister.remoteChange("peer", 3, "alice");
    expect(persister.status).toBe("pending");
    persister.peerSaved("peer", 3);
    expect(persister.status).toBe("saved");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(0);

    persister.remoteChange("peer", 4, "alice");
    await vi.advanceTimersByTimeAsync(8_100);
    expect(calls).toHaveLength(1);
  });

  it("stops at the size limit until the next change", async () => {
    const { persister, calls, setText } = setup([]);
    setText("x".repeat(200_000));
    persister.localChange("me");
    await vi.advanceTimersByTimeAsync(2_100);
    expect(persister.status).toBe("tooLarge");
    expect(calls).toHaveLength(0);
  });
});
