import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, safeHref } from "./simple-markdown";

describe("simple markdown", () => {
  it("reads bold, italic and links inside a line", () => {
    expect(parseInline("Umí **prodávat** a *volat*, web https://firma.cz.")).toEqual([
      { kind: "text", text: "Umí " },
      { kind: "bold", text: "prodávat" },
      { kind: "text", text: " a " },
      { kind: "italic", text: "volat" },
      { kind: "text", text: ", web " },
      { kind: "link", text: "https://firma.cz", href: "https://firma.cz/" },
      { kind: "text", text: "." },
    ]);
    expect(parseInline("[Profil](https://example.com/a)")).toEqual([
      { kind: "link", text: "Profil", href: "https://example.com/a" },
    ]);
  });

  it("never turns another scheme into a link", () => {
    expect(parseInline("[x](javascript:alert(1))")).toEqual([
      { kind: "text", text: "[x](javascript:alert(1))" },
    ]);
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("mailto:a@b.cz")).toBeNull();
  });

  it("splits paragraphs at blank lines and gathers list items", () => {
    expect(parseMarkdown("Ahoj\nsvěte\n\n- jedna\n- dvě\nKonec")).toEqual([
      {
        kind: "paragraph",
        lines: [[{ kind: "text", text: "Ahoj" }], [{ kind: "text", text: "světe" }]],
      },
      {
        kind: "list",
        items: [[{ kind: "text", text: "jedna" }], [{ kind: "text", text: "dvě" }]],
      },
      { kind: "paragraph", lines: [[{ kind: "text", text: "Konec" }]] },
    ]);
    expect(parseMarkdown("  \n\n")).toEqual([]);
  });
});
