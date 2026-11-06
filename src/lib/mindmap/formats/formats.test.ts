// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  countNodes,
  flattenFrom,
  MINDMAP_FILE_MAX_BYTES,
  node,
  normalizeTree,
  parseFreeMind,
  parseMarkdown,
  parseMindMapFile,
  parseOpml,
  parsePlainText,
  toFreeMind,
  toMarkdown,
  toOpml,
  treeDepth,
  type MindMapTree,
} from ".";
import { parseXml, XmlError } from "./xml";
import { climbsOut } from "./xmind";

const FIXTURES = path.resolve(__dirname, "../../../../tests/fixtures/mindmap");
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));
const parse = (name: string) => parseMindMapFile(name, fixture(name));

/** A tree as nested [title, done, children] for readable comparisons. */
type Shape = [string, boolean | undefined, Shape[]?];
function shape(tree: MindMapTree): Shape {
  return tree.children.length
    ? [tree.title, tree.done, tree.children.map(shape)]
    : [tree.title, tree.done];
}

/** The e-shop map every sample file carries (states as the format can tell them). */
function eshop(web: string, open: boolean | undefined = undefined): Shape {
  return [
    "Spustit e-shop",
    undefined,
    [
      [
        "Produkty",
        undefined,
        [
          ["Vybrat dodavatele", true],
          [
            "Nafotit produkty",
            undefined,
            [
              ["Pozadí a světlo", true],
              ["Úprava fotek", open],
            ],
          ],
        ],
      ],
      [
        web,
        undefined,
        [
          ["Koupit doménu", true],
          ["Vybrat šablonu", undefined],
        ],
      ],
      ["Marketing", undefined],
    ],
  ];
}

describe("sample files of every format", () => {
  it("OPML from MindNode: one central outline, _status checked", () => {
    const result = parse("sample.opml");
    expect(result).toMatchObject({ ok: true, format: "opml" });
    if (!result.ok) return;
    expect(shape(result.tree)).toEqual(eshop("Web & doména"));
  });

  it("OPML from Workflowy: several top outlines under the head title, _complete", () => {
    const result = parse("workflowy.opml");
    expect(result.ok && shape(result.tree)).toEqual([
      "",
      undefined,
      [
        ["Zavolat dodavateli", true],
        [
          "Připravit nabídku",
          undefined,
          [
            ["Ceník", true],
            ["Reference", undefined],
          ],
        ],
        ["Poslat fakturu", undefined],
      ],
    ]);
  });

  it("FreeMind / Freeplane: TEXT, rich text, character references and the OK icon", () => {
    const result = parse("sample.mm");
    expect(result).toMatchObject({ ok: true, format: "freemind" });
    if (!result.ok) return;
    expect(shape(result.tree)).toEqual(eshop("Web a doména"));
  });

  it("XMind Zen (content.json): first sheet, attached topics, task markers", () => {
    const result = parse("sample-zen.xmind");
    expect(result).toMatchObject({ ok: true, format: "xmind" });
    if (!result.ok) return;
    // task-start is a task that is not done; the floating topic is not part of the tree.
    expect(shape(result.tree)).toEqual(eshop("Web a doména", false));
  });

  it("XMind 8 (content.xml)", () => {
    const result = parse("sample-legacy.xmind");
    expect(result).toMatchObject({ ok: true, format: "xmind" });
    if (!result.ok) return;
    expect(shape(result.tree)).toEqual(eshop("Web a doména"));
  });

  it("indented text: tabs, bullets and boxes", () => {
    const result = parse("sample.txt");
    expect(result).toMatchObject({ ok: true, format: "text" });
    if (!result.ok) return;
    expect(shape(result.tree)).toEqual(eshop("Web a doména", false));
  });

  it("Markdown: headings, 4-space and tab indents, boxes, inline marks; code and front matter skipped", () => {
    const result = parse("sample.md");
    expect(result).toMatchObject({ ok: true, format: "markdown" });
    if (!result.ok) return;
    expect(shape(result.tree)).toEqual([
      "Spustit e-shop",
      undefined,
      [
        [
          "Produkty",
          undefined,
          [
            ["Vybrat dodavatele", true],
            [
              "Nafotit produkty",
              false,
              [
                ["Pozadí a světlo", true],
                ["Úprava fotek", false],
              ],
            ],
          ],
        ],
        [
          "Web",
          undefined,
          [
            ["Koupit doménu", true],
            [
              "Vybrat šablonu",
              false,
              [
                ["Barvy podle loga", false],
                ["Patička s kontakty", false],
              ],
            ],
          ],
        ],
        [
          "Marketing",
          undefined,
          [
            ["Instagram", undefined],
            ["Newsletter", undefined],
          ],
        ],
      ],
    ]);
  });
});

