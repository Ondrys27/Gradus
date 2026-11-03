// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { contentMatchesType, sniffFileType } from "./file-check";
import { sendChatMessage, sendErrorOf, type SendDeps } from "./send";
import type { ChatMessage } from "../types";

vi.mock("server-only", () => ({}));

const SPACE = "11111111-1111-4111-8111-111111111111";
const CHANNEL = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const FILE = "44444444-4444-4444-8444-444444444444";
const PEER = "55555555-5555-4555-8555-555555555555";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const PDF = new TextEncoder().encode("%PDF-1.4\n");

function stored(extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: ID,
    channel_id: CHANNEL,
    sender: SPACE,
    body: "Ahoj",
    attachments: [],
    reply_to_id: null,
    created_at: "2026-11-03T10:00:00Z",
    edited_at: null,
    deleted_at: null,
    ...extra,
  };
}

function deps(overrides: Partial<SendDeps> = {}): SendDeps {
  return {
    userId: SPACE,
    openDirect: vi.fn(async () => ({ id: CHANNEL, error: null })),
    channel: vi.fn(async () => ({ owner_id: SPACE, kind: "group" as const, archived_at: null })),
    fileInfo: vi.fn(async () => ({ size: 10, head: PNG })),
    removeFile: vi.fn(async () => {}),
    insert: vi.fn(async (row) => ({ message: stored({ body: row.body, attachments: row.attachments }), error: null })),
    existing: vi.fn(async () => null),
    ...overrides,
  };
}

describe("sending a message", () => {
  it("refuses without a session, a bad payload or two targets", async () => {
    expect(await sendChatMessage({ id: ID, channelId: CHANNEL, body: "x" }, deps({ userId: null }))).toMatchObject({
      status: 401,
    });
    expect(await sendChatMessage({ id: "x", channelId: CHANNEL, body: "x" }, deps())).toMatchObject({ status: 400 });
    expect(
      await sendChatMessage({ id: ID, channelId: CHANNEL, to: PEER, body: "x" }, deps()),
    ).toMatchObject({ status: 400 });
    expect(await sendChatMessage({ id: ID, channelId: CHANNEL, body: "   " }, deps())).toMatchObject({
      status: 400,
    });
    expect(
      await sendChatMessage({ id: ID, channelId: CHANNEL, body: "x", sender: SPACE }, deps()),
    ).toMatchObject({ status: 400 });
  });

  it("writes into the conversation with the user's client and reports the mentions", async () => {
    const d = deps();
    const result = await sendChatMessage(
      { id: ID, channelId: CHANNEL, body: `Ahoj <@${PEER}>` },
      d,
    );
    expect(result).toMatchObject({ ok: true, status: 201, mentions: [PEER], repeated: false });
    expect(d.insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: ID, channel_id: CHANNEL, owner_id: SPACE, reply_to_id: null }),
    );
  });

  it("makes the direct conversation at the first message", async () => {
    const d = deps({ channel: vi.fn(async () => ({ owner_id: SPACE, kind: "direct" as const, archived_at: null })) });
    const result = await sendChatMessage({ id: ID, to: PEER, body: "Ahoj" }, d);
    expect(d.openDirect).toHaveBeenCalledWith(PEER);
    expect(result).toMatchObject({ ok: true, channel: { id: CHANNEL, kind: "direct" } });
    const refused = await sendChatMessage(
      { id: ID, to: PEER, body: "Ahoj" },
      deps({ openDirect: vi.fn(async () => ({ id: null, error: { message: "chat_member_invalid" } })) }),
    );
    expect(refused).toMatchObject({ ok: false, status: 400, error: "member" });
  });

  it("hands back the stored message when the same id comes again", async () => {
    const d = deps({ existing: vi.fn(async () => stored()) });
    const result = await sendChatMessage({ id: ID, channelId: CHANNEL, body: "Ahoj" }, d);
    expect(result).toMatchObject({ ok: true, status: 200, repeated: true });
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("looks at every file: there, small enough and what it claims", async () => {
    const file = { id: FILE, name: "foto.png", mime: "image/png", width: 10, height: 10 };
    const ok = await sendChatMessage({ id: ID, channelId: CHANNEL, body: "", files: [file] }, deps());
    expect(ok).toMatchObject({ ok: true });
    if (ok.ok) {
      expect(ok.message.attachments).toEqual([
        { path: `${SPACE}/${ID}/${FILE}`, name: "foto.png", size: 10, mime: "image/png", width: 10, height: 10 },
      ]);
    }

    expect(
      await sendChatMessage(
        { id: ID, channelId: CHANNEL, body: "", files: [file] },
        deps({ fileInfo: vi.fn(async () => null) }),
      ),
    ).toMatchObject({ status: 400, error: "fileMissing" });

    const big = deps({ fileInfo: vi.fn(async () => ({ size: 11 * 1024 * 1024, head: PNG })) });
    expect(await sendChatMessage({ id: ID, channelId: CHANNEL, body: "", files: [file] }, big)).toMatchObject({
      error: "fileTooLarge",
    });
    expect(big.removeFile).toHaveBeenCalledWith(`${SPACE}/${ID}/${FILE}`);

    const fake = deps({ fileInfo: vi.fn(async () => ({ size: 10, head: PDF })) });
    expect(await sendChatMessage({ id: ID, channelId: CHANNEL, body: "", files: [file] }, fake)).toMatchObject({
      error: "fileType",
    });
    expect(fake.removeFile).toHaveBeenCalled();

    expect(
      await sendChatMessage(
        { id: ID, channelId: CHANNEL, body: "", files: [{ ...file, mime: "application/x-msdownload" }] },
        deps(),
      ),
    ).toMatchObject({ status: 400, error: "invalid" });
  });

  it("answers the database's refusals in kind", async () => {
    const insert = (message: string) =>
      deps({ insert: vi.fn(async () => ({ message: null, error: { message } })) });
    for (const [message, error] of [
      ["read_only", "readOnly"],
      ["chat_not_member", "forbidden"],
      ["new row violates row-level security policy", "forbidden"],
      ["chat_channel_archived", "archived"],
      ["chat_reply_outside", "invalid"],
    ] as const) {
      expect(await sendChatMessage({ id: ID, channelId: CHANNEL, body: "x" }, insert(message))).toMatchObject({
        ok: false,
        error,
      });
    }
    expect(sendErrorOf({ message: "something else" })).toBeNull();
    expect(
      await sendChatMessage({ id: ID, channelId: CHANNEL, body: "x" }, deps({ channel: vi.fn(async () => null) })),
    ).toMatchObject({ status: 404 });
  });
});

describe("file contents", () => {
  it("tells the types apart by their first bytes", () => {
    expect(sniffFileType(PNG)).toBe("png");
    expect(sniffFileType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffFileType(PDF)).toBe("pdf");
    expect(sniffFileType(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe("zip");
    expect(sniffFileType(new TextEncoder().encode("jméno;telefon\n"))).toBe("text");
    expect(sniffFileType(new Uint8Array([0x4d, 0x5a, 0x00, 0x01]))).toBeNull();
  });

  it("accepts a file only when the bytes match its type", () => {
    expect(contentMatchesType("image/png", PNG)).toBe(true);
    expect(contentMatchesType("image/jpeg", PNG)).toBe(false);
    expect(
      contentMatchesType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      ),
    ).toBe(true);
    expect(contentMatchesType("text/csv", new Uint8Array([0x4d, 0x5a, 0x00]))).toBe(false);
    expect(contentMatchesType("application/x-sh", new TextEncoder().encode("echo"))).toBe(false);
  });
});
