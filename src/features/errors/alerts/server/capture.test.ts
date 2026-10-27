// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { alertTransport, isFrameworkSignal, prepareErrorRecord } = await import("./capture");

beforeAll(() => {
  process.env.SUPABASE_SECRET_KEY ??= "test-secret";
});

const INPUT = {
  code: "GR-7K3M9Q",
  source: "boundary" as const,
  page: "/app/kontakty/3f2b9c1e-1d2a-4c3b-8e9f-0a1b2c3d4e5f?tab=deals#x",
  message: 'Error: "Jan Novák" <jan@firma.cz> 20261234',
  stack: "Error: x\n    at a (https://gradus.app/app.js?v=1:1:2)",
  userId: "00000000-0000-4000-8000-000000000001",
  email: "jana@firma.cz",
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  ip: "203.0.113.9",
};

describe("prepareErrorRecord", () => {
  it("stores the place without ids and the text without data", () => {
    const args = prepareErrorRecord(INPUT);
    expect(args).toMatchObject({
      _code: "GR-7K3M9Q",
      _source: "boundary",
      _page: "/app/kontakty/:id",
      _stack: "at a (https://gradus.app/app.js:1:2)",
      _user_id: INPUT.userId,
      _browser: "safari",
      _device: "mobile",
      _transport: "resend",
    });
    expect(args._message).not.toMatch(/Jan|jan@|20261234/);
    expect(args._fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(args._ip_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(args)).not.toContain("203.0.113.9");
  });

  it("keeps line breaks out of the page and the action (the e-mail's subject)", () => {
    const args = prepareErrorRecord({ ...INPUT, page: "/app\r\nBcc: x@y.cz", action: "/app\n/x" });
    expect(args._page).not.toMatch(/[\r\n]/);
    expect(args._action).toBe("/app /x");
  });

  it("gives the same error on another row the same fingerprint", () => {
    const other = prepareErrorRecord({
      ...INPUT,
      code: "GR-AAAAA2",
      page: "/app/kontakty/00000000-0000-4000-8000-000000000009",
    });
    expect(other._fingerprint).toBe(prepareErrorRecord(INPUT)._fingerprint);
  });

  it("passes the limits only when given (browsers)", () => {
    expect(prepareErrorRecord(INPUT)._limit_user).toBeUndefined();
    expect(prepareErrorRecord({ ...INPUT, limits: { user: 30, anonymous: 10 } })).toMatchObject({
      _limit_user: 30,
      _limit_anonymous: 10,
    });
  });
});

describe("alertTransport", () => {
  it("mocks the e-mail only for the tests' accounts outside production", () => {
    expect(alertTransport("e2e-error-alerts-1@gradus.local", undefined)).toBe("mock");
    expect(alertTransport("e2e-error-alerts-1@gradus.local", "preview")).toBe("mock");
    expect(alertTransport("e2e-error-alerts-1@gradus.local", "production")).toBe("resend");
    expect(alertTransport("demo@gradus.local", undefined)).toBe("resend");
    expect(alertTransport(null, undefined)).toBe("resend");
  });
});

describe("isFrameworkSignal", () => {
  it("leaves out redirect(), notFound() and abandoned requests", () => {
    expect(
      isFrameworkSignal(
        Object.assign(new Error("x"), { digest: "NEXT_REDIRECT;replace;/app;307;" }),
      ),
    ).toBe(true);
    expect(
      isFrameworkSignal(Object.assign(new Error("x"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" })),
    ).toBe(true);
    expect(isFrameworkSignal(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(true);
    expect(isFrameworkSignal(Object.assign(new Error("boom"), { digest: "2385967390" }))).toBe(
      false,
    );
    expect(isFrameworkSignal(new TypeError("boom"))).toBe(false);
  });
});
