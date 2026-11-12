import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseMindMapFile, parsePlainText, toMarkdown } from "@/lib/mindmap/formats";
import { draftFromDoc, type DocNode } from "../document";
import { templateMapDraft } from "../templates";
import {
  appendTextToMap,
  appendTreeToMap,
  mapToMindTree,
  mapToTextDoc,
  mindTreeToMap,
  replaceMapWithTree,
  textDocToMap,
} from "./convert";
import {
  isMapDoc,
  MAP_LIMITS,
  mapDraft,
  mapToOutline,
  mentionsInMap,
  newMapDoc,
  normalizeUrl,
  sanitizeMapDoc,
  type MapDoc,
  type MapNode,
} from "./map-doc";
import { insertSuggestions } from "./map-ops";

const FIXTURES = path.resolve(__dirname, "../../../../tests/fixtures/mindmap");

const text = (value: string): DocNode => ({ type: "text", text: value });
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const h = (level: number, value: string): DocNode => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});
const ul = (...items: DocNode[][]): DocNode => ({
  type: "bulletList",
  content: items.map((content) => ({ type: "listItem", content })),
});
const mention = (label: string): DocNode => ({
  type: "mention",
  attrs: { type: "contact", id: "11111111-2222-4333-8444-555555555555", label },
});

/** Titles only, for comparing shapes. */
function shape(node: MapNode): unknown {
  return node.children.length ? { [node.title]: node.children.map(shape) } : node.title;
}

describe("a map note's document", () => {
  it("cleans whatever is stored: ids unique, unknown fields gone, limits kept", () => {
    const doc = sanitizeMapDoc({
      type: "mindmap",
      version: 1,
      root: {
        id: "r",
        title: "  Konkurence  ",
        evil: "<script>",
        children: [
          { id: "x", title: "A", color: "hotpink", link: { type: "url", href: "javascript:alert(1)" } },
          { id: "x", title: "B", suggested: true, link: { type: "url", href: "kavarna.cz" } },
          "nonsense",
        ],
      },
    });
    expect(doc.root.title).toBe("Konkurence");
    expect(doc.root).not.toHaveProperty("evil");
    expect(doc.root.children).toHaveLength(2);
    const [a, b] = doc.root.children;
    expect(a.color).toBeUndefined();
    expect(a.link).toBeUndefined();
    expect(b.id).not.toBe("x");
    expect(b.link).toEqual({ type: "url", href: "https://kavarna.cz/" });
    expect(b.suggested).toBe(true);

    const notAMap = sanitizeMapDoc({ type: "doc", content: [] });
    expect(isMapDoc(notAMap)).toBe(true);
    expect(notAMap.root.children).toEqual([]);
  });

  it("keeps only http(s) and mailto links", () => {
    expect(normalizeUrl("gradus.app")).toBe("https://gradus.app/");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("data:text/html,x")).toBeNull();
    expect(normalizeUrl("x".repeat(MAP_LIMITS.href + 30))).toBeNull();
  });

  it("writes the indented outline for search and Grady, suggestions left out", () => {
    const base: MapDoc = {
      type: "mindmap",
      version: 1,
      root: {
        id: "r",
        title: "Konkurence",
        children: [
          {
            id: "a",
            title: "Kavárna U Rohu",
            note: "levnější\nespresso",
            link: { type: "url", href: "https://urohu.cz/" },
            children: [{ id: "a1", title: "Ceny", children: [] }],
          },
          {
            id: "b",
            title: "Majitel",
            link: { type: "mention", attrs: { type: "contact", id: "c1", label: "Jan Novák" } },
            children: [],
          },
        ],
      },
    };
    const { doc } = insertSuggestions(base, "r", [{ title: "Návrh Gradyho" }]);
    const outline = mapToOutline(doc, { mentionText: (kind, label) => `[kontakt: ${label}]` });
    expect(outline).toBe(
      [
        "Konkurence",
        "  Kavárna U Rohu (https://urohu.cz/) — levnější espresso",
        "    Ceny",
        "  Majitel [kontakt: Jan Novák]",
      ].join("\n"),
    );
    // The outline reads back as the same tree in the text format of 20.2.
    expect(parsePlainText(outline).children.map((child) => child.children.length)).toEqual([1, 0]);

    const draft = mapDraft(doc);
    expect(draft).toMatchObject({ kind: "mindmap", title: "Konkurence" });
    expect(draft.content).toBe(doc);
    expect(mentionsInMap(doc)).toEqual([{ type: "contact", id: "c1", label: "Jan Novák" }]);
  });

  it("is blank (and goes when left) only without any text", () => {
    expect(mapDraft(newMapDoc()).content_text).toBe("");
    expect(mapDraft(newMapDoc("", ["A"])).content_text).toBe("\n  A");
  });

  it("has a map variant of the templates: the ideal customer with Who · Problems · Where · Objections", () => {
    const draft = templateMapDraft("idealCustomer", (key) => key);
    expect(draft.kind).toBe("mindmap");
    const doc = draft.content as MapDoc;
    expect(doc.root.title).toBe("idealCustomer.title");
    expect(doc.root.children.map((child) => child.title)).toEqual([
      "idealCustomer.map.who",
      "idealCustomer.map.problems",
      "idealCustomer.map.where",
      "idealCustomer.map.objections",
    ]);
  });
});

