import { DEFAULT_FORMAT_SETTINGS, todayIsoDate } from "@/lib/format";
import {
  CHAT_EDIT_WINDOW_MS,
  CHAT_GROUP_GAP_MS,
  CHAT_IMAGE_TYPES,
  type ChatChannel,
  type ChatMemberRead,
  type ChatMessage,
} from "./types";

/**
 * The rules of Messages that need no network: unread counts and the badge,
 * read receipts, how bubbles group, what may still be edited, mentions and
 * record links in a message. Shared by the browser and the server.
 */

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

/** The key of a direct conversation, the same from either side (chat_open_direct()). */
export function directKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Whether the conversation stays silent for this member (own mute or the owner's for all). */
export function isSilenced(channel: Pick<ChatChannel, "muted" | "mutedAll">): boolean {
  return channel.muted || channel.mutedAll;
}

/**
 * What counts in the menu badge and the tab title: unread messages of
 * conversations that are not silenced; a silenced one still counts when an
 * unread message mentions the member (like a mention breaks through a mute).
 */
export function unreadTotal(
  channels: readonly Pick<ChatChannel, "unread" | "muted" | "mutedAll" | "mentioned">[],
): number {
  let total = 0;
  for (const channel of channels) {
    if (channel.unread <= 0) continue;
    if (!isSilenced(channel)) total += channel.unread;
    else if (channel.mentioned) total += 1;
  }
  return total;
}

/** The badge's text: up to 99, then "99+". */
export function badgeText(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}

const TITLE_COUNT = /^\(\d+\+?\)\s/;

/** The tab title with the unread count in front, "(3) Zprávy · Gradus"; none at zero. */
export function titleWithUnread(title: string, count: number): string {
  const base = title.replace(TITLE_COUNT, "");
  return count > 0 ? `(${badgeText(count)}) ${base}` : base;
}

/** Conversations as the list shows them: pinned first, then the newest activity. */
export function sortChannels<T extends Pick<ChatChannel, "pinnedAt" | "last" | "createdAt">>(
  channels: readonly T[],
): T[] {
  const at = (channel: T) => channel.last?.at ?? channel.createdAt;
  return [...channels].sort((a, b) => {
    if (a.pinnedAt && !b.pinnedAt) return -1;
    if (!a.pinnedAt && b.pinnedAt) return 1;
    if (a.pinnedAt && b.pinnedAt && a.pinnedAt !== b.pinnedAt) {
      return a.pinnedAt < b.pinnedAt ? 1 : -1;
    }
    return at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0;
  });
}

/** Search in the list: the conversation's name and its last message, without diacritics. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

export function matchesSearch(query: string, ...texts: (string | null | undefined)[]): boolean {
  const needle = fold(query.trim());
  if (!needle) return true;
  return texts.some((text) => text && fold(text).includes(needle));
}

// ---------------------------------------------------------------------------
// Unread and read
// ---------------------------------------------------------------------------

/** Whether the member has not seen this message yet (own and deleted ones never count). */
export function isUnread(
  message: Pick<ChatMessage, "sender" | "created_at" | "deleted_at">,
  me: string,
  lastReadAt: string | null,
): boolean {
  if (message.deleted_at || message.sender === me) return false;
  return lastReadAt === null || Date.parse(message.created_at) > Date.parse(lastReadAt);
}

/** The id of the first unread message (the "unread" divider goes above it). */
export function firstUnreadId(
  messages: readonly Pick<ChatMessage, "id" | "sender" | "created_at" | "deleted_at">[],
  me: string,
  lastReadAt: string | null,
): string | null {
  return messages.find((message) => isUnread(message, me, lastReadAt))?.id ?? null;
}

/** The newest message time among the loaded ones, what "read up to" is marked with. */
export function newestCreatedAt(messages: readonly Pick<ChatMessage, "created_at" | "pending">[]) {
  let newest: string | null = null;
  for (const message of messages) {
    if (message.pending) continue;
    if (!newest || Date.parse(message.created_at) > Date.parse(newest)) newest = message.created_at;
  }
  return newest;
}

/** How many of the other members have read a message (its sender never counts). */
export function readCount(
  message: Pick<ChatMessage, "sender" | "created_at">,
  members: readonly ChatMemberRead[],
): number {
  const at = Date.parse(message.created_at);
  return members.filter(
    (member) =>
      member.member !== message.sender &&
      member.last_read_at !== null &&
      Date.parse(member.last_read_at) >= at,
  ).length;
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

export function isOwnMessage(message: Pick<ChatMessage, "sender">, me: string): boolean {
  return message.sender === me;
}

/** The sender edits a message for 15 minutes; a deleted or unsent one not at all. */
export function canEditMessage(
  message: Pick<ChatMessage, "sender" | "created_at" | "deleted_at" | "pending">,
  me: string,
  now: number = Date.now(),
): boolean {
  if (message.deleted_at || message.pending) return false;
  return isOwnMessage(message, me) && now - Date.parse(message.created_at) <= CHAT_EDIT_WINDOW_MS;
}

/** Deleting: the sender within 15 minutes, the owner of the space any time. */
export function canDeleteMessage(
  message: Pick<ChatMessage, "sender" | "created_at" | "deleted_at" | "pending">,
  me: string,
  isSpaceOwner: boolean,
  now: number = Date.now(),
): boolean {
  if (message.deleted_at || message.pending) return false;
  return isSpaceOwner || canEditMessage(message, me, now);
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export type MessageRow<M extends ChatMessage = ChatMessage> =
  | { type: "day"; key: string; day: string }
  | { type: "unread"; key: string }
  | { type: "message"; key: string; message: M; first: boolean; last: boolean };

/** The calendar day of an instant in a time zone, "2026-11-03". */
export function dayOf(instant: string, timeZone: string): string {
  return todayIsoDate({ ...DEFAULT_FORMAT_SETTINGS, timeZone }, new Date(instant));
}

/**
 * The rows of a conversation, oldest first: a divider for every day (in the
 * reader's zone), the unread divider, and the messages marked as the first
 * or last of a run from one sender (within 5 minutes, same day).
 */
export function messageRows<M extends ChatMessage>(
  messages: readonly M[],
  timeZone: string,
  unreadFrom: string | null = null,
): MessageRow<M>[] {
  const out: MessageRow<M>[] = [];
  let day: string | null = null;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    const messageDay = dayOf(message.created_at, timeZone);
    if (messageDay !== day) {
      out.push({ type: "day", key: `day:${messageDay}`, day: messageDay });
      day = messageDay;
    }
    if (unreadFrom === message.id) out.push({ type: "unread", key: "unread" });
    const previous = messages[index - 1];
    const next = messages[index + 1];
    out.push({
      type: "message",
      key: message.id,
      message,
      first: !continues(previous, message, timeZone) || unreadFrom === message.id,
      last: !continues(message, next, timeZone) || unreadFrom === next?.id,
    });
  }
  return out;
}

function continues(a: ChatMessage | undefined, b: ChatMessage | undefined, timeZone: string) {
  if (!a || !b) return false;
  if (a.sender !== b.sender || a.deleted_at || b.deleted_at) return false;
  const gap = Date.parse(b.created_at) - Date.parse(a.created_at);
  return gap >= 0 && gap <= CHAT_GROUP_GAP_MS && dayOf(a.created_at, timeZone) === dayOf(b.created_at, timeZone);
}

/** Merges fetched pages and live messages: one per id, oldest first, a sent copy replacing its pending one. */
export function mergeMessages<M extends ChatMessage>(...lists: (readonly M[])[]): M[] {
  const byId = new Map<string, M>();
  for (const list of lists) {
    for (const message of list) {
      const known = byId.get(message.id);
      if (!known || (known.pending && !message.pending) || (!known.pending && !message.pending)) {
        byId.set(message.id, message);
      }
    }
  }
  return [...byId.values()].sort((a, b) => {
    const diff = Date.parse(a.created_at) - Date.parse(b.created_at);
    return diff !== 0 ? diff : a.id < b.id ? -1 : 1;
  });
}

// ---------------------------------------------------------------------------
// Mentions and links in the text
// ---------------------------------------------------------------------------

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MENTION = new RegExp(`<@(${UUID})>`, "gi");
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;

/** A member mentioned in the text is stored as "<@token>", so a rename never breaks it. */
export function mentionToken(member: string): string {
  return `<@${member}>`;
}

/** The members a text mentions, once each. */
export function mentionsIn(body: string): string[] {
  const out = new Set<string>();
  for (const match of body.matchAll(MENTION)) out.add(match[1]!.toLowerCase());
  return [...out];
}

export type RecordKind = "deal" | "contact" | "task";
export type RecordLink = { kind: RecordKind; id: string };

/**
 * A link to a deal, a contact or a sales task of the app, pasted as an
 * address: /app/pipeline?deal=…, /app/kontakty/…, /app/ukoly-crm?task=….
 * Only addresses of this site (`origin`) count; anything else stays a link.
 */
export function parseRecordLink(url: string, origin: string): RecordLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url, origin);
  } catch {
    return null;
  }
  if (parsed.origin !== new URL(origin).origin) return null;
  const path = parsed.pathname.replace(/\/+$/, "");
  const id = (value: string | null) =>
    value && new RegExp(`^${UUID}$`, "i").test(value) ? value.toLowerCase() : null;
  if (path === "/app/pipeline") {
    const deal = id(parsed.searchParams.get("deal"));
    return deal ? { kind: "deal", id: deal } : null;
  }
  if (path === "/app/ukoly-crm") {
    const task = id(parsed.searchParams.get("task"));
    return task ? { kind: "task", id: task } : null;
  }
  const contact = /^\/app\/kontakty\/([^/]+)$/.exec(path);
  if (contact) {
    const value = id(contact[1]!);
    return value ? { kind: "contact", id: value } : null;
  }
  return null;
}

