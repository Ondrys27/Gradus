/**
 * A note as a Yjs document (28.4) and back.
 *
 * - A text note is the editor's XML fragment (Y_TEXT), as Tiptap
 *   Collaboration binds it.
 * - A map note is a flat Y.Map of nodes (Y_NODES): id → { parent, pos,
 *   title, note, color, link, suggested }; the tree is built when it is read.
 *   Two people moving nodes at once can make a cycle or leave a node under a
 *   parent someone deleted; reading the tree repairs both the same way in
 *   every browser (the node goes under the centre), so nothing is ever lost.
 * - Y_META holds the generation (`gen`) and the kind. A state is first built
 *   from stored content with a fixed client id, so two browsers building it at
 *   the same time get the very same items and merge without doubling the text.
 *   A new generation (a rebuilt or replaced note) never merges with an older one.
 */
import * as Y from "yjs";
import {
  prosemirrorJSONToYXmlFragment,
  updateYFragment,
  yXmlFragmentToProsemirrorJSON,
} from "@tiptap/y-tiptap";
import {
  blocksFromPlainText,
  draftFromDoc,
  extractText,
  type DocNode,
  type NoteDraft,
  type TextOptions,
} from "../document";
import {
  MAP_DOC_TYPE,
  MAP_LIMITS,
  mapDraft,
  sanitizeMapDoc,
  type MapDoc,
  type MapNode,
  type NoteKind,
} from "../mindmap/map-doc";
import { noteSchema } from "./schema";
import { Y_MAP, Y_META, Y_NODES, Y_TEXT } from "./limits";

/** The client id of the first build from stored content: the same everywhere. */
export const SEED_CLIENT_ID = 0;

export function genOf(doc: Y.Doc): string | null {
  const gen = doc.getMap(Y_META).get("gen");
  return typeof gen === "string" ? gen : null;
}

export function kindOfDoc(doc: Y.Doc): NoteKind | null {
  const kind = doc.getMap(Y_META).get("kind");
  return kind === "text" || kind === "mindmap" ? kind : null;
}

/** The generation of a stored state without keeping it. */
export function genOfState(state: Uint8Array): string | null {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return genOf(doc);
  } catch {
    return null;
  } finally {
    doc.destroy();
  }
}

/** The generation a state built from stored content gets: the same for everyone building it. */
export function seedGen(version: number): string {
  return `s${version}`;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** The stored document as the schema takes it; text the schema refuses comes back as plain lines. */
function textNode(content: unknown) {
  const schema = noteSchema();
  const doc = content && typeof content === "object" ? (content as DocNode) : null;
  try {
    if (doc?.type === "doc") return schema.nodeFromJSON(doc);
  } catch {
    // An unknown node or mark: keep the words.
  }
  const lines = extractText(doc) || (doc?.content ?? []).map(wordsOf).filter(Boolean).join("\n");
  return schema.nodeFromJSON({ type: "doc", content: blocksFromPlainText(lines) });
}

/** Every piece of text inside a node, whatever it is. */
function wordsOf(node: DocNode): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(wordsOf).join("").replace(/\s+/g, " ").trim();
}

export function textJsonOf(doc: Y.Doc): DocNode {
  const json = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(Y_TEXT)) as DocNode;
  return { type: "doc", content: json.content ?? [] };
}

/**
 * Makes the text of the document equal to `content` with the smallest change
 * (what the editor itself does on every keystroke): everything else in it,
 * and everyone else's cursor, stays.
 */
export function applyTextJson(doc: Y.Doc, content: unknown, origin: unknown) {
  const node = textNode(content);
  doc.transact(() => {
    updateYFragment(doc, doc.getXmlFragment(Y_TEXT), node, { mapping: new Map(), isOMark: new Map() });
  }, origin);
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

type NodeFields = Omit<MapNode, "id" | "children">;

function nodesOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(Y_NODES) as Y.Map<Y.Map<unknown>>;
}

function rootIdOf(doc: Y.Doc): string | null {
  const id = doc.getMap(Y_MAP).get("root");
  return typeof id === "string" ? id : null;
}

function fieldsOf(node: MapNode): NodeFields {
  const fields: NodeFields = { title: node.title };
  if (node.note) fields.note = node.note;
  if (node.color) fields.color = node.color;
  if (node.link) fields.link = node.link;
  if (node.suggested) fields.suggested = true;
  return fields;
}

const FIELD_KEYS = ["title", "note", "color", "link", "suggested"] as const;

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a && b && typeof a === "object" && typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

/**
 * Positions that keep the new order of a parent's children while changing as
 * few of them as possible: the longest run already in order stays, the rest
 * get positions between their neighbours.
 */
