import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useNoticeQueue } from "./use-notice-queue";

const items = (...ids: string[]) => ids.map((id) => ({ id }));

describe("useNoticeQueue", () => {
  it("shows one notice; closing it brings the next, skipping keeps it queued", () => {
    const { result, rerender } = renderHook(({ list }) => useNoticeQueue(list), {
      initialProps: { list: items("a", "b", "c") },
    });
    expect(result.current.current?.id).toBe("a");
    expect([result.current.index, result.current.total]).toEqual([0, 3]);

    // Skip a: it stays in the queue.
    act(() => result.current.next());
    expect(result.current.current?.id).toBe("b");
    expect(result.current.direction).toBe(1);

    // Close b: c takes its place.
    rerender({ list: items("a", "c") });
    expect(result.current.current?.id).toBe("c");
    expect([result.current.index, result.current.total]).toEqual([1, 2]);

    // Back: a, skipped before, not closed.
    act(() => result.current.previous());
    expect(result.current.current?.id).toBe("a");
    expect(result.current.direction).toBe(-1);

    // Everything done: nothing on screen.
    rerender({ list: [] });
    expect(result.current.current).toBeNull();
    expect(result.current.total).toBe(0);
  });

  it("keeps the notice on screen when a more urgent one arrives", () => {
    const { result, rerender } = renderHook(({ list }) => useNoticeQueue(list), {
      initialProps: { list: items("a", "b") },
    });
    act(() => result.current.next());
    rerender({ list: items("urgent", "a", "b") });
    expect(result.current.current?.id).toBe("b");
    expect(result.current.index).toBe(2);
  });

  it("does not move with a single notice", () => {
    const { result } = renderHook(() => useNoticeQueue(items("a")));
    act(() => result.current.next());
    expect(result.current.current?.id).toBe("a");
  });
});
