import { describe, expect, it } from "vitest";
import {
  atMostLines,
  hasMarkdown,
  hasThreePoints,
  looksLikeLanguage,
  passShare,
  runChecks,
} from "./checks";

describe("format checks of a compared answer", () => {
  it("always checks that there is an answer and that it was not cut off", () => {
    const results = runChecks({}, { text: "Hotovo.", stopReason: "end_turn", lang: "cs" });
    expect(results).toEqual([
      { key: "answered", ok: true },
      { key: "complete", ok: true },
    ]);
    const cut = runChecks({}, { text: "  ", stopReason: "max_tokens", lang: "cs" });
    expect(cut.every((result) => !result.ok)).toBe(true);
  });

  it("parses JSON with the job's parser and checks length, plain text and shape", () => {
    const spec = {
      json: (text: string) => text.startsWith("{"),
      maxChars: 10,
      plain: true,
      shape: atMostLines(1),
    };
    const ok = runChecks(spec, { text: '{"a":1}', stopReason: "end_turn", lang: "en" });
    expect(ok.every((result) => result.ok)).toBe(true);
    const bad = runChecks(spec, {
      text: "## Nadpis\n**tučně** a hodně dlouhý text",
      stopReason: "end_turn",
      lang: "en",
    });
    expect(bad.filter((result) => !result.ok).map((result) => result.key)).toEqual([
      "json",
      "length",
      "plain",
      "shape",
    ]);
  });

  it("tells Czech from English, tolerating Czech names in an English answer", () => {
    expect(looksLikeLanguage("Dobrý den, posílám nabídku na příští týden.", "cs")).toBe(true);
    expect(looksLikeLanguage("Hi Sarah, sorry we missed Monday.", "cs")).toBe(false);
    expect(
      looksLikeLanguage(
        "Call Jana Lípová tomorrow at nine about the offer for the website and the price of it.",
        "en",
      ),
    ).toBe(true);
    expect(looksLikeLanguage("", "en")).toBe(false);
  });

  it("finds markdown and the summaries' three points", () => {
    expect(hasMarkdown("# Title")).toBe(true);
    expect(hasMarkdown("| a | b |")).toBe(true);
    expect(hasMarkdown("Plain sentence, 3 * 4 = 12.")).toBe(false);
    expect(hasThreePoints("Dobrý týden.\n1. Zavolat\n2. Poslat\n3. Fakturovat")).toBe(true);
    expect(hasThreePoints("1. Jen jedna")).toBe(false);
  });

  it("gives the share of passed checks", () => {
    expect(passShare([])).toBeNull();
    expect(
      passShare([
        { key: "answered", ok: true },
        { key: "json", ok: false },
      ]),
    ).toBe(0.5);
  });
});
