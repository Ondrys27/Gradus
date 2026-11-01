// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearConsoleEntries,
  consoleEntries,
  installConsoleBuffer,
  pushConsoleEntry,
} from "./console-buffer";

beforeEach(() => clearConsoleEntries());

describe("console buffer", () => {
  it("keeps the last 20 entries, scrubbed", () => {
    for (let index = 0; index < 25; index += 1) {
      pushConsoleEntry("error", new Error(`boom ${index} jan@example.com 99999999`));
    }
    const entries = consoleEntries();
    expect(entries).toHaveLength(20);
    expect(entries[0].message).toContain("boom 5");
    expect(entries[19].message).toContain("boom 24");
    expect(entries.every((entry) => !entry.message.includes("@"))).toBe(true);
    expect(entries.every((entry) => !/\d{5,}/.test(entry.message))).toBe(true);
  });

  it("records console.error calls and window errors once installed", () => {
    const original = console.error;
    console.error = () => {};
    installConsoleBuffer();
    installConsoleBuffer();
    console.error("Warning: failed prop");
    window.dispatchEvent(new ErrorEvent("error", { message: "Script error x" }));
    const messages = consoleEntries().map((entry) => `${entry.kind}:${entry.message}`);
    expect(messages).toEqual(["console:Warning: failed prop", "error:Script error x"]);
    console.error = original;
  });
});