describe("Markdown", () => {
  it("round trip: Markdown → tree → the same Markdown", () => {
    const markdown = [
      "# Spustit e-shop",
      "",
      "- [ ] Produkty",
      "  - [x] Vybrat dodavatele",
      "  - [ ] Nafotit produkty",
      "    - [x] Pozadí a světlo",
      "    - [ ] Úprava fotek \\*retuš\\*",
      "- [x] Koupit doménu",
      "- [ ] Vybrat \\[šablonu\\] a\\\\nebo nic",
      "",
    ].join("\n");
    const tree = parseMarkdown(markdown);
    expect(tree.children[1]).toEqual({ title: "Koupit doménu", children: [], done: true });
    expect(tree.children[2].title).toBe("Vybrat [šablonu] a\\nebo nic");
    expect(toMarkdown(tree)).toBe(markdown);
  });

  it("2 spaces, 4 spaces and tabs give the same levels", () => {
    const two = parseMarkdown("- A\n  - B\n    - C\n- D");
    const four = parseMarkdown("- A\n    - B\n        - C\n- D");
    const tabs = parseMarkdown("- A\n\t- B\n\t\t- C\n- D");
    expect(shape(two)).toEqual([
      "",
      undefined,
      [
        ["A", undefined, [["B", undefined, [["C", undefined]]]]],
        ["D", undefined],
      ],
    ]);
    expect(four).toEqual(two);
    expect(tabs).toEqual(two);
  });

  it("a list under a deeper heading belongs to it; a shallower heading goes back up", () => {
    const tree = parseMarkdown("# R\n## A\n- a1\n### A.1\n- deep\n## B\n- b1");
    expect(shape(tree)).toEqual([
      "R",
      undefined,
      [
        [
          "A",
          undefined,
          [
            ["a1", undefined],
            ["A.1", undefined, [["deep", undefined]]],
          ],
        ],
        ["B", undefined, [["b1", undefined]]],
      ],
    ]);
  });

  it("without states the export has plain bullets; it can be asked for boxes", () => {
    const tree = node("Mapa", [node("A", [node("B")])]);
    expect(toMarkdown(tree)).toBe("# Mapa\n\n- A\n  - B\n");
    expect(toMarkdown(tree, { checkboxes: true })).toBe("# Mapa\n\n- [ ] A\n  - [ ] B\n");
  });
});

describe("OPML and FreeMind export", () => {
  const tree = node('Plán <2026> & "spol."', [
    node("Hotovo", [], true),
    node("Větev", [node("List\nna dva řádky")], false),
  ]);

  it("OPML writes a single central outline and reads back the same tree", () => {
    const opml = toOpml(tree);
    expect(opml).toContain('<outline text="Hotovo" _status="checked"/>');
    expect(opml).toContain("&lt;2026&gt; &amp; &quot;spol.&quot;");
    const back = parseOpml(opml);
    expect(back.title).toBe(tree.title);
    expect(shape(normalizeTree(back))).toEqual([
      'Plán <2026> & "spol."',
      undefined,
      [
        ["Hotovo", true],
        ["Větev", undefined, [["List na dva řádky", undefined]]],
      ],
    ]);
  });

  it("FreeMind writes nodes with the OK icon and reads back the same tree", () => {
    const mm = toFreeMind(tree);
    expect(mm.startsWith('<map version="1.0.1">')).toBe(true);
    expect(mm).toContain('<icon BUILTIN="button_ok"/>');
    expect(shape(normalizeTree(parseFreeMind(mm)))).toEqual([
      'Plán <2026> & "spol."',
      undefined,
      [
        ["Hotovo", true],
        ["Větev", undefined, [["List na dva řádky", undefined]]],
      ],
    ]);
  });
});

describe("plain text", () => {
  it("spaces of any width nest by the stack of indents", () => {
    expect(shape(parsePlainText("Root\n   a\n      a1\n   b\n"))).toEqual([
      "Root",
      undefined,
      [
        ["a", undefined, [["a1", undefined]]],
        ["b", undefined],
      ],
    ]);
  });
});

