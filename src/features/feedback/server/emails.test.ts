import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { reportFixedEmail, reportOwnerEmail, welcomeBetaEmail } = await import("./emails");
const { isTestAddress } = await import("./notify");

describe("welcomeBetaEmail", () => {
  it("thanks the tester, explains the beta in three sentences, says how to report, links in", () => {
    for (const locale of ["cs", "en"]) {
      const mail = welcomeBetaEmail(
        { name: "Jana", appUrl: "https://app.example.com/app" },
        locale,
      );
      expect(mail.subject).toContain("Gradus");
      expect(mail.text).toContain("Jana");
      expect(mail.text).toContain("Ctrl+Shift+B");
      expect(mail.text).toContain("https://app.example.com/app");
      expect(mail.html).toContain('href="https://app.example.com/app"');
      expect(mail.text).not.toMatch(/\{|\}/);
    }
  });

  it("is in the person's language", () => {
    expect(welcomeBetaEmail({ name: null, appUrl: null }, "cs").text).toContain("Ahoj");
    expect(welcomeBetaEmail({ name: null, appUrl: null }, "en").text).toContain("Hi");
  });
});

describe("reportFixedEmail", () => {
  it("is short and thankful", () => {
    const mail = reportFixedEmail({ appUrl: null }, "en");
    expect(mail.text).toContain("thank you");
    expect(mail.text.length).toBeLessThan(400);
  });
});

describe("reportOwnerEmail", () => {
  it("carries the report and escapes it in the HTML part", () => {
    const mail = reportOwnerEmail(
      {
        id: "r1",
        kind: "idea",
        description: "<script>alert(1)</script> more",
        expected: null,
        page: "/app/pipeline",
        browser: "safari",
        device: "mobile",
        viewport: "390x844",
        locale: "cs",
        version: "abc1234",
        consoleCount: 3,
        screenshot: true,
        user: { name: "Jana", email: "jana@example.com" },
        adminUrl: "https://app.example.com/admin/zpetna-vazba?tab=reports&report=r1",
      },
      "cs",
    );
    expect(mail.subject).toContain("Nápad");
    expect(mail.text).toContain("jana@example.com");
    expect(mail.text).toContain("3 chyby z konzole");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&#60;script&#62;");
  });
});

describe("isTestAddress", () => {
  it("recognises the internal test accounts", () => {
    expect(isTestAddress("e2e-abc@gradus.local")).toBe(true);
    expect(isTestAddress("jana@example.com")).toBe(false);
    expect(isTestAddress(null)).toBe(false);
  });
});
