import { describe, expect, it } from "vitest";
import {
  badgeText,
  bodySegments,
  canDeleteMessage,
  canEditMessage,
  decodeMentions,
  directKey,
  encodeMentions,
  firstUnreadId,
  insertMention,
  isUnread,
  matchesSearch,
  mentionQueryAt,
  mentionsIn,
  mergeMessages,
  messageRows,
  parseRecordLink,
  plainBody,
  readCount,
  sortChannels,
  titleWithUnread,
  unreadTotal,
} from "./logic";
import type { ChatMessage } from "./types";

const ORIGIN = "https://app.gradus.test";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function message(id: string, sender: string | null, at: string, extra: Partial<ChatMessage> = {}) {
  return {
    id,
    channel_id: "ch",
    sender,
    body: "x",
    attachments: [],
    reply_to_id: null,
    created_at: at,
    edited_at: null,
    deleted_at: null,
    ...extra,
  } satisfies ChatMessage;
}

describe("conversations", () => {
  it("keys a direct conversation the same from either side", () => {
    expect(directKey(A, B)).toBe(directKey(B, A));
    expect(directKey(B, A)).toBe(`${A}:${B}`);
  });

  it("puts pinned ones first, then the newest", () => {
    const channels = [
      { id: "old", pinnedAt: null, createdAt: "2026-11-01T00:00:00Z", last: { at: "2026-11-01T10:00:00Z" } },
      { id: "new", pinnedAt: null, createdAt: "2026-11-01T00:00:00Z", last: { at: "2026-11-03T10:00:00Z" } },
      { id: "pin", pinnedAt: "2026-10-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z", last: null },
      { id: "empty", pinnedAt: null, createdAt: "2026-11-02T00:00:00Z", last: null },
    ] as never[];
    expect(sortChannels(channels).map((c: { id: string }) => c.id)).toEqual([
      "pin",
      "new",
      "empty",
      "old",
    ]);
  });

  it("finds conversations without diacritics", () => {
    expect(matchesSearch("zitra", "Zítra v devět")).toBe(true);
    expect(matchesSearch("obchod", null, "Prodej")).toBe(false);
    expect(matchesSearch("  ", "cokoliv")).toBe(true);
  });
});

