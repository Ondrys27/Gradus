import { describe, expect, it } from "vitest";
import { CHAT_FILE_ACCEPT, chatFileType } from "./types";

describe("chatFileType", () => {
  it("takes the types the bucket takes as they are", () => {
    expect(chatFileType({ name: "a.pdf", type: "application/pdf" })).toBe("application/pdf");
    expect(chatFileType({ name: "a.png", type: "image/png" })).toBe("image/png");
  });

  it("maps the names Windows and others give a zip or a csv", () => {
    expect(chatFileType({ name: "a.zip", type: "application/x-zip-compressed" })).toBe("application/zip");
    expect(chatFileType({ name: "a.csv", type: "application/vnd.ms-excel" })).toBe("text/csv");
    expect(chatFileType({ name: "a.csv", type: "" })).toBe("text/csv");
  });

  it("falls back to the extension only when the system says nothing", () => {
    expect(chatFileType({ name: "smlouva.DOCX", type: "" })).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(chatFileType({ name: "a.zip", type: "application/octet-stream" })).toBe("application/zip");
  });

  it("refuses what the chat does not take", () => {
    expect(chatFileType({ name: "a.exe", type: "application/x-msdownload" })).toBeNull();
    expect(chatFileType({ name: "a.exe", type: "" })).toBeNull();
    expect(chatFileType({ name: "a.html", type: "text/html" })).toBeNull();
  });

  it("lets the picker show zips and csvs on every system", () => {
    expect(CHAT_FILE_ACCEPT).toContain(".zip");
    expect(CHAT_FILE_ACCEPT).toContain("text/csv");
  });
});
