import { afterEach, describe, expect, it, vi } from "vitest";
import { whenIdle } from "./idle";

describe("whenIdle", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("falls back to a timer where requestIdleCallback is missing (Safari)", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const task = vi.fn();
    whenIdle(task);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(task).toHaveBeenCalledOnce();
  });

  it("uses requestIdleCallback when there is one, and can be cancelled", () => {
    const callbacks: (() => void)[] = [];
    const cancel = vi.fn();
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => callbacks.push(callback));
    vi.stubGlobal("cancelIdleCallback", cancel);
    const task = vi.fn();
    const stop = whenIdle(task);
    callbacks[0]();
    expect(task).toHaveBeenCalledOnce();
    stop();
    expect(cancel).toHaveBeenCalledWith(1);
  });

  it("never runs the fallback task once cancelled", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const task = vi.fn();
    const stop = whenIdle(task);
    stop();
    vi.advanceTimersByTime(5000);
    expect(task).not.toHaveBeenCalled();
  });
});
