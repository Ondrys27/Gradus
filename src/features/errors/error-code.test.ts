import { describe, expect, it } from "vitest";
import { parseEvent } from "@/lib/analytics/events";
import { createErrorCode, errorCodeFor, isErrorCode, normalizeErrorCodeQuery } from "./error-code";

describe("error codes", () => {
  it("look like GR- and six readable characters", () => {
    for (let i = 0; i < 500; i += 1) {
      const code = createErrorCode();
      expect(code).toMatch(/^GR-[2-9A-HJKMNP-TV-Z]{6}$/);
      expect(isErrorCode(code)).toBe(true);
      // Analytics would refuse six digits in a row.
      expect(code).not.toMatch(/\d{6}/);
    }
  });

  it("are practically never the same twice", () => {
    const codes = new Set(Array.from({ length: 2000 }, createErrorCode));
    expect(codes.size).toBe(2000);
  });

  it("stay the same for one error and change for the next", () => {
    const first = new Error("a");
    const second = new Error("a");
    expect(errorCodeFor(first)).toBe(errorCodeFor(first));
    expect(errorCodeFor(second)).not.toBe(errorCodeFor(first));
    expect(isErrorCode(errorCodeFor("not an object"))).toBe(true);
  });

  it("travel in the client_error event, and nothing else in their place", () => {
    const base = { route: "/app", source: "boundary", message: "Error: boom" } as const;
    expect(parseEvent("client_error", { ...base, code: createErrorCode() }, "client").ok).toBe(
      true,
    );
    expect(parseEvent("client_error", base, "client").ok).toBe(true);
    expect(parseEvent("client_error", { ...base, code: "jan@example.com" }, "client").ok).toBe(
      false,
    );
    expect(parseEvent("client_error", { ...base, code: "GR-123" }, "client").ok).toBe(false);
  });
});

describe("normalizeErrorCodeQuery", () => {
  it("reads what people type as the beginning of a code", () => {
    expect(normalizeErrorCodeQuery("GR-7K3M9Q")).toBe("GR-7K3M9Q");
    expect(normalizeErrorCodeQuery(" gr-7k3m9q ")).toBe("GR-7K3M9Q");
    expect(normalizeErrorCodeQuery("gr7k3")).toBe("GR-7K3");
    expect(normalizeErrorCodeQuery("7K3M")).toBe("GR-7K3M");
    expect(normalizeErrorCodeQuery("GR 7K3 M9Q")).toBe("GR-7K3M9Q");
  });

  it("refuses anything that can not be a code", () => {
    expect(normalizeErrorCodeQuery("")).toBeNull();
    expect(normalizeErrorCodeQuery(null)).toBeNull();
    expect(normalizeErrorCodeQuery("GR-")).toBeNull();
    expect(normalizeErrorCodeQuery("%")).toBeNull();
    expect(normalizeErrorCodeQuery("GR-7K3M9QX")).toBeNull();
    expect(normalizeErrorCodeQuery("GR-7K_")).toBeNull();
  });
});