describe("text note → map", () => {
  it("makes the first line the centre and nests headings, lists and lines under them", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        h(1, "Konkurence"),
        p(text("Kdo je kolem nás")),
        h(2, "Kavárny"),
        ul([p(text("U Rohu")), ul([p(text("levná"))])], [p(text("Café Nero"))]),
        h(3, "Ceny"),
        p(text("Espresso 55")),
        h(2, "Pekárny"),
        { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p(text("Paul"))] }] },
      ],
    };
    const map = textDocToMap(doc);
    expect(shape(map.root)).toEqual({
      Konkurence: [
        "Kdo je kolem nás",
        { Kavárny: [{ "U Rohu": ["levná"] }, "Café Nero", { Ceny: ["Espresso 55"] }] },
        { Pekárny: ["Paul"] },
      ],
    });
  });

  it("turns one record in a line into the node's chip and a link mark into its address", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        p(text("Lidé")),
        ul(
          [p(text("Zavolat "), mention("Jan Novák"))],
          [p({ type: "text", text: "web", marks: [{ type: "link", attrs: { href: "https://kava.cz" } }] })],
        ),
      ],
    };
    const [first, second] = textDocToMap(doc).root.children;
    expect(first.title).toBe("Zavolat");
    expect(first.link).toEqual({
      type: "mention",
      attrs: { type: "contact", id: "11111111-2222-4333-8444-555555555555", label: "Jan Novák" },
    });
    expect(second).toMatchObject({ title: "web", link: { type: "url", href: "https://kava.cz/" } });
  });

  it("names an empty text after the note", () => {
    expect(textDocToMap({ type: "doc", content: [] }, "Nápady").root.title).toBe("Nápady");
  });
});

