import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_ERROR_ENDPOINT } from "./client-error";
import { resetClientErrorRecords, sendClientErrorRecord } from "./send-client-error";

const fetchMock = vi.fn();
beforeEach(() => {
  resetClientErrorRecords();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
  document.documentElement.lang = "cs";
});
afterEach(() => vi.unstubAllGlobals());

const bodies = () =>
  fetchMock.mock.calls.map((call) => {
    const [url, init] = call as [string, RequestInit];
    expect(url).toBe(CLIENT_ERROR_ENDPOINT);
    expect(init.keepalive).toBe(true);
    return JSON.parse(String(init.body));
  });

describe("sendClientErrorRecord", () => {
  it("sends one scrubbed record per code", () => {
    const error = Object.assign(new TypeError("boom for jan@firma.cz"), { digest: "2385967390" });
    sendClientErrorRecord(error, "boundary", "GR-7K3M9Q");
    sendClientErrorRecord(error, "boundary", "GR-7K3M9Q");
    expect(bodies()).toEqual([
      expect.objectContaining({
        code: "GR-7K3M9Q",
        source: "boundary",
        page: "/",
        message: "TypeError: boom for [email]",
        digest: "2385967390",
        locale: "cs",
      }),
    ]);
  });

  it("always sends the error page's errors, window errors once a minute", () => {
    sendClientErrorRecord(new Error("same"), "boundary", "GR-AAAAA2");
    sendClientErrorRecord(new Error("same"), "boundary", "GR-AAAAA3");
    sendClientErrorRecord(new Error("loop"), "onerror", "GR-AAAAA4");
    sendClientErrorRecord(new Error("loop"), "onerror", "GR-AAAAA5");
    expect(bodies().map((body) => body.code)).toEqual(["GR-AAAAA2", "GR-AAAAA3", "GR-AAAAA4"]);
  });

  it("leaves out the browser's own noise", () => {
    sendClientErrorRecord(
      "ResizeObserver loop completed with undelivered notifications.",
      "onerror",
      "GR-AAAAA6",
    );
    sendClientErrorRecord("Script error.", "onerror", "GR-AAAAA7");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves out a connection cut while the page is being left, sends it otherwise", () => {
    window.dispatchEvent(new Event("pagehide"));
    sendClientErrorRecord(new Error("Connection closed."), "boundary", "GR-AAAAB2");
    expect(fetchMock).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pageshow"));
    sendClientErrorRecord(new Error("Connection closed."), "boundary", "GR-AAAAB3");
    expect(bodies().map((body) => body.code)).toEqual(["GR-AAAAB3"]);
  });

  it("leaves out an aborted fetch and an extension's error", () => {
    sendClientErrorRecord(new DOMException("The user aborted a request.", "AbortError"), "unhandledrejection", "GR-AAAAB4");
    const extension = new TypeError("x is undefined");
    extension.stack = "TypeError: x is undefined\n    at run (chrome-extension://abc/content.js:1:2)";
    sendClientErrorRecord(extension, "onerror", "GR-AAAAB5");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends at most 20 a page load and never throws", () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    for (let i = 0; i < 30; i += 1) {
      sendClientErrorRecord(
        new Error(`e${"x".repeat(i)}`),
        "boundary",
        `GR-${String.fromCharCode(65 + (i % 26))}AAAA${i < 26 ? "2" : "3"}`,
      );
    }
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });
});
