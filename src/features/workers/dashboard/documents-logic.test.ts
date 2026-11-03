import { describe, expect, it } from "vitest";
import { checkDocument, documentKind, documentMime, documentName } from "./documents-logic";

describe("documents", () => {
  it("takes the browser's type or falls back to the extension", () => {
    expect(documentMime({ name: "a.pdf", type: "application/pdf" })).toBe("application/pdf");
    expect(documentMime({ name: "Smlouva.DOCX", type: "" })).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(documentMime({ name: "virus.exe", type: "application/x-msdownload" })).toBeNull();
  });

  it("refuses files over 20 MB, empty ones and other types", () => {
    expect(
      checkDocument({ name: "a.pdf", type: "application/pdf", size: 20 * 1024 * 1024 }),
    ).toBeNull();
    expect(
      checkDocument({ name: "a.pdf", type: "application/pdf", size: 20 * 1024 * 1024 + 1 }),
    ).toBe("tooLarge");
    expect(checkDocument({ name: "a.pdf", type: "application/pdf", size: 0 })).toBe("tooLarge");
    expect(checkDocument({ name: "a.zip", type: "application/zip", size: 10 })).toBe("wrongType");
  });

  it("names and sorts documents into kinds", () => {
    expect(documentName("  Pracovní   smlouva.pdf ")).toBe("Pracovní smlouva.pdf");
    expect(documentName("   ")).toBe("document");
    expect(documentName("x".repeat(300))).toHaveLength(200);
    expect(documentKind("image/png")).toBe("image");
    expect(documentKind("text/csv")).toBe("text");
    expect(documentKind("application/vnd.ms-excel")).toBe("office");
  });
});
