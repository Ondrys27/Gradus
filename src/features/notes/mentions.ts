/**
 * Mentions of records in a note: a contact, deal, calendar event or worker
 * typed with @. In the document a mention is one inline node
 *   { type: "mention", attrs: { type: "contact", id: "<uuid>", label: "Jan Novák" } }
 * The label is what the record was called when it was mentioned, only a
 * fallback: an open note shows the record's current name. The database lists
 * the mentioned records of every note in note_mentions (a trigger reads the
 * same nodes), so a contact can show the notes that mention it.
 */
import type { DocNode } from "./document";

export const MENTION_NODE = "mention";

export const MENTION_KINDS = ["contact", "deal", "event", "worker"] as const;
export type MentionKind = (typeof MENTION_KINDS)[number];

export type MentionAttrs = { type: MentionKind; id: string; label: string };

/** How a mention reads in the note's plain text (search, Jarvis): "[kontakt: Jan Novák]". */
export type MentionTextFn = (kind: MentionKind, label: string) => string;

/** Without the interface language at hand: the kind's code ("[contact: Jan Novák]"). */
export const defaultMentionText: MentionTextFn = (kind, label) => `[${kind}: ${label}]`;

/** At most this many mentioned records of one note are looked up (the database keeps 200). */
export const MENTION_LOOKUP_MAX = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isMentionKind(value: unknown): value is MentionKind {
  return typeof value === "string" && (MENTION_KINDS as readonly string[]).includes(value);
}

export function isRecordId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function mentionKey(kind: MentionKind, id: string): string {
  return `${kind}:${id}`;
}

/** The node's attributes when it is a well-formed mention, else null. */
export function mentionAttrsOf(node: Pick<DocNode, "type" | "attrs">): MentionAttrs | null {
  if (node.type !== MENTION_NODE) return null;
  const { type, id, label } = node.attrs ?? {};
  if (!isMentionKind(type) || typeof id !== "string" || !id) return null;
  return { type, id, label: typeof label === "string" ? label : "" };
}

/** The text a mention leaves in the plain text: the kind and its label on one line. */
export function mentionPlainText(attrs: MentionAttrs, text: MentionTextFn = defaultMentionText): string {
  const label = attrs.label.replace(/\s+/g, " ").trim();
  return text(attrs.type, label || "?");
}

/** Every record the document mentions, once each, in reading order. */
export function mentionsInDoc(doc: DocNode | null | undefined): MentionAttrs[] {
  const seen = new Map<string, MentionAttrs>();
  function walk(node: DocNode) {
    const attrs = mentionAttrsOf(node);
    if (attrs) {
      const key = mentionKey(attrs.type, attrs.id);
      if (!seen.has(key)) seen.set(key, attrs);
      return;
    }
    for (const child of node.content ?? []) walk(child);
  }
  if (doc) walk(doc);
  return [...seen.values()];
}

/** A stable key of the set of mentioned records (for caching their lookup). */
export function mentionSetKey(mentions: readonly MentionAttrs[]): string {
  return mentions
    .map((m) => mentionKey(m.type, m.id))
    .sort()
    .join(",");
}

/** The ids to look up per kind; malformed ids are left out (they can only be missing). */
export function idsByKind(mentions: readonly MentionAttrs[]): Record<MentionKind, string[]> {
  const out: Record<MentionKind, string[]> = { contact: [], deal: [], event: [], worker: [] };
  for (const m of mentions.slice(0, MENTION_LOOKUP_MAX)) {
    if (isRecordId(m.id) && !out[m.type].includes(m.id)) out[m.type].push(m.id);
  }
  return out;
}

/** A contact is called by its company, or else by the person's name. */
export function contactName(row: {
  company_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}): string {
  const company = row.company_name?.trim();
  if (company) return company;
  return [row.first_name, row.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
}

/** What a looked-up record is now: its current name, or that it is gone. */
export type MentionTarget =
  | { exists: true; label: string; startsAt?: string | null }
  | { exists: false };

/**
 * The positions of mention nodes whose stored label differs from the record's
 * current name, with that name; gone records and unknown ones keep theirs.
 */
export function staleLabels(
  nodes: readonly { pos: number; attrs: MentionAttrs }[],
  targets: ReadonlyMap<string, MentionTarget>,
): { pos: number; label: string }[] {
  return nodes.flatMap(({ pos, attrs }) => {
    const target = targets.get(mentionKey(attrs.type, attrs.id));
    if (!target?.exists || !target.label || target.label === attrs.label) return [];
    return [{ pos, label: target.label }];
  });
}

/** Choices of the @ menu grouped by kind (contacts, deals, events, workers), each in rank order. */
export function groupByKind<T extends { type: MentionKind }>(
  options: readonly T[],
  perKind: number,
): { kind: MentionKind; options: T[] }[] {
  return MENTION_KINDS.map((kind) => ({
    kind,
    options: options.filter((option) => option.type === kind).slice(0, perKind),
  })).filter((group) => group.options.length > 0);
}
