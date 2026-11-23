// @vitest-environment node
import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { extractText, type DocNode } from "../document";
import { countMapNodes, type MapDoc, type MapNode } from "../mindmap/map-doc";
import { moveNode, removeNode, addChild, updateNode } from "../mindmap/map-ops";
import {
  applyMapDoc,
  applyTextJson,
  genOf,
  genOfState,
  mapDocOf,
  placeChildren,
  seedGen,
  seedState,
  textJsonOf,
} from "./ydoc";

const para = (text: string): DocNode => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const doc = (...lines: string[]): DocNode => ({ type: "doc", content: lines.map(para) });

function fromSeed(state: Uint8Array): Y.Doc {
  const d = new Y.Doc();
  Y.applyUpdate(d, state);
  return d;
}

/** Both documents get each other's changes, in either order. */
function exchange(a: Y.Doc, b: Y.Doc) {
  const toB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const toA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, toB);
  Y.applyUpdate(a, toA);
}

const text = (d: Y.Doc) => extractText(textJsonOf(d));

describe("text notes as Yjs", () => {
  it("builds the very same state from the same content, so two first opens never double the text", () => {
    const content = doc("Ceník", "Konzultace 1 500 Kč");
    const one = seedState("text", content, seedGen(3));
    const two = seedState("text", content, seedGen(3));
    expect(one).toEqual(two);
    const a = fromSeed(one);
    const b = fromSeed(two);
    exchange(a, b);
    expect(text(a)).toBe("Ceník\nKonzultace 1 500 Kč");
    expect(text(b)).toBe(text(a));
    expect(genOf(a)).toBe("s3");
    expect(genOfState(one)).toBe("s3");
  });

  it("merges two people typing into the same paragraph at once: both see the same, nothing lost", () => {
    const start = seedState("text", doc("Plán", "Zavolat"), seedGen(0));
    const a = fromSeed(start);
    const b = fromSeed(start);
    applyTextJson(a, doc("Plán", "Zavolat Novákovi"), "a");
    applyTextJson(b, doc("Plán", "Hned zavolat"), "b");
    exchange(a, b);
    expect(text(a)).toBe(text(b));
    expect(text(a)).toContain("Novákovi");
    expect(text(a)).toContain("Hned");
  });

  it("keeps a whole paragraph one person added while the other edits another", () => {
    const start = seedState("text", doc("Porada", "Body"), seedGen(0));
    const a = fromSeed(start);
    const b = fromSeed(start);
    applyTextJson(a, doc("Porada", "Body", "Rozpočet"), "a");
    applyTextJson(b, doc("Porada 2027", "Body"), "b");
    exchange(a, b);
    expect(text(a)).toBe("Porada 2027\nBody\nRozpočet");
    expect(text(b)).toBe(text(a));
  });

  it("keeps chips, lists and marks through the state", () => {
    const content: DocNode = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Klient" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Volal " },
            { type: "mention", attrs: { type: "contact", id: "c-1", label: "Jan Novák", mentionSuggestionChar: "@" } },
            { type: "text", text: " tučně", marks: [{ type: "bold" }] },
          ],
        },
        {
          type: "taskList",
          content: [{ type: "taskItem", attrs: { checked: true }, content: [para("Hotovo")] }],
        },
      ],
    };
    const d = fromSeed(seedState("text", content, "s0"));
    const json = textJsonOf(d);
    expect(json.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    expect(JSON.stringify(json)).toContain('"label":"Jan Novák"');
    expect(JSON.stringify(json)).toContain('"type":"bold"');
    expect(json.content?.[2]).toMatchObject({ type: "taskList" });
  });

  it("turns content the schema does not know into its plain lines instead of failing", () => {
    const strange = { type: "doc", content: [{ type: "unknownBlock", content: [{ type: "text", text: "Zůstanu" }] }] };
    const d = fromSeed(seedState("text", strange, "s0"));
    expect(text(d)).toBe("Zůstanu");
  });
});

// ---------------------------------------------------------------------------

function node(id: string, title: string, children: MapNode[] = []): MapNode {
  return { id, title, children };
}

function map(root: MapNode): MapDoc {
  return { type: "mindmap", version: 1, root };
}

/** Every id in the tree once, and the parent of each. */
function shape(m: MapDoc): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const walk = (n: MapNode, parent: string | null) => {
    expect(out[n.id]).toBeUndefined();
    out[n.id] = parent;
    for (const child of n.children) walk(child, n.id);
  };
  walk(m.root, null);
  return out;
}

const START = map(
  node("root", "Konkurence", [
    node("a", "Firma A", [node("a1", "Ceny"), node("a2", "Služby")]),
    node("b", "Firma B", [node("b1", "Recenze")]),
    node("c", "Firma C"),
  ]),
);

