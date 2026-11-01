import { describe, expect, it } from "vitest";
import {
  cleanConsoleErrors,
  decodeScreenshot,
  prepareReport,
  reportSchema,
  REPORT_CONSOLE_MAX,
} from "./report";

const base = { kind: "bug", description: "It broke", page: "/app/pipeline" } as const;

function jpegDataUrl(bytes = 200): string {
  const body = Buffer.alloc(bytes, 1);
  body[0] = 0xff;
  body[1] = 0xd8;
  body[2] = 0xff;
  body[bytes - 2] = 0xff;
  body[bytes - 1] = 0xd9;
  return `data:image/jpeg;base64,${body.toString("base64")}`;
}

describe("reportSchema", () => {
  it("needs a kind and a non-empty description", () => {
    expect(reportSchema.safeParse(base).success).toBe(true);
    expect(reportSchema.safeParse({ ...base, description: "   " }).success).toBe(false);
    expect(reportSchema.safeParse({ ...base, kind: "praise" }).success).toBe(false);
  });

  it("refuses fields it does not know (a user id, say)", () => {
    expect(reportSchema.safeParse({ ...base, userId: "x" }).success).toBe(false);
  });
});

describe("cleanConsoleErrors", () => {
  it("keeps the last 20 and scrubs e-mails and long numbers", () => {
    const entries = Array.from({ length: 30 }, (_, index) => ({
      at: "2026-11-01T10:00:00.000Z",
      kind: "console" as const,
      message: `line ${index} jan@example.com 123456789`,
    }));
    const cleaned = cleanConsoleErrors(entries);
    expect(cleaned).toHaveLength(REPORT_CONSOLE_MAX);
    expect(cleaned[0].message).toContain("line 10");
    expect(cleaned.every((entry) => !entry.message.includes("@"))).toBe(true);
    expect(cleaned.every((entry) => !/\d{5,}/.test(entry.message))).toBe(true);
  });

  it("shortens a long line", () => {
    const [entry] = cleanConsoleErrors([
      { at: "2026-11-01T10:00:00.000Z", kind: "error", message: "x".repeat(900) },
    ]);
    expect(entry.message.length).toBeLessThanOrEqual(200);
  });
});

describe("decodeScreenshot", () => {
  it("accepts a real JPEG", () => {
    expect(decodeScreenshot(jpegDataUrl())?.byteLength).toBe(200);
  });

  it("refuses what is not a JPEG by content, however it is labelled", () => {
    const fake = `data:image/jpeg;base64,${Buffer.from("<script>alert(1)</script>").toString("base64")}`;
    expect(decodeScreenshot(fake)).toBeNull();
    expect(decodeScreenshot("data:image/png;base64,AAAA")).toBeNull();
    expect(decodeScreenshot(undefined)).toBeNull();
  });

  it("refuses an image over the limit", () => {
    expect(decodeScreenshot(jpegDataUrl(1_600_000))).toBeNull();
  });
});

describe("prepareReport", () => {
  it("cleans the page of ids and flags a rejected screenshot", () => {
    const parsed = reportSchema.parse({
      ...base,
      page: "/app/kontakty/3f2b8f0e-1111-4222-8333-444455556666?x=1",
      screenshot: "data:image/jpeg;base64,AAAA",
    });
    const prepared = prepareReport(parsed);
    expect(prepared.page).toBe("/app/kontakty/:id");
    expect(prepared.screenshot).toBeNull();
    expect(prepared.screenshotRejected).toBe(true);
  });
});