describe("unread", () => {
  const base = { unread: 0, muted: false, mutedAll: false, mentioned: false };

  it("adds up conversations that are not silenced", () => {
    expect(
      unreadTotal([
        { ...base, unread: 3 },
        { ...base, unread: 2 },
        { ...base, unread: 5, muted: true },
        { ...base, unread: 4, mutedAll: true },
      ]),
    ).toBe(5);
  });

  it("lets a mention through a mute, once", () => {
    expect(unreadTotal([{ ...base, unread: 7, muted: true, mentioned: true }])).toBe(1);
    expect(unreadTotal([{ ...base, unread: 0, muted: true, mentioned: true }])).toBe(0);
  });

  it("shows 99+ and nothing at zero, in the badge and the title", () => {
    expect(badgeText(0)).toBe("");
    expect(badgeText(7)).toBe("7");
    expect(badgeText(140)).toBe("99+");
    expect(titleWithUnread("Zprávy · Gradus", 3)).toBe("(3) Zprávy · Gradus");
    expect(titleWithUnread("(3) Zprávy · Gradus", 5)).toBe("(5) Zprávy · Gradus");
    expect(titleWithUnread("(99+) Zprávy · Gradus", 0)).toBe("Zprávy · Gradus");
  });

  it("never counts own or deleted messages, everything when nothing was read", () => {
    const theirs = message("1", B, "2026-11-03T10:00:00Z");
    expect(isUnread(theirs, A, null)).toBe(true);
    expect(isUnread(theirs, A, "2026-11-03T10:00:00Z")).toBe(false);
    expect(isUnread(theirs, A, "2026-11-03T09:59:59Z")).toBe(true);
    expect(isUnread(message("2", A, "2026-11-03T11:00:00Z"), A, null)).toBe(false);
    expect(isUnread({ ...theirs, deleted_at: "2026-11-03T10:01:00Z" }, A, null)).toBe(false);
    const list = [
      message("1", B, "2026-11-03T10:00:00Z"),
      message("2", A, "2026-11-03T10:05:00Z"),
      message("3", B, "2026-11-03T10:10:00Z"),
    ];
    expect(firstUnreadId(list, A, "2026-11-03T10:00:00Z")).toBe("3");
    expect(firstUnreadId(list, A, "2026-11-03T10:10:00Z")).toBeNull();
  });

  it("counts who read a message, never its sender", () => {
    const sent = message("1", A, "2026-11-03T10:00:00Z");
    const members = [
      { member: A, last_read_at: "2026-11-03T12:00:00Z" },
      { member: B, last_read_at: "2026-11-03T10:00:00Z" },
      { member: C, last_read_at: "2026-11-03T09:00:00Z" },
      { member: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", last_read_at: null },
    ];
    expect(readCount(sent, members)).toBe(1);
  });
});

describe("editing", () => {
  const now = Date.parse("2026-11-03T10:20:00Z");

  it("lets the sender edit and delete for 15 minutes", () => {
    expect(canEditMessage(message("1", A, "2026-11-03T10:06:00Z"), A, now)).toBe(true);
    expect(canEditMessage(message("1", A, "2026-11-03T10:04:00Z"), A, now)).toBe(false);
    expect(canEditMessage(message("1", B, "2026-11-03T10:19:00Z"), A, now)).toBe(false);
    expect(
      canEditMessage(message("1", A, "2026-11-03T10:19:00Z", { pending: "sending" }), A, now),
    ).toBe(false);
  });

  it("lets the owner of the space delete anything that is not deleted yet", () => {
    expect(canDeleteMessage(message("1", B, "2026-01-01T00:00:00Z"), A, true, now)).toBe(true);
    expect(canDeleteMessage(message("1", B, "2026-11-03T10:19:00Z"), A, false, now)).toBe(false);
    expect(
      canDeleteMessage(message("1", B, "2026-11-03T10:19:00Z", { deleted_at: "x" }), A, true, now),
    ).toBe(false);
  });
});

describe("rows of a conversation", () => {
  it("groups one sender's run, splits on days in the reader's zone and marks unread", () => {
    const list = [
      message("1", A, "2026-11-02T22:50:00Z"), // 23:50 in Prague
      message("2", A, "2026-11-02T22:52:00Z"),
      message("3", A, "2026-11-02T23:05:00Z"), // next day in Prague
      message("4", B, "2026-11-02T23:06:00Z"),
      message("5", B, "2026-11-02T23:20:00Z"), // more than 5 minutes later
    ];
    const rows = messageRows(list, "Europe/Prague", "4");
    expect(rows.map((row) => (row.type === "message" ? `${row.key}:${+row.first}${+row.last}` : row.type))).toEqual([
      "day",
      "1:10",
      "2:01",
      "day",
      "3:11",
      "unread",
      "4:11",
      "5:11",
    ]);
    // In UTC it is one day.
    expect(messageRows(list, "UTC").filter((row) => row.type === "day")).toHaveLength(1);
  });

  it("merges pages and live messages, the sent copy winning over the pending one", () => {
    const pending = message("1", A, "2026-11-03T10:00:00Z", { pending: "sending" });
    const sent = message("1", A, "2026-11-03T10:00:01Z");
    const older = message("0", B, "2026-11-03T09:00:00Z");
    const merged = mergeMessages([older], [pending], [sent]);
    expect(merged.map((m) => m.id)).toEqual(["0", "1"]);
    expect(merged[1]!.pending).toBeUndefined();
    expect(mergeMessages([sent], [pending])[0]!.pending).toBeUndefined();
  });
});

describe("mentions", () => {
  it("finds the members a text mentions", () => {
    expect(mentionsIn(`Ahoj <@${A}> a <@${B}>, <@${A}>`)).toEqual([A, B]);
    expect(mentionsIn("@nikdo")).toEqual([]);
  });

  it("knows the @… being typed", () => {
    expect(mentionQueryAt("Ahoj @Ja", 8)).toEqual({ start: 5, query: "Ja" });
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQueryAt("mail@firma", 10)).toBeNull();
    expect(mentionQueryAt("Ahoj @Jana ", 11)).toBeNull();
  });

  it("goes from the composer to the stored text and back", () => {
    const typed = insertMention("Ahoj @Ja", { start: 5, caret: 8 }, "Jana Nová");
    expect(typed).toEqual({ text: "Ahoj @Jana Nová ", caret: 16 });
    const mentions = [
      { member: A, label: "Jana Nová" },
      { member: B, label: "Jana" },
    ];
    const stored = encodeMentions(`${typed.text}a @Jana, ne mail@Jana`, mentions);
    expect(stored).toBe(`Ahoj <@${A}> a <@${B}>, ne mail@Jana`);
    const names: Record<string, string> = { [A]: "Jana Nová", [B]: "Jana" };
    expect(decodeMentions(stored, (m) => names[m]!).text).toBe("Ahoj @Jana Nová a @Jana, ne mail@Jana");
    expect(plainBody(stored, (m) => names[m]!)).toBe("Ahoj @Jana Nová a @Jana, ne mail@Jana");
  });
});

describe("record links", () => {
  it("turns addresses of deals, contacts and tasks of this site into chips", () => {
    expect(parseRecordLink(`${ORIGIN}/app/pipeline?deal=${A}`, ORIGIN)).toEqual({ kind: "deal", id: A });
    expect(parseRecordLink(`${ORIGIN}/app/kontakty/${B}`, ORIGIN)).toEqual({ kind: "contact", id: B });
    expect(parseRecordLink(`${ORIGIN}/app/ukoly-crm?task=${C}&x=1`, ORIGIN)).toEqual({
      kind: "task",
      id: C,
    });
    expect(parseRecordLink(`https://evil.test/app/kontakty/${B}`, ORIGIN)).toBeNull();
    expect(parseRecordLink(`${ORIGIN}/app/kontakty/tabulky`, ORIGIN)).toBeNull();
    expect(parseRecordLink(`${ORIGIN}/app/pipeline`, ORIGIN)).toBeNull();
  });

  it("cuts a text into text, mentions, chips and links", () => {
    const body = `Viz ${ORIGIN}/app/pipeline?deal=${A}, píše <@${B}> a https://example.com/x.`;
    expect(bodySegments(body, ORIGIN)).toEqual([
      { type: "text", text: "Viz " },
      { type: "record", link: { kind: "deal", id: A }, url: `${ORIGIN}/app/pipeline?deal=${A}` },
      { type: "text", text: ", píše " },
      { type: "mention", member: B },
      { type: "text", text: " a " },
      { type: "url", url: "https://example.com/x" },
      { type: "text", text: "." },
    ]);
  });
});
