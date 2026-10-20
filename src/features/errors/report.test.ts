import { describe, expect, it } from "vitest";
import { mayUseCrashTest } from "./crash-test";
import { bugReportSchema, prepareBugReport, reportPage } from "./report";

describe("reportPage", () => {
  it("keeps the page but not the ids, tokens, queries or e-mails in it", () => {
    expect(reportPage("/app/kontakty")).toBe("/app/kontakty");
    expect(reportPage("/app/kontakty/5b1c2f9e-7d1a-4c0e-9a55-0f3b2e6d8c11")).toBe(
      "/app/kontakty/:id",
    );
    // An invitation link's token, for example.
    expect(reportPage("/x/pozvanka/Zx81kLm0QpRt7yUv3wNs2aBc")).toBe("/x/pozvanka/:id");
    expect(reportPage("/app/pipeline?q=Novák&deal=12")).toBe("/app/pipeline");
    expect(reportPage("/app/x/jan%40example.com")).toBe("/app/x/:id");
    expect(reportPage("/app/finance/2026001")).toBe("/app/finance/:id");
    expect(reportPage("")).toBe("/");
    expect(reportPage(`/app/${"a/".repeat(400)}`).length).toBeLessThanOrEqual(300);
  });
});

describe("bug report body", () => {
  const valid = { code: "GR-7K3M9Q", page: "/app" };

  it("accepts a report with or without a note", () => {
    expect(bugReportSchema.safeParse(valid).success).toBe(true);
    expect(
      bugReportSchema.safeParse({
        ...valid,
        description: "Clicked save",
        message: "TypeError: x is undefined",
        digest: "2385967390",
        viewport: "390x844",
        locale: "cs",
        version: "abc1234",
      }).success,
    ).toBe(true);
  });

  it("refuses a user named in the body, a bad code or an oversized note", () => {
    expect(bugReportSchema.safeParse({ ...valid, userId: "someone" }).success).toBe(false);
    expect(bugReportSchema.safeParse({ ...valid, code: "GR-%" }).success).toBe(false);
    expect(bugReportSchema.safeParse({ ...valid, description: "x".repeat(2001) }).success).toBe(
      false,
    );
    expect(bugReportSchema.safeParse({ ...valid, locale: "de" }).success).toBe(false);
    expect(bugReportSchema.safeParse({ ...valid, digest: "a b" }).success).toBe(false);
  });

  it("is stored scrubbed and trimmed", () => {
    const prepared = prepareBugReport(
      bugReportSchema.parse({
        ...valid,
        page: "/app/kontakty/5b1c2f9e-7d1a-4c0e-9a55-0f3b2e6d8c11?tab=notes",
        description: "   ",
        message: "Error: no contact jan@example.com with phone 777123456",
      }),
    );
    expect(prepared.page).toBe("/app/kontakty/:id");
    expect(prepared.description).toBeNull();
    expect(prepared.message).toBe("Error: no contact [email] with phone [n]");
  });
});

describe("the crash test page", () => {
  it("is only for the internal test accounts", () => {
    expect(mayUseCrashTest("e2e-error-1234@gradus.local")).toBe(true);
    expect(mayUseCrashTest("demo@GRADUS.local")).toBe(true);
    expect(mayUseCrashTest("ondrej@example.com")).toBe(false);
    expect(mayUseCrashTest("x@gradus.local.example.com")).toBe(false);
    expect(mayUseCrashTest(undefined)).toBe(false);
  });
});