export function placeChildren(current: (number | undefined)[]): number[] {
  const n = current.length;
  // Longest strictly increasing subsequence of the known positions.
  const tails: number[] = [];
  const prev = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const value = current[i];
    if (value === undefined || !Number.isFinite(value)) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((current[tails[mid]] as number) < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep.add(i);

  const out = new Array<number>(n);
  let left = 0;
  for (let i = 0; i < n; i++) {
    if (keep.has(i)) {
      out[i] = current[i] as number;
      left = out[i];
      continue;
    }
    let right: number | null = null;
    for (let j = i + 1; j < n; j++) {
      if (keep.has(j)) {
        right = current[j] as number;
        break;
      }
    }
    const next = right === null ? left + 1 : (left + right) / 2;
    if (!(next > left) || (right !== null && !(next < right))) {
      // The gap is used up: number the whole list again.
      return current.map((_, index) => index + 1);
    }
    out[i] = next;
    left = next;
  }
  return out;
}

/**
 * Makes the map in the document equal to `map`: changed fields, moves and
 * order are written, nodes that are gone are deleted, nothing else is touched.
 */
export function applyMapDoc(doc: Y.Doc, map: MapDoc, origin: unknown) {
  doc.transact(() => {
    const nodes = nodesOf(doc);
    const meta = doc.getMap(Y_MAP);
    if (rootIdOf(doc) !== map.root.id) meta.set("root", map.root.id);

    const keep = new Set<string>();
    const visit = (node: MapNode, parent: string | null) => {
      keep.add(node.id);
      let entry = nodes.get(node.id);
      if (!entry) {
        entry = new Y.Map<unknown>();
        nodes.set(node.id, entry);
      }
      if (entry.get("parent") !== parent) entry.set("parent", parent);
      const fields = fieldsOf(node) as Record<string, unknown>;
      for (const key of FIELD_KEYS) {
        const value = fields[key];
        if (value === undefined) {
          if (entry.has(key)) entry.delete(key);
        } else if (!same(entry.get(key), value)) {
          entry.set(key, value);
        }
      }
      const positions = placeChildren(
        node.children.map((child) => {
          const existing = nodes.get(child.id);
          const pos = existing?.get("pos");
          return existing && existing.get("parent") === node.id && typeof pos === "number" ? pos : undefined;
        }),
      );
      node.children.forEach((child, index) => {
        visit(child, node.id);
        const entryOfChild = nodes.get(child.id)!;
        if (entryOfChild.get("pos") !== positions[index]) entryOfChild.set("pos", positions[index]);
      });
    };
    visit(map.root, null);
    if (nodes.get(map.root.id)?.get("pos") !== 0) nodes.get(map.root.id)!.set("pos", 0);
    for (const id of [...nodes.keys()]) if (!keep.has(id)) nodes.delete(id);
  }, origin);
}

type Raw = { id: string; parent: string | null; pos: number; fields: Record<string, unknown> };

/**
 * The map as a tree. Every node ends up in it exactly once: a node whose
 * parent is gone, or that is in a cycle made by two moves at once, goes under
 * the centre (in a cycle the node with the smallest id, the rest keep their
 * places under it). Levels below the limit are flattened, never dropped.
 */
export function mapDocOf(doc: Y.Doc): MapDoc {
  const nodes = nodesOf(doc);
  const raws = new Map<string, Raw>();
  for (const [id, entry] of nodes.entries()) {
    if (!(entry instanceof Y.Map)) continue;
    const parent = entry.get("parent");
    const pos = entry.get("pos");
    const fields: Record<string, unknown> = {};
    for (const key of FIELD_KEYS) if (entry.has(key)) fields[key] = entry.get(key);
    raws.set(id, {
      id,
      parent: typeof parent === "string" ? parent : null,
      pos: typeof pos === "number" && Number.isFinite(pos) ? pos : 0,
      fields,
    });
  }
  let rootId = rootIdOf(doc);
  if (!rootId || !raws.has(rootId)) {
    rootId = rootId ?? "root";
    if (!raws.has(rootId)) raws.set(rootId, { id: rootId, parent: null, pos: 0, fields: { title: "" } });
  }
  const root = raws.get(rootId)!;
  root.parent = null;

  // Where each node hangs: its parent, or the centre after a repair.
  const parentOf = new Map<string, string>();
  const reaches = new Map<string, boolean>([[rootId, true]]);
  const sortedIds = [...raws.keys()].filter((id) => id !== rootId).sort();
  for (const id of sortedIds) {
    if (reaches.has(id)) continue;
    // Walk up until something already placed, a missing parent or a cycle.
    const chain: string[] = [];
    const onChain = new Set<string>();
    let at: string | null = id;
    let outcome: "placed" | "missing" | "cycle" = "missing";
    while (at !== null) {
      if (reaches.has(at)) {
        outcome = "placed";
        break;
      }
      if (onChain.has(at)) {
        outcome = "cycle";
        break;
      }
      chain.push(at);
      onChain.add(at);
      const parent: string | null = raws.get(at)?.parent ?? null;
      if (parent === null || !raws.has(parent)) {
        at = null;
        outcome = "missing";
        break;
      }
      at = parent;
    }
    if (outcome === "cycle") {
      // The cycle is the part of the chain from where `at` first appeared.
      const start = chain.indexOf(at as string);
      const cycle = chain.slice(start);
      const cut = [...cycle].sort()[0];
      parentOf.set(cut, rootId);
      reaches.set(cut, true);
    } else if (outcome === "missing") {
      const top = chain[chain.length - 1];
      parentOf.set(top, rootId);
      reaches.set(top, true);
    }
    // Everything else on the chain now hangs under its own parent.
    for (const node of chain) {
      if (!parentOf.has(node)) parentOf.set(node, raws.get(node)!.parent as string);
      reaches.set(node, true);
    }
  }

  const children = new Map<string, Raw[]>();
  for (const [id, parent] of parentOf) {
    const list = children.get(parent) ?? [];
    list.push(raws.get(id)!);
    children.set(parent, list);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.pos - b.pos || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const leaf = (raw: Raw): MapNode => ({
    id: raw.id,
    ...(raw.fields as Partial<NodeFields>),
    title: typeof raw.fields.title === "string" ? raw.fields.title : "",
    children: [],
  });
  const build = (raw: Raw, depth: number): MapNode => {
    const node = leaf(raw);
    const below = children.get(raw.id) ?? [];
    if (depth < MAP_LIMITS.depth) {
      node.children = below.map((child) => build(child, depth + 1));
    } else {
      // Too deep: everything below comes up to this level, in order.
      const stack = [...below].reverse();
      while (stack.length) {
        const next = stack.pop()!;
        node.children.push(leaf(next));
        stack.push(...[...(children.get(next.id) ?? [])].reverse());
      }
    }
    return node;
  };
  const tree: MapDoc = { type: MAP_DOC_TYPE, version: 1, root: build(root, 0) };
  return sanitizeMapDoc(tree);
}

// ---------------------------------------------------------------------------
// Both
// ---------------------------------------------------------------------------

/**
 * The first state of a note built from its stored content. Built with the
 * fixed client id, so every browser (and the server) building it from the
 * same content and version gets the same bytes.
 */
export function seedState(kind: NoteKind, content: unknown, gen: string): Uint8Array {
  const seed = new Y.Doc();
  seed.clientID = SEED_CLIENT_ID;
  try {
    seed.transact(() => {
      const meta = seed.getMap(Y_META);
      meta.set("gen", gen);
      meta.set("kind", kind);
      if (kind === "mindmap") applyMapDoc(seed, sanitizeMapDoc(content), null);
      else prosemirrorJSONToYXmlFragment(noteSchema(), textNode(content).toJSON(), seed.getXmlFragment(Y_TEXT));
    });
    return Y.encodeStateAsUpdate(seed);
  } finally {
    seed.destroy();
  }
}

/** The document's content as it is now, in the form the note stores. */
export function contentOf(doc: Y.Doc, kind: NoteKind): DocNode | MapDoc {
  return kind === "mindmap" ? mapDocOf(doc) : textJsonOf(doc);
}

/** Everything derived for the database: title, content, plain text. */
export function draftOf(doc: Y.Doc, kind: NoteKind, options: TextOptions = {}): NoteDraft {
  return kind === "mindmap" ? mapDraft(mapDocOf(doc), options) : draftFromDoc(textJsonOf(doc), options);
}

/**
 * Own changes carried onto a note that was rebuilt or replaced meanwhile: what
 * changed from `base` to `mine` is applied to `theirs` (a three-way merge done
 * by Yjs itself on two copies of the same base). Without a base, mine wins.
 */
export function carryOver(kind: NoteKind, base: unknown | null, mine: unknown, theirs: unknown): DocNode | MapDoc {
  if (base === null) return kind === "mindmap" ? sanitizeMapDoc(mine) : (mine as DocNode);
  const start = seedState(kind, base, "carry");
  const ours = new Y.Doc();
  const other = new Y.Doc();
  try {
    Y.applyUpdate(ours, start);
    Y.applyUpdate(other, start);
    applyContent(ours, kind, mine, "mine");
    applyContent(other, kind, theirs, "theirs");
    Y.applyUpdate(ours, Y.encodeStateAsUpdate(other, Y.encodeStateVector(ours)));
    return contentOf(ours, kind);
  } finally {
    ours.destroy();
    other.destroy();
  }
}

/** Puts new content into the document as a change (a restored version, Grady's addition). */
export function applyContent(doc: Y.Doc, kind: NoteKind, content: unknown, origin: unknown) {
  if (kind === "mindmap") applyMapDoc(doc, sanitizeMapDoc(content), origin);
  else applyTextJson(doc, content, origin);
}
