import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftFromDoc, type NoteDraft } from "./document";
import { NoteSaver, type BackupEntry } from "./note-saver";

function draft(text: string): NoteDraft {
  return draftFromDoc({
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    })),
  });
}

/** A save the test resolves or rejects by hand. */
function controlledSave() {
  const calls: { id: string; draft: NoteDraft; resolve: () => void; reject: () => void }[] = [];
  const save = vi.fn(
    (id: string, d: NoteDraft) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ id, draft: d, resolve, reject: () => reject(new Error("network")) });
      }),
  );
  return { save, calls };
}

function memoryBackup() {
  let stored: Record<string, BackupEntry> = {};
  return {
    read: () => stored,
    write: (entries: Record<string, BackupEntry>) => {
      stored = JSON.parse(JSON.stringify(entries));
    },
    get stored() {
      return stored;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("NoteSaver", () => {
  it("saves once, 600 ms after the last keystroke", async () => {
    const { save, calls } = controlledSave();
    const saver = new NoteSaver({ save });
    saver.edit("a", draft("C"));
    vi.advanceTimersByTime(400);
    saver.edit("a", draft("Ce"));
    vi.advanceTimersByTime(400);
    saver.edit("a", draft("Ceník"));
    expect(save).not.toHaveBeenCalled();
    expect(saver.statusOf("a")).toBe("pending");
    vi.advanceTimersByTime(600);
    expect(save).toHaveBeenCalledTimes(1);
    expect(calls[0].draft.title).toBe("Ceník");
    expect(saver.statusOf("a")).toBe("saving");
    calls[0].resolve();
    await vi.runAllTimersAsync();
    expect(saver.statusOf("a")).toBe("saved");
    expect(saver.hasUnsaved()).toBe(false);
  });

  it("never runs two saves of a note at once and sends the newest text last", async () => {
    const { save, calls } = controlledSave();
    const saver = new NoteSaver({ save });
    saver.edit("a", draft("one"));
    vi.advanceTimersByTime(600);
    saver.edit("a", draft("two"));
    vi.advanceTimersByTime(600);
    // The first request is still running: the second waits for it.
    expect(save).toHaveBeenCalledTimes(1);
    calls[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(calls[1].draft.title).toBe("two");
    expect(saver.hasUnsaved()).toBe(true);
    calls[1].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.hasUnsaved()).toBe(false);
  });

  it("keeps saving a note after the user switched to another one", async () => {
    const { save, calls } = controlledSave();
    const saver = new NoteSaver({ save });
    saver.edit("a", draft("first note"));
    // Opening note b flushes a right away instead of waiting.
    const flushed = saver.flush("a");
    saver.edit("b", draft("second note"));
    expect(calls.map((c) => c.id)).toEqual(["a"]);
    calls[0].resolve();
    await flushed;
    vi.advanceTimersByTime(600);
    expect(calls.map((c) => [c.id, c.draft.title])).toEqual([
      ["a", "first note"],
      ["b", "second note"],
    ]);
    expect(saver.statusOf("a")).toBe("saved");
  });

  it("retries a failed save and keeps the text in the backup until it succeeds", async () => {
    const { save, calls } = controlledSave();
    const backup = memoryBackup();
    const saver = new NoteSaver({ save, backup, retryDelays: [1000] });
    saver.edit("a", draft("offline text"));
    vi.advanceTimersByTime(600);
    expect(Object.keys(backup.stored)).toEqual(["a"]);
    calls[0].reject();
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.statusOf("a")).toBe("error");
    expect(saver.unsavedDraft("a")?.title).toBe("offline text");
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(2);
    calls[1].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.statusOf("a")).toBe("saved");
    expect(backup.stored).toEqual({});
  });

  it("waits while offline and sends at once when the connection is back", async () => {
    const { save, calls } = controlledSave();
    let online = false;
    const saver = new NoteSaver({ save, isOnline: () => online });
    saver.edit("a", draft("on the train"));
    vi.advanceTimersByTime(600);
    expect(save).not.toHaveBeenCalled();
    expect(saver.statusOf("a")).toBe("offline");
    expect(saver.hasUnsaved()).toBe(true);
    online = true;
    saver.retryNow();
    expect(save).toHaveBeenCalledTimes(1);
    calls[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.hasUnsaved()).toBe(false);
  });

  it("does not send a note over the size limit", () => {
    const { save } = controlledSave();
    const saver = new NoteSaver({ save });
    saver.edit("a", draft("x".repeat(320_000)));
    vi.advanceTimersByTime(600);
    expect(save).not.toHaveBeenCalled();
    expect(saver.statusOf("a")).toBe("tooLarge");
  });

  it("forgets a discarded note", () => {
    const { save } = controlledSave();
    const backup = memoryBackup();
    const saver = new NoteSaver({ save, backup });
    saver.edit("a", draft(""));
    saver.writeBackup();
    saver.discard("a");
    vi.advanceTimersByTime(600);
    expect(save).not.toHaveBeenCalled();
    expect(saver.hasUnsaved()).toBe(false);
    expect(backup.stored).toEqual({});
  });

  it("reads what an earlier visit left unsaved", () => {
    const backup = memoryBackup();
    backup.write({ a: { draft: draft("left behind"), editedAt: 5 } });
    const saver = new NoteSaver({ save: vi.fn(), backup });
    expect(saver.readBackup().a.draft.title).toBe("left behind");
  });
});
