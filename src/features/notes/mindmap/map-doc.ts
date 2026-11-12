/**
 * A note that is a mind map (notes.kind = 'mindmap'). Its content is the tree
 * of the shared mind map formats (src/lib/mindmap/formats) with an id on every
 * node and what a note's map adds: a small note under a node, a branch colour,
 * one link (a web address or a record chip) and the mark of a branch Grady
 * suggested that the user has not accepted yet.
 *
 *   { type: "mindmap", version: 1, root: { id, title, children: [...] } }
 *
 * The root's title is the note's title. content_text (search, Grady) is the
 * indented outline of the tree; suggestions are not in it until accepted.
 */
import { NOTE_LIMITS, type NoteDraft } from "../document";
import {
  isMentionKind,
  mentionPlainText,
  type MentionAttrs,
  type MentionTextFn,
} from "../mentions";
import { normalizeLink } from "../links";

export const MAP_DOC_TYPE = "mindmap";

export const NOTE_KINDS = ["text", "mindmap"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** The six branch colours, all theme tokens. */
export const BRANCH_COLORS = ["violet", "teal", "gold", "green", "orange", "pink"] as const;
export type BranchColor = (typeof BRANCH_COLORS)[number];

/** A node links to one thing: a web page, or a contact, deal, event or worker of the app. */
export type MapLink = { type: "url"; href: string } | { type: "mention"; attrs: MentionAttrs };

export type MapNode = {
  id: string;
  title: string;
  /** Small text under the title. */
  note?: string;
  /** Set on a node, it colours it and everything below it. */
  color?: BranchColor;
  link?: MapLink;
  /** Proposed by Grady, shown grey until the user accepts or deletes it. */
  suggested?: true;
  children: MapNode[];
};

export type MapDoc = { type: typeof MAP_DOC_TYPE; version: 1; root: MapNode };

export const MAP_LIMITS = {
  /** The root's title is the note's title. */
  rootTitle: NOTE_LIMITS.title,
  title: 300,
  note: 1000,
  href: 2000,
  /** Nodes below the root; well within the content limit of a note. */
  nodes: 2000,
  /** Levels below the root; a deeper import is flattened to this. */
  depth: 40,
} as const;

export function newNodeId(): string {
  return crypto.randomUUID();
}

export function isMapDoc(value: unknown): value is MapDoc {
  if (!value || typeof value !== "object") return false;
  const doc = value as { type?: unknown; root?: unknown };
  return doc.type === MAP_DOC_TYPE && !!doc.root && typeof doc.root === "object";
}

export function isBranchColor(value: unknown): value is BranchColor {
  return typeof value === "string" && (BRANCH_COLORS as readonly string[]).includes(value);
}

/** Whitespace of a title collapsed to single spaces, trimmed and cut. */
export function cleanNodeTitle(title: string, max: number = MAP_LIMITS.title): string {
  return title.replace(/\s+/g, " ").trim().slice(0, max);
}

/** A web address (or e-mail) a node may link to, as the text notes' links: http(s) and mailto only. */
export function normalizeUrl(raw: string): string | null {
  const link = normalizeLink(raw.slice(0, MAP_LIMITS.href + 20));
  return link && link.length <= MAP_LIMITS.href ? link : null;
}

function sanitizeLink(value: unknown): MapLink | undefined {
  if (!value || typeof value !== "object") return undefined;
  const link = value as { type?: unknown; href?: unknown; attrs?: unknown };
  if (link.type === "url" && typeof link.href === "string") {
    const href = normalizeUrl(link.href);
    return href ? { type: "url", href } : undefined;
  }
  if (link.type === "mention" && link.attrs && typeof link.attrs === "object") {
    const { type, id, label } = link.attrs as Record<string, unknown>;
    if (!isMentionKind(type) || typeof id !== "string" || !id) return undefined;
    return {
      type: "mention",
      attrs: { type, id, label: typeof label === "string" ? label.slice(0, MAP_LIMITS.title) : "" },
    };
  }
  return undefined;
}

/**
 * A map as stored, made safe to draw: every node has a unique id, a title
 * string and a children array, unknown fields are dropped, limits hold.
 * Whatever comes from the database or a backup goes through here first.
 */
export function sanitizeMapDoc(value: unknown): MapDoc {
  const seen = new Set<string>();
  let budget = MAP_LIMITS.nodes;
  const walk = (raw: unknown, depth: number, isRoot: boolean): MapNode | null => {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    let id = typeof item.id === "string" && item.id ? item.id.slice(0, 64) : newNodeId();
    if (seen.has(id)) id = newNodeId();
    seen.add(id);
    const node: MapNode = {
      id,
      title:
        typeof item.title === "string"
          ? cleanNodeTitle(item.title, isRoot ? MAP_LIMITS.rootTitle : MAP_LIMITS.title)
          : "",
      children: [],
    };
    if (typeof item.note === "string" && item.note.trim()) {
      node.note = item.note.trim().slice(0, MAP_LIMITS.note);
    }
    if (isBranchColor(item.color)) node.color = item.color;
    const link = sanitizeLink(item.link);
    if (link) node.link = link;
    if (item.suggested === true && !isRoot) node.suggested = true;
    if (Array.isArray(item.children) && depth < MAP_LIMITS.depth) {
      for (const child of item.children) {
        if (budget <= 0) break;
        budget -= 1;
        const next = walk(child, depth + 1, false);
        if (next) node.children.push(next);
      }
    }
    return node;
  };
  const root = isMapDoc(value) ? walk(value.root, 0, true) : null;
  return { type: MAP_DOC_TYPE, version: 1, root: root ?? { id: newNodeId(), title: "", children: [] } };
}

export function newMapDoc(title = "", branches: string[] = []): MapDoc {
  return {
    type: MAP_DOC_TYPE,
    version: 1,
    root: {
      id: newNodeId(),
      title: cleanNodeTitle(title, MAP_LIMITS.rootTitle),
      children: branches.map((branch) => ({ id: newNodeId(), title: cleanNodeTitle(branch), children: [] })),
    },
  };
}

/** Nodes below the root, suggestions included. */
export function countMapNodes(doc: MapDoc): number {
  let count = 0;
  const stack = [...doc.root.children];
  while (stack.length) {
    const next = stack.pop()!;
    count += 1;
    stack.push(...next.children);
  }
  return count;
}

/** The map without the branches Grady suggested and nobody accepted. */
export function acceptedRoot(node: MapNode): MapNode {
  return {
    ...node,
    children: node.children.filter((child) => !child.suggested).map(acceptedRoot),
  };
}

export type OutlineOptions = { mentionText?: MentionTextFn };

function lineOf(node: MapNode, options: OutlineOptions): string {
  const parts = [node.title];
  if (node.link?.type === "mention") parts.push(mentionPlainText(node.link.attrs, options.mentionText));
  if (node.link?.type === "url") parts.push(`(${node.link.href})`);
  let line = parts.filter(Boolean).join(" ");
  const note = node.note?.replace(/\s+/g, " ").trim();
  if (note) line = line ? `${line} — ${note}` : note;
  return line;
}

/**
 * The map as indented text, the plain text of the note: the root's title on
 * the first line, every level below two spaces further in (what the "text"
 * mind map format reads back). A node's link and note follow its title on its
 * line. Suggestions are left out until accepted.
 */
export function mapToOutline(doc: MapDoc, options: OutlineOptions = {}): string {
  const lines = [lineOf(doc.root, options)];
  const walk = (node: MapNode, depth: number) => {
    for (const child of node.children) {
      if (child.suggested) continue;
      const line = lineOf(child, options);
      if (line) lines.push(`${"  ".repeat(depth)}${line}`);
      walk(child, depth + 1);
    }
  };
  walk(doc.root, 1);
  return lines.join("\n").slice(0, NOTE_LIMITS.contentText);
}

/** Everything the database stores for a map note. */
export function mapDraft(doc: MapDoc, options: OutlineOptions = {}): NoteDraft {
  return {
    kind: "mindmap",
    title: cleanNodeTitle(doc.root.title, MAP_LIMITS.rootTitle),
    content: doc,
    content_text: mapToOutline(doc, options),
  };
}

/** Every record the map links to, once each (their current names are looked up). */
export function mentionsInMap(doc: MapDoc): MentionAttrs[] {
  const seen = new Map<string, MentionAttrs>();
  const stack = [doc.root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.link?.type === "mention") {
      const key = `${node.link.attrs.type}:${node.link.attrs.id}`;
      if (!seen.has(key)) seen.set(key, node.link.attrs);
    }
    stack.push(...node.children);
  }
  return [...seen.values()];
}
