// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { fetchIcs, isPublicAddress, normalizeIcsUrl } = await import("./ics-fetch");

const CALENDAR = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
const URL_OK = "https://calendar.example.com/private/basic.ics";

const publicLookup = vi.fn(async () => ["93.184.216.34"]);

function respond(body: BodyInit | null, init: ResponseInit = {}) {
  return new Response(body, { status: 200, ...init });
}

describe("normalizeIcsUrl", () => {
  it("turns webcal into https and gives a hint without the secret", () => {
    expect(normalizeIcsUrl("  webcal://p01-caldav.icloud.com/published/2/abc ")).toEqual({
      ok: true,
      url: "https://p01-caldav.icloud.com/published/2/abc",
      hint: "p01-caldav.icloud.com",
    });
    expect(normalizeIcsUrl("webcals://www.example.com/x.ics")).toMatchObject({
      ok: true,
      hint: "example.com",
    });
  });

  it("refuses http, credentials, odd ports and nonsense", () => {
    expect(normalizeIcsUrl("http://example.com/x.ics")).toEqual({ ok: false, reason: "notHttps" });
    expect(normalizeIcsUrl("ftp://example.com/x.ics")).toEqual({ ok: false, reason: "notHttps" });
    expect(normalizeIcsUrl("https://user:pw@example.com/x.ics")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(normalizeIcsUrl("https://example.com:8443/x.ics")).toEqual({
      ok: false,
      reason: "blocked",
    });
    expect(normalizeIcsUrl("not a url")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizeIcsUrl("")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizeIcsUrl(`https://example.com/${"a".repeat(2100)}`)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses local names and private IP literals", () => {
    for (const url of [
      "https://localhost/x.ics",
      "https://printer.local/x.ics",
      "https://db.internal/x.ics",
      "https://intranet/x.ics",
      "https://127.0.0.1/x.ics",
      "https://10.1.2.3/x.ics",
      "https://192.168.0.10/x.ics",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/x.ics",
      "https://[fd00::1]/x.ics",
      "https://[::ffff:10.0.0.1]/x.ics",
      "https://0x7f.1/x.ics",
    ]) {
      expect(normalizeIcsUrl(url), url).toEqual({ ok: false, reason: "blocked" });
    }
    expect(normalizeIcsUrl("https://93.184.216.34/x.ics")).toMatchObject({ ok: true });
  });
});

describe("isPublicAddress", () => {
  it.each([
    ["8.8.8.8", true],
    ["93.184.216.34", true],
    ["2606:4700:4700::1111", true],
    ["0.0.0.0", false],
    ["10.0.0.1", false],
    ["100.64.0.1", false],
    ["127.0.0.1", false],
    ["169.254.1.1", false],
    ["172.16.0.1", false],
    ["172.31.255.255", false],
    ["172.32.0.1", true],
    ["192.168.1.1", false],
    ["224.0.0.1", false],
    ["255.255.255.255", false],
    ["::", false],
    ["::1", false],
    ["fe80::1", false],
    ["fc00::1", false],
    ["fd12:3456::1", false],
    ["ff02::1", false],
    ["::ffff:127.0.0.1", false],
    ["::ffff:8.8.8.8", true],
    ["64:ff9b::10.0.0.1", false],
    ["2001:db8::1", false],
    ["nonsense", false],
  ])("%s → %s", (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected);
  });
});

describe("fetchIcs", () => {
  it("downloads a calendar", async () => {
    const fetchImpl = vi.fn(async () =>
      respond(CALENDAR, { headers: { "content-type": "text/calendar" } }),
    );
    expect(await fetchIcs(URL_OK, { lookup: publicLookup, fetchImpl })).toEqual({
      ok: true,
      text: CALENDAR,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>)["user-agent"]).not.toMatch(/gradus/i);
  });

  it("refuses http and private literals before any request", async () => {
    const fetchImpl = vi.fn();
    expect(await fetchIcs("http://example.com/x.ics", { lookup: publicLookup, fetchImpl })).toEqual(
      {
        ok: false,
        code: "invalid",
      },
    );
    expect(await fetchIcs("https://10.0.0.1/x.ics", { lookup: publicLookup, fetchImpl })).toEqual({
      ok: false,
      code: "blocked",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a name that resolves to a private address", async () => {
    const fetchImpl = vi.fn();
    const lookup = async () => ["93.184.216.34", "10.0.0.5"];
    expect(await fetchIcs(URL_OK, { lookup, fetchImpl })).toEqual({ ok: false, code: "blocked" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await fetchIcs(URL_OK, { lookup: async () => [], fetchImpl })).toEqual({
      ok: false,
      code: "blocked",
    });
    expect(
      await fetchIcs(URL_OK, {
        lookup: async () => Promise.reject(new Error("ENOTFOUND")),
        fetchImpl,
      }),
    ).toEqual({ ok: false, code: "network" });
  });

  it("follows a redirect to a public host and refuses one to a private host", async () => {
    const lookup = vi.fn(async (host: string) =>
      host === "evil.example.com" ? ["192.168.1.1"] : ["93.184.216.34"],
    );
    const ok = vi
      .fn()
      .mockResolvedValueOnce(
        respond(null, { status: 302, headers: { location: "https://cdn.example.com/a.ics" } }),
      )
      .mockResolvedValueOnce(respond(CALENDAR));
    expect(await fetchIcs(URL_OK, { lookup, fetchImpl: ok })).toEqual({ ok: true, text: CALENDAR });
    expect(ok.mock.calls[1][0]).toBe("https://cdn.example.com/a.ics");

    const bad = vi
      .fn()
      .mockResolvedValueOnce(
        respond(null, { status: 301, headers: { location: "https://evil.example.com/a.ics" } }),
      );
    expect(await fetchIcs(URL_OK, { lookup, fetchImpl: bad })).toEqual({
      ok: false,
      code: "blocked",
    });
    expect(bad).toHaveBeenCalledTimes(1);

    const toHttp = vi
      .fn()
      .mockResolvedValueOnce(
        respond(null, { status: 307, headers: { location: "http://example.com/a.ics" } }),
      );
    expect(await fetchIcs(URL_OK, { lookup, fetchImpl: toHttp })).toEqual({
      ok: false,
      code: "invalid",
    });
  });

  it("stops after three redirects", async () => {
    const fetchImpl = vi.fn(async () =>
      respond(null, {
        status: 302,
        headers: { location: "https://calendar.example.com/again.ics" },
      }),
    );
    expect(await fetchIcs(URL_OK, { lookup: publicLookup, fetchImpl })).toEqual({
      ok: false,
      code: "http",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("refuses an answer that is too large, by its length or by its stream", async () => {
    const declared = vi.fn(async () =>
      respond("x", { headers: { "content-length": "999999999" } }),
    );
    expect(await fetchIcs(URL_OK, { lookup: publicLookup, fetchImpl: declared })).toEqual({
      ok: false,
      code: "tooLarge",
    });
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024).fill(65));
      },
    });
    const streamed = vi.fn(async () => respond(stream));
    expect(
      await fetchIcs(URL_OK, { lookup: publicLookup, fetchImpl: streamed, maxBytes: 10_000 }),
    ).toEqual({
      ok: false,
      code: "tooLarge",
    });
  });

  it("gives up after the timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    expect(await fetchIcs(URL_OK, { lookup: publicLookup, fetchImpl, timeoutMs: 20 })).toEqual({
      ok: false,
      code: "timeout",
    });
    const slowLookup = () => new Promise<string[]>(() => undefined);
    expect(await fetchIcs(URL_OK, { lookup: slowLookup, fetchImpl, timeoutMs: 20 })).toEqual({
      ok: false,
      code: "timeout",
    });
  });

  it("tells an error page and a non-calendar apart", async () => {
    const missing = vi.fn(async () => respond("nope", { status: 404 }));
    expect(await fetchIcs(URL_OK, { lookup: publicLookup, fetchImpl: missing })).toEqual({
      ok: false,
      code: "http",
      status: 404,
    });
    const html = vi.fn(async () => respond("<html>Sign in</html>"));
    expect(await fetchIcs(URL_OK, { lookup: publicLookup, fetchImpl: html })).toEqual({
      ok: false,
      code: "notCalendar",
    });
    const broken = vi.fn(async () => Promise.reject(new TypeError("fetch failed")));
    expect(await fetchIcs(URL_OK, { lookup: publicLookup, fetchImpl: broken })).toEqual({
      ok: false,
      code: "network",
    });
  });
});
