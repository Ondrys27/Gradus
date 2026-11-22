import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Signing out sends the last events and waits for them before the session
 * ends (e2e 58a): nothing may leave the page afterwards without a session.
 */
async function load() {
  vi.resetModules();
  return import("./client");
}

type Body = { events: Array<{ event: string }> };

describe("endTracking", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let beacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "development");
    fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetchMock);
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body as string) as Body);

  it("sends what waits with a fetch it waits for, then nothing more goes out", async () => {
    const analytics = await load();
    analytics.track("signed_out", {});
    let done = false;
    const ending = analytics.endTracking().then(() => {
      done = true;
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodies()[0].events.map((item) => item.event)).toEqual(["signed_out"]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ keepalive: true, credentials: "same-origin" });
    await ending;
    expect(done).toBe(true);

    // Tracked after the end, a hidden page or the flush timer: nothing leaves.
    analytics.track("signed_out", {});
    analytics.flush({ beacon: true });
    analytics.flush({ heartbeat: true });
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(beacon).not.toHaveBeenCalled();
  });

  it("cancels a request that is still not answered after the timeout", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const analytics = await load();
    analytics.track("signed_out", {});
    let done = false;
    const ending = analytics.endTracking(500).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await ending;
    expect(done).toBe(true);
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(true);
  });

  it("with an empty queue sends nothing and still stops", async () => {
    const analytics = await load();
    await analytics.endTracking();
    expect(fetchMock).not.toHaveBeenCalled();
    analytics.track("signed_out", {});
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
