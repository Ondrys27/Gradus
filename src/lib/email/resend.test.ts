// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isReservedAddress, sendEmail } from "./resend";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("isReservedAddress", () => {
  it("knows the names kept for examples (RFC 2606 and 6761)", () => {
    for (const address of [
      "jana.novakova@example.com",
      "x@EXAMPLE.org",
      "x@mail.example.net",
      "x@firma.example",
      "x@nobody.invalid",
      "x@local.test",
    ]) {
      expect(isReservedAddress(address), address).toBe(true);
    }
    for (const address of ["jana@firma.cz", "x@example.cz", "x@notexample.com", "x@gradus.local"]) {
      expect(isReservedAddress(address), address).toBe(false);
    }
  });
});

describe("sendEmail", () => {
  it("never sends to a reserved address and leaves such copies out", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "e1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const message = { subject: "s", text: "t", html: "<p>t</p>" };

    expect(await sendEmail({ ...message, to: "guest@example.com" })).toEqual({
      ok: false,
      error: "reserved address",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    expect(await sendEmail({ ...message, to: "jana@firma.cz", cc: ["copy@example.com", "petr@firma.cz"] })).toEqual({
      ok: true,
      id: "e1",
    });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.cc).toEqual(["petr@firma.cz"]);
  });
});