describe("safety and limits", () => {
  it("a DOCTYPE with entity declarations is refused, nothing is expanded", () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE opml [<!ENTITY x SYSTEM "file:///etc/passwd">]><opml><body><outline text="&x;"/></body></opml>`;
    expect(() => parseXml(xxe)).toThrow(XmlError);
    expect(parseMindMapFile("evil.opml", strToU8(xxe))).toEqual({ ok: false, error: "unsafe" });
    const laughs = `<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><map><node TEXT="&lol2;"/></map>`;
    expect(parseMindMapFile("lol.mm", strToU8(laughs))).toEqual({ ok: false, error: "unsafe" });
  });

  it("an unknown entity stays as written", () => {
    const result = parseMindMapFile(
      "x.opml",
      strToU8('<opml><body><outline text="A &unknown; B &#x41;"/></body></opml>'),
    );
    expect(result.ok && result.tree.title).toBe("A &unknown; B A");
  });

  it("a ZIP with an entry that climbs out of the folder is refused", () => {
    expect(parse("traversal.xmind")).toEqual({ ok: false, error: "unsafe" });
    expect(climbsOut("../evil")).toBe(true);
    expect(climbsOut("a/../../b")).toBe(true);
    expect(climbsOut("/etc/passwd")).toBe(true);
    expect(climbsOut("C:\\evil")).toBe(true);
    expect(climbsOut("content.json")).toBe(false);
    expect(climbsOut("Thumbnails/thumbnail.png")).toBe(false);
  });

  it("files over 2 MB, empty files, broken XML and unknown types", () => {
    expect(parseMindMapFile("big.md", new Uint8Array(MINDMAP_FILE_MAX_BYTES + 1))).toEqual({
      ok: false,
      error: "tooLarge",
    });
    expect(parseMindMapFile("a.md", new Uint8Array())).toEqual({ ok: false, error: "empty" });
    expect(parseMindMapFile("a.md", strToU8("\n \n"))).toEqual({ ok: false, error: "empty" });
    expect(parseMindMapFile("a.opml", strToU8("<opml><body><outline text='a'>"))).toEqual({
      ok: false,
      error: "unreadable",
    });
    expect(parseMindMapFile("a.pdf", strToU8("%PDF-1.7"))).toEqual({
      ok: false,
      error: "unsupported",
    });
    expect(parseMindMapFile("a.xmind", strToU8("not a zip"))).toEqual({
      ok: false,
      error: "unreadable",
    });
  });

  it("a MindNode package is explained, not read", () => {
    expect(parseMindMapFile("Plan.mindnode", strToU8("x"))).toEqual({
      ok: false,
      error: "mindnodePackage",
    });
    const zipped = zipSync({ "Plan.mindnode/contents.xml": strToU8("<plist/>") });
    expect(parseMindMapFile("Plan.zip", zipped)).toEqual({ ok: false, error: "mindnodePackage" });
  });

  it("content decides over the name: an OPML saved as .txt is OPML", () => {
    const result = parseMindMapFile("export.txt", fixture("sample.opml"));
    expect(result).toMatchObject({ ok: true, format: "opml" });
  });

  it("too many nodes are refused", () => {
    const lines = Array.from({ length: 5001 }, (_, index) => `- ${index}`).join("\n");
    expect(parseMindMapFile("many.md", strToU8(`# R\n${lines}`))).toEqual({
      ok: false,
      error: "tooManyNodes",
    });
  });
});

describe("tree helpers", () => {
  const deep = node("R", [node("a", [node("b", [node("c", [node("d")])]), node("b2")]), node("x")]);

  it("counts nodes below the root and levels", () => {
    expect(countNodes(deep)).toBe(6);
    expect(treeDepth(deep)).toBe(4);
    expect(treeDepth(node("R"))).toBe(0);
  });

  it("flattening from a level lifts everything deeper to it, in order", () => {
    const flat = flattenFrom(deep, 2);
    expect(treeDepth(flat)).toBe(2);
    expect(shape(flat)).toEqual([
      "R",
      undefined,
      [
        [
          "a",
          undefined,
          [
            ["b", undefined],
            ["c", undefined],
            ["d", undefined],
            ["b2", undefined],
          ],
        ],
        ["x", undefined],
      ],
    ]);
    expect(countNodes(flat)).toBe(countNodes(deep));
  });

  it("a node without a title hands its children to its parent", () => {
    expect(
      shape(normalizeTree(node(" R ", [node("  ", [node("a"), node("b")]), node("c")]))),
    ).toEqual([
      "R",
      undefined,
      [
        ["a", undefined],
        ["b", undefined],
        ["c", undefined],
      ],
    ]);
  });
});