describe("map notes as Yjs", () => {
  it("reads back the same tree it wrote", () => {
    const d = fromSeed(seedState("mindmap", START, "s0"));
    expect(mapDocOf(d)).toEqual(START);
  });

  it("never makes a cycle nor loses a subtree when two people move nodes under each other at once", () => {
    const start = seedState("mindmap", START, "s0");
    const alice = fromSeed(start);
    const bob = fromSeed(start);
    // Alice puts A under B, Bob puts B under A, at the same time.
    applyMapDoc(alice, moveNode(mapDocOf(alice), "a", { parentId: "b", index: 0 }), "alice");
    applyMapDoc(bob, moveNode(mapDocOf(bob), "b", { parentId: "a", index: 0 }), "bob");
    exchange(alice, bob);
    const seenByAlice = mapDocOf(alice);
    const seenByBob = mapDocOf(bob);
    expect(seenByAlice).toEqual(seenByBob);
    const parents = shape(seenByAlice);
    // Every node is still there, each exactly once, subtrees with them.
    expect(Object.keys(parents).sort()).toEqual(["a", "a1", "a2", "b", "b1", "c", "root"]);
    expect(parents.a1).toBe("a");
    expect(parents.a2).toBe("a");
    expect(parents.b1).toBe("b");
    // One of the two went back under the centre, the other under it.
    expect(parents.a === "root" || parents.b === "root").toBe(true);
    expect(countMapNodes(seenByAlice)).toBe(6);
  });

  it("keeps a three-node cycle from three people the same way everywhere", () => {
    const start = seedState("mindmap", START, "s0");
    const docs = [fromSeed(start), fromSeed(start), fromSeed(start)];
    applyMapDoc(docs[0], moveNode(mapDocOf(docs[0]), "a", { parentId: "b", index: 0 }), 1);
    applyMapDoc(docs[1], moveNode(mapDocOf(docs[1]), "b", { parentId: "c", index: 0 }), 2);
    applyMapDoc(docs[2], moveNode(mapDocOf(docs[2]), "c", { parentId: "a", index: 0 }), 3);
    exchange(docs[0], docs[1]);
    exchange(docs[1], docs[2]);
    exchange(docs[0], docs[2]);
    const trees = docs.map(mapDocOf);
    expect(trees[1]).toEqual(trees[0]);
    expect(trees[2]).toEqual(trees[0]);
    expect(Object.keys(shape(trees[0]))).toHaveLength(7);
  });

  it("keeps a child someone added under a node another person deleted at the same time", () => {
    const start = seedState("mindmap", START, "s0");
    const alice = fromSeed(start);
    const bob = fromSeed(start);
    applyMapDoc(alice, removeNode(mapDocOf(alice), "b"), "alice");
    const added = addChild(mapDocOf(bob), "b1", "new");
    applyMapDoc(bob, updateNode(added.doc, "new", { title: "Nový nápad" }), "bob");
    exchange(alice, bob);
    expect(mapDocOf(alice)).toEqual(mapDocOf(bob));
    const parents = shape(mapDocOf(alice));
    expect(parents.new).toBe("root");
    expect(parents.b).toBeUndefined();
  });

  it("merges a rename and a reorder of the same branch", () => {
    const start = seedState("mindmap", START, "s0");
    const alice = fromSeed(start);
    const bob = fromSeed(start);
    applyMapDoc(alice, updateNode(mapDocOf(alice), "c", { title: "Firma C s.r.o.", color: "teal" }), "alice");
    applyMapDoc(bob, moveNode(mapDocOf(bob), "c", { parentId: "root", index: 0 }), "bob");
    exchange(alice, bob);
    const tree = mapDocOf(alice);
    expect(tree).toEqual(mapDocOf(bob));
    expect(tree.root.children[0]).toMatchObject({ id: "c", title: "Firma C s.r.o.", color: "teal" });
    expect(tree.root.children.map((child) => child.id)).toEqual(["c", "a", "b"]);
  });

  it("flattens levels past the limit instead of dropping them", () => {
    let deep = node("n49", "49");
    for (let i = 48; i >= 0; i--) deep = node(`n${i}`, String(i), [deep]);
    const d = fromSeed(seedState("mindmap", map(node("root", "Hloubka", [deep])), "s0"));
    // The seed goes through the sanitizer (40 levels); the rest is kept flat.
    const tree = mapDocOf(d);
    expect(countMapNodes(tree)).toBeGreaterThan(0);
    expect(() => shape(tree)).not.toThrow();
  });
});

describe("placeChildren", () => {
  it("keeps positions already in order", () => {
    expect(placeChildren([1, 2, 3])).toEqual([1, 2, 3]);
  });
  it("gives new and moved children positions between their neighbours, changing as few as it can", () => {
    const out = placeChildren([1, undefined, 2, 5]);
    expect(out[0]).toBe(1);
    expect(out[2]).toBe(2);
    expect(out[3]).toBe(5);
    expect(out[1]).toBeGreaterThan(1);
    expect(out[1]).toBeLessThan(2);
    const moved = placeChildren([3, 1, 2]);
    expect(moved[1]).toBe(1);
    expect(moved[2]).toBe(2);
    expect(moved[0]).toBeLessThan(1);
  });
  it("numbers the list again when the gaps run out", () => {
    let positions: (number | undefined)[] = [1, 2];
    for (let i = 0; i < 80; i++) {
      const placed = placeChildren([positions[0], undefined, ...positions.slice(1)]);
      for (let j = 1; j < placed.length; j++) expect(placed[j]).toBeGreaterThan(placed[j - 1]);
      positions = placed;
    }
  });
});