describe("map → text note", () => {
  it("writes the centre as the heading and the branches as a nested list, and comes back the same", () => {
    const source = textDocToMap({
      type: "doc",
      content: [h(1, "Plán"), ul([p(text("Web")), ul([p(text("Texty"))])], [p(text("Reklama"))])],
    });
    const { doc: withSuggestion } = insertSuggestions(source, source.root.id, [{ title: "Jen návrh" }]);
    const textDoc = mapToTextDoc(withSuggestion);
    const draft = draftFromDoc(textDoc);
    expect(draft.title).toBe("Plán");
    expect(draft.content_text).toBe(["Plán", "- Web", "  - Texty", "- Reklama"].join("\n"));
    expect(shape(textDocToMap(textDoc).root)).toEqual(shape(source.root));
  });

  it("keeps a node's note under it and its record as a chip", () => {
    const map: MapDoc = {
      type: "mindmap",
      version: 1,
      root: {
        id: "r",
        title: "Lidé",
        children: [
          {
            id: "a",
            title: "Zavolat",
            note: "ráno",
            link: { type: "mention", attrs: { type: "deal", id: "d1", label: "Web pro kavárnu" } },
            children: [],
          },
        ],
      },
    };
    const item = mapToTextDoc(map).content![1].content![0];
    expect(item.content![0].content).toEqual([
      { type: "text", text: "Zavolat" },
      { type: "text", text: " " },
      { type: "mention", attrs: { type: "deal", id: "d1", label: "Web pro kavárnu" } },
    ]);
    expect(item.content![1]).toEqual({ type: "paragraph", content: [{ type: "text", text: "ráno" }] });
  });
});

describe("files ↔ map", () => {
  it("imports an OPML file as a new map and exports it to Markdown without suggestions", () => {
    const file = readFileSync(path.join(FIXTURES, "sample.opml"));
    const result = parseMindMapFile("sample.opml", new Uint8Array(file));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const map = mindTreeToMap(result.tree, "sample");
    expect(map.root.title).toBe(result.tree.title || "sample");
    const { doc } = insertSuggestions(map, map.root.id, [{ title: "Jen návrh" }]);
    const markdown = toMarkdown(mapToMindTree(doc), { checkboxes: false });
    expect(markdown).not.toContain("Jen návrh");
    expect(markdown).not.toContain("[ ]");
    expect(markdown.startsWith(`# ${map.root.title}`)).toBe(true);
  });

  it("adds a file's branches under the centre or replaces the map, keeping the centre", () => {
    const map = newMapDoc("Konkurence", ["Kavárny"]);
    const tree = { title: "Z MindNode", children: [{ title: "Pekárny", children: [] }] };
    const added = appendTreeToMap(map, tree);
    expect(added.root.title).toBe("Konkurence");
    expect(added.root.children.map((child) => child.title)).toEqual(["Kavárny", "Pekárny"]);

    const replaced = replaceMapWithTree(map, tree);
    expect(replaced.root.id).toBe(map.root.id);
    expect(replaced.root.title).toBe("Z MindNode");
    expect(replaced.root.children.map((child) => child.title)).toEqual(["Pekárny"]);

    const untitled = appendTreeToMap(newMapDoc(), tree);
    expect(untitled.root.title).toBe("Z MindNode");
  });

  it("flattens what is deeper than a note allows and stops at its node limit", () => {
    let deep = { title: "x", children: [] as { title: string; children: unknown[] }[] };
    const top = deep;
    for (let i = 0; i < MAP_LIMITS.depth + 5; i++) {
      const next = { title: `l${i}`, children: [] };
      deep.children.push(next);
      deep = next;
    }
    const map = mindTreeToMap(top as never);
    let depth = 0;
    for (let node = map.root; node.children.length; node = node.children[0]) depth += 1;
    expect(depth).toBe(MAP_LIMITS.depth);

    const wide = {
      title: "w",
      children: Array.from({ length: MAP_LIMITS.nodes + 10 }, (_, i) => ({ title: `n${i}`, children: [] })),
    };
    expect(mindTreeToMap(wide).root.children).toHaveLength(MAP_LIMITS.nodes);
  });

  it("keeps one of Grady's answers as a new branch with its lines nested", () => {
    const map = newMapDoc("Konkurence", ["Kavárny"]);
    const next = appendTextToMap(map, "Od Gradyho, 6. 11. 2026", "- Ceny\n  - espresso 55\n- Otevírací doba");
    const branch = next.root.children[1];
    expect(branch.title).toBe("Od Gradyho, 6. 11. 2026");
    expect(shape(branch)).toEqual({
      "Od Gradyho, 6. 11. 2026": [{ Ceny: ["espresso 55"] }, "Otevírací doba"],
    });
  });
});