/** Where a record of a chip opens. */
export function recordHref(link: RecordLink): string {
  switch (link.kind) {
    case "deal":
      return `/app/pipeline?deal=${link.id}`;
    case "contact":
      return `/app/kontakty/${link.id}`;
    case "task":
      return `/app/ukoly-crm?task=${link.id}`;
  }
}

export type BodySegment =
  | { type: "text"; text: string }
  | { type: "mention"; member: string }
  | { type: "record"; link: RecordLink; url: string }
  | { type: "url"; url: string };

/** A message's text cut into plain text, mentions, record chips and other links. */
export function bodySegments(body: string, origin: string): BodySegment[] {
  const marks: { start: number; end: number; segment: BodySegment }[] = [];
  for (const match of body.matchAll(MENTION)) {
    marks.push({
      start: match.index!,
      end: match.index! + match[0].length,
      segment: { type: "mention", member: match[1]!.toLowerCase() },
    });
  }
  for (const match of body.matchAll(URL_PATTERN)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (marks.some((mark) => start < mark.end && end > mark.start)) continue;
    const link = parseRecordLink(match[0], origin);
    marks.push({
      start,
      end,
      segment: link ? { type: "record", link, url: match[0] } : { type: "url", url: match[0] },
    });
  }
  marks.sort((a, b) => a.start - b.start);
  const out: BodySegment[] = [];
  let at = 0;
  for (const mark of marks) {
    if (mark.start > at) out.push({ type: "text", text: body.slice(at, mark.start) });
    out.push(mark.segment);
    at = mark.end;
  }
  if (at < body.length) out.push({ type: "text", text: body.slice(at) });
  return out;
}

