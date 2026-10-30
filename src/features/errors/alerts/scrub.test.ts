import { describe, expect, it } from "vitest";
import { errorText, scrubErrorMessage, scrubStack, STACK_LINES } from "./scrub";

describe("scrubErrorMessage", () => {
  it("keeps the technical text", () => {
    expect(
      scrubErrorMessage("TypeError: Cannot read properties of undefined (reading 'name')"),
    ).toBe("TypeError: Cannot read properties of undefined (reading 'name')");
  });

  it("takes out e-mails, long numbers, typed values, amounts and ids", () => {
    const scrubbed = scrubErrorMessage(
      `Error: contact "Jan Novák" <jan@firma.cz> invoice 20261234 for 1 500 Kč, row 3f2b9c1e-1d2a-4c3b-8e9f-0a1b2c3d4e5f, €12.50`,
    );
    expect(scrubbed).not.toMatch(/Jan|Novák|jan@|firma|20261234|1 500|12\.50|3f2b9c1e/);
    expect(scrubbed).toContain("[text]");
    expect(scrubbed).toContain("[amount]");
    expect(scrubbed).toContain(":id");
  });

  it("takes out phones written in groups", () => {
    const scrubbed = scrubErrorMessage("Error: invalid phone +420 777 123 456 or 777-123-456");
    expect(scrubbed).not.toMatch(/777|123|456/);
    expect(scrubErrorMessage("Error: line 12 of 40")).toBe("Error: line 12 of 40");
  });

  it("cuts long text and never returns an empty string", () => {
    expect(scrubErrorMessage("x".repeat(500))).toHaveLength(200);
    expect(scrubErrorMessage("")).toBe("unknown");
  });

  it("reads anything thrown", () => {
    expect(errorText(new TypeError("boom"))).toBe("TypeError: boom");
    expect(errorText("plain")).toBe("plain");
    expect(errorText({ any: 1 })).toBe("unknown");
  });
});

describe("scrubStack", () => {
  it("keeps only the first frames, without the message line", () => {
    const stack = [
      "TypeError: secret message with jan@firma.cz",
      ...Array.from(
        { length: 15 },
        (_, i) =>
          `    at fn${i} (https://gradus.app/_next/static/chunks/app.js?dpl=abc:1:${2000 + i})`,
      ),
    ].join("\n");
    const lines = scrubStack(stack)!.split("\n");
    expect(lines).toHaveLength(STACK_LINES);
    expect(lines[0]).toBe("at fn0 (https://gradus.app/_next/static/chunks/app.js:1:2000)");
    expect(lines.join("\n")).not.toContain("secret");
  });

  it("reads the Firefox and Safari format and takes out ids and e-mails", () => {
    const stack =
      "render@https://gradus.app/app/kontakty/3f2b9c1e-1d2a-4c3b-8e9f-0a1b2c3d4e5f/jan@firma.cz.js:4:12";
    expect(scrubStack(stack)).toBe("render@https://gradus.app/app/kontakty/:id/[email]:4:12");
  });

  it("is null without frames", () => {
    expect(scrubStack("Error: only a message")).toBeNull();
    expect(scrubStack(undefined)).toBeNull();
  });
});