/** The record links of a text, once each (to look their names up). */
export function recordLinksIn(body: string, origin: string): RecordLink[] {
  const seen = new Map<string, RecordLink>();
  for (const segment of bodySegments(body, origin)) {
    if (segment.type === "record") seen.set(`${segment.link.kind}:${segment.link.id}`, segment.link);
  }
  return [...seen.values()];
}

/** The text as a person reads it: "@Jana" for a mention (previews, export). */
export function plainBody(body: string, nameOf: (member: string) => string): string {
  return body.replace(MENTION, (_, member: string) => `@${nameOf(member.toLowerCase())}`);
}

/**
 * The "@…" being typed right before the caret, for the suggestions: from an
 * @ at the start or after a space, up to 30 characters without a line break.
 */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]{0,30})$/u.exec(before);
  if (!match) return null;
  return { start: caret - match[2]!.length - 1, query: match[2]! };
}

/** A mention picked in the composer: what the text shows ("@Jana Nová") and who it is. */
export type ComposerMention = { member: string; label: string };

/** Replaces the typed "@…" with "@Name " of the picked member; returns the text and the caret. */
export function insertMention(
  text: string,
  range: { start: number; caret: number },
  label: string,
): { text: string; caret: number } {
  const inserted = `@${label} `;
  const next = text.slice(0, range.start) + inserted + text.slice(range.caret);
  return { text: next, caret: range.start + inserted.length };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The text to store: every "@Name" of a member picked in the composer
 * becomes their token. Longer names go first, so "@Jana Nová" wins over "@Jana".
 */
export function encodeMentions(text: string, mentions: readonly ComposerMention[]): string {
  let out = text;
  const sorted = [...mentions].sort((a, b) => b.label.length - a.label.length);
  for (const mention of sorted) {
    if (!mention.label) continue;
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])@${escapeRegExp(mention.label)}(?![\\p{L}\\p{N}_])`, "gu");
    out = out.replace(pattern, (_, lead: string) => `${lead}${mentionToken(mention.member)}`);
  }
  return out;
}

/** A stored text back in the composer (editing): tokens as "@Name" and who they are. */
export function decodeMentions(
  body: string,
  nameOf: (member: string) => string,
): { text: string; mentions: ComposerMention[] } {
  const mentions = new Map<string, ComposerMention>();
  const text = body.replace(MENTION, (_, raw: string) => {
    const member = raw.toLowerCase();
    const label = nameOf(member);
    mentions.set(member, { member, label });
    return `@${label}`;
  });
  return { text, mentions: [...mentions.values()] };
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export function isImageType(mime: string): boolean {
  return (CHAT_IMAGE_TYPES as readonly string[]).includes(mime);
}
