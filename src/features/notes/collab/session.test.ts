// @vitest-environment node
//
// Live sessions of one note in several "browsers": an in-memory channel in
// place of Supabase Realtime (it drops what a reader sends, as the policies
// on realtime.messages do), a fake database with the same version lock as
// note_collab_save, and a fake IndexedDB that survives a "reload".

import * as Y from "yjs";
import { afterEach, describe, expect, it } from "vitest";
import { extractText, type DocNode, type NoteDraft } from "../document";
import type { NoteKind } from "../mindmap/map-doc";
import type { CollabSaveResult } from "./persister";
import type { CollabTransport, PeerMeta, TransportHandlers } from "./provider";
import type { Wire } from "./protocol";
import { CollabSession, type LocalReplica, type SessionIO, type StoredNote } from "./session";
import { applyTextJson, textJsonOf } from "./ydoc";

const para = (text: string): DocNode => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const doc = (...lines: string[]): DocNode => ({ type: "doc", content: lines.map(para) });

// ---------------------------------------------------------------------------

class Hub {
  members = new Map<string, { handlers: TransportHandlers; meta: PeerMeta | null; connected: boolean; mayBroadcast: boolean }>();
  /** Everything any reader tried to send, to prove nothing went through. */
  refused: Wire[] = [];

  transport(sid: string, mayBroadcast: boolean): CollabTransport {
    return {
      start: (handlers) => {
        this.members.set(sid, { handlers, meta: null, connected: false, mayBroadcast });
        setTimeout(() => this.connect(sid), 0);
      },
      send: (payload) => {
        const me = this.members.get(sid);
        if (!me?.connected) return;
        if (!me.mayBroadcast) {
          this.refused.push(payload);
          return;
        }
        const copy = JSON.parse(JSON.stringify(payload));
        for (const [other, member] of this.members) {
          if (other === sid || !member.connected) continue;
          setTimeout(() => member.connected && member.handlers.message(copy), 1);
        }
      },
      track: (meta) => {
        const me = this.members.get(sid);
        if (!me) return;
        me.meta = meta;
        this.presence();
      },
      stop: () => {
        this.members.delete(sid);
        this.presence();
      },
    };
  }

  connect(sid: string) {
    const member = this.members.get(sid);
    if (!member) return;
    member.connected = true;
    member.handlers.status("connected");
    this.presence();
  }

  disconnect(sid: string) {
    const member = this.members.get(sid);
    if (!member) return;
    member.connected = false;
    member.handlers.status("offline");
    this.presence();
  }

  private presence() {
    const list = [...this.members.values()].filter((m) => m.connected && m.meta).map((m) => m.meta!);
    for (const member of this.members.values()) if (member.connected) member.handlers.peers(list);
  }
}

type Row = { kind: NoteKind; version: number; state: Uint8Array | null; content: unknown; text: string };

class FakeDb {
  row: Row | null;
  writers: Set<string>;
  saves = 0;

  constructor(content: DocNode, writers: string[]) {
    this.row = { kind: "text", version: 0, state: null, content, text: extractText(content) };
    this.writers = new Set(writers);
  }

  load(): StoredNote | null {
    if (!this.row) return null;
    return { kind: this.row.kind, version: this.row.version, state: this.row.state, content: this.row.content };
  }

  save(userId: string, input: { base: number; state: Uint8Array; draft: NoteDraft }): CollabSaveResult {
    if (!this.row) return { status: "missing" };
    if (!this.writers.has(userId)) return { status: "denied" };
    if (this.row.version !== input.base || (input.draft.kind ?? "text") !== this.row.kind) {
      return { status: "conflict", version: this.row.version, state: this.row.state, kind: this.row.kind };
    }
    // A save only ever adds to what is stored: the stored state must be inside the new one.
    if (this.row.state) {
      const check = new Y.Doc();
      Y.applyUpdate(check, input.state);
      const before = Y.encodeStateVector(check);
      Y.applyUpdate(check, this.row.state);
      expect(Y.encodeStateVector(check)).toEqual(before);
    }
    this.saves += 1;
    this.row = {
      ...this.row,
      version: this.row.version + 1,
      state: input.state,
      content: input.draft.content,
      text: input.draft.content_text,
    };
    return { status: "saved", version: this.row.version };
  }

  /** Someone else (an older client, Undo) changed the text without the state. */
  replace(content: DocNode) {
    this.row = { ...this.row!, version: this.row!.version + 1, state: null, content, text: extractText(content) };
  }
}

/** IndexedDB of one browser profile: updates and values per note, kept across sessions. */
class FakeStorage {
  updates: Uint8Array[] = [];
  values = new Map<string, unknown>();

  open(doc: Y.Doc): LocalReplica {
    const origin = {};
    for (const update of this.updates) Y.applyUpdate(doc, update, origin);
    const onUpdate = (update: Uint8Array) => this.updates.push(update);
    doc.on("update", onUpdate);
    return {
      origin,
      ready: Promise.resolve(),
      get: async (key) => this.values.get(key),
      set: async (key, value) => {
        this.values.set(key, value);
      },
      clear: async () => {
        doc.off("update", onUpdate);
        this.updates = [];
        this.values.clear();
      },
      destroy: () => doc.off("update", onUpdate),
    };
  }
}

const open: CollabSession[] = [];

function browser(
  hub: Hub,
  db: FakeDb,
  userId: string,
  options: { canWrite?: boolean; storage?: FakeStorage; online?: { value: boolean } } = {},
) {
  const storage = options.storage ?? new FakeStorage();
  const online = options.online ?? { value: true };
  const canWrite = options.canWrite ?? true;
  let sid = "";
  const io: SessionIO = {
    load: async () => {
      if (!online.value) throw new Error("offline");
      return db.load();
    },
    save: async (input) => {
      if (!online.value) throw new Error("offline");
      return db.save(userId, input);
    },
    checkpoint: async () => undefined,
    openLocal: (d) => storage.open(d),
    transport: (s) => {
      sid = s;
      return hub.transport(s, canWrite);
    },
    isOnline: () => online.value,
  };
  const session = new CollabSession({
    noteId: "note-1",
    kind: "text",
    me: { userId, name: userId, avatarUrl: null, color: "teal" },
    canWrite,
    initial: db.row?.content ?? doc(),
    io,
    timings: { saveDelayMs: 20, remoteSaveDelayMs: 150, batchMs: 5, retryDelaysMs: [30] },
  });
  open.push(session);
  return { session, storage, online, sid: () => sid };
}

const textOf = (session: CollabSession) => extractText(textJsonOf(session.doc));

async function until(check: () => boolean, ms = 3_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const settled = (session: CollabSession) => session.getSnapshot().save === "saved";

afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

// ---------------------------------------------------------------------------

describe("live notes: several people at once", () => {
  it("merges two people typing into the same paragraph: both see the same text, the database too", async () => {
    const hub = new Hub();
    const db = new FakeDb(doc("Plán", "Zavolat"), ["owner", "editor"]);
    const a = browser(hub, db, "owner");
    const b = browser(hub, db, "editor");
    await Promise.all([a.session.ready, b.session.ready]);
    await until(() => a.session.getSnapshot().people.length === 1 && b.session.getSnapshot().people.length === 1);

    applyTextJson(a.session.doc, doc("Plán", "Zavolat Novákovi"), "typing");
    applyTextJson(b.session.doc, doc("Plán", "Hned zavolat"), "typing");

    await until(() => textOf(a.session) === textOf(b.session) && textOf(a.session).includes("Novákovi") && textOf(a.session).includes("Hned"));
    await until(() => settled(a.session) && settled(b.session) && db.row!.text === textOf(a.session));
    expect(textOf(b.session)).toBe(textOf(a.session));
    // "Píše …": the other one's name while they type.
    expect(a.session.getSnapshot().people.map((p) => p.userId)).toEqual(["editor"]);
  });

  it("never doubles the text when both build the first state from the same content", async () => {
    const hub = new Hub();
    const db = new FakeDb(doc("Ceník", "Konzultace"), ["owner", "editor"]);
    const a = browser(hub, db, "owner");
    const b = browser(hub, db, "editor");
    await Promise.all([a.session.ready, b.session.ready]);
    applyTextJson(a.session.doc, doc("Ceník", "Konzultace", "A"), "typing");
    applyTextJson(b.session.doc, doc("Ceník", "Konzultace", "B"), "typing");
    await until(() => settled(a.session) && settled(b.session) && textOf(a.session) === textOf(b.session) && db.row!.text === textOf(a.session));
    expect(textOf(a.session).match(/Ceník/g)).toHaveLength(1);
    expect(textOf(a.session).match(/Konzultace/g)).toHaveLength(1);
  });

  it("keeps what someone writes offline and merges it once they are back", async () => {
    const hub = new Hub();
    const db = new FakeDb(doc("Porada"), ["owner", "editor"]);
    const a = browser(hub, db, "owner");
    const b = browser(hub, db, "editor");
    await Promise.all([a.session.ready, b.session.ready]);
    await until(() => b.session.getSnapshot().connection === "connected");

    // B loses the connection and keeps writing; A writes too.
    b.online.value = false;
    hub.disconnect(b.sid());
    applyTextJson(b.session.doc, doc("Porada", "Napsáno offline"), "typing");
    applyTextJson(a.session.doc, doc("Porada 2027"), "typing");
    await until(() => b.session.getSnapshot().save === "offline");
    await until(() => settled(a.session) && db.row!.text === "Porada 2027");
    expect(textOf(a.session)).not.toContain("offline");

    // Back online: both see both, and so does the database.
    b.online.value = true;
    hub.connect(b.sid());
    b.session.online();
    await until(() => textOf(a.session) === textOf(b.session) && textOf(a.session).includes("Napsáno offline"));
    expect(textOf(a.session)).toContain("Porada 2027");
    await until(() => settled(a.session) && settled(b.session) && db.row!.text === textOf(a.session));
  });

  it("brings an offline change back after a reload (the browser's copy)", async () => {
    const hub = new Hub();
    const db = new FakeDb(doc("Úkoly"), ["owner"]);
    const storage = new FakeStorage();
    const online = { value: false };
    const first = browser(hub, db, "owner", { storage, online });
    await first.session.ready;
    applyTextJson(first.session.doc, doc("Úkoly", "Z vlaku"), "typing");
    await until(() => first.session.getSnapshot().save === "offline");
    await new Promise((resolve) => setTimeout(resolve, 350)); // the dirty mark is written
    await open.splice(open.indexOf(first.session), 1)[0].close();
    expect(db.row!.text).toBe("Úkoly");

    online.value = true;
    const again = browser(hub, db, "owner", { storage, online });
    await again.session.ready;
    expect(textOf(again.session)).toContain("Z vlaku");
    await until(() => settled(again.session) && db.row!.text.includes("Z vlaku"));
  });

  it("carries own unsaved work onto a note someone replaced meanwhile, keeping their change too", async () => {
    const hub = new Hub();
    const db = new FakeDb(doc("Nabídka", "Cena"), ["owner"]);
    const a = browser(hub, db, "owner");
    await a.session.ready;
    applyTextJson(a.session.doc, doc("Nabídka", "Cena", "Moje doplnění"), "typing");
    // Before the save: the text is replaced outside the live editor (the state is dropped).
    db.replace(doc("Nabídka 2027", "Cena"));
    await until(() => a.session.getSnapshot().phase === "ready" && a.session.getSnapshot().generation === 2);
    await until(() => settled(a.session) && db.row!.text === textOf(a.session));
    expect(textOf(a.session)).toBe("Nabídka 2027\nCena\nMoje doplnění");
  });
});

describe("live notes: readers and limits", () => {
  it("lets a viewer see changes live but never write, not even by changing its document directly", async () => {
    const hub = new Hub();
    const db = new FakeDb(doc("Ceník"), ["owner"]);
    const owner = browser(hub, db, "owner");
    const viewer = browser(hub, db, "viewer", { canWrite: false });
    await Promise.all([owner.session.ready, viewer.session.ready]);
    expect(viewer.session.getSnapshot().writable).toBe(false);
    await until(() => owner.session.getSnapshot().people.length === 1);

    applyTextJson(owner.session.doc, doc("Ceník", "Konzultace 1 500 Kč"), "typing");
    await until(() => textOf(viewer.session).includes("Konzultace"));

    // A forged change in the viewer's own document goes nowhere.
    applyTextJson(viewer.session.doc, doc("Ceník", "Konzultace 1 500 Kč", "Podvrh"), "forged");
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(textOf(owner.session)).not.toContain("Podvrh");
    await until(() => settled(owner.session));
    expect(db.row!.text).not.toContain("Podvrh");
    // Nor by calling the save directly.
    expect(db.save("viewer", { base: db.row!.version, state: Y.encodeStateAsUpdate(viewer.session.doc), draft: viewer.session.draft() })).toEqual({ status: "denied" });
    expect(db.row!.text).not.toContain("Podvrh");
  });

  it("never makes a viewer save what others have not saved yet (it would lose the note as denied)", async () => {
    const hub = new Hub();
    const db = new FakeDb(doc("Ceník"), ["owner"]);
    // The owner's saves do not get through: what it types stays unsaved.
    const owner = browser(hub, db, "owner");
    await owner.session.ready;
    owner.online.value = false;
    applyTextJson(owner.session.doc, doc("Ceník", "Neuloženo"), "typing");
    await new Promise((resolve) => setTimeout(resolve, 60));

    let saves = 0;
    const viewer = browser(hub, db, "viewer", { canWrite: false });
    const save = db.save.bind(db);
    db.save = (userId, input) => {
      if (userId === "viewer") saves += 1;
      return save(userId, input);
    };
    await viewer.session.ready;
    await until(() => textOf(viewer.session).includes("Neuloženo"));
    // Past the remote save delay (150 ms in the tests) and its retry.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(saves).toBe(0);
    expect(viewer.session.getSnapshot().phase).toBe("ready");
  });

  it("ends a session whose access was taken away: no save, the channel left, the browser's copy gone", async () => {
    const hub = new Hub();
    const db = new FakeDb(doc("Ceník"), ["owner", "editor"]);
    const owner = browser(hub, db, "owner");
    const editor = browser(hub, db, "editor");
    await Promise.all([owner.session.ready, editor.session.ready]);
    await until(() => owner.session.getSnapshot().people.length === 1);
    applyTextJson(editor.session.doc, doc("Ceník", "Rozepsáno"), "typing");
    const saves = db.saves;

    editor.session.revoke();
    await until(() => editor.session.getSnapshot().phase === "gone");
    await until(() => owner.session.getSnapshot().people.length === 0);
    expect(hub.members.has(editor.sid())).toBe(false);
    expect(editor.storage.updates).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(db.saves).toBe(saves);
    expect(db.row!.text).not.toContain("Rozepsáno");
  });

  it("lets ten people write and the eleventh read until a place frees up", async () => {
    const hub = new Hub();
    const users = Array.from({ length: 11 }, (_, i) => `u${i}`);
    const db = new FakeDb(doc("Velká porada"), users);
    const sessions: ReturnType<typeof browser>[] = [];
    for (const user of users) {
      const b = browser(hub, db, user);
      await b.session.ready;
      await new Promise((resolve) => setTimeout(resolve, 2));
      sessions.push(b);
    }
    await until(() => sessions.every((b) => b.session.getSnapshot().people.length === 10));
    expect(sessions.slice(0, 10).every((b) => b.session.getSnapshot().writable)).toBe(true);
    const last = sessions[10].session.getSnapshot();
    expect(last.writable).toBe(false);
    expect(last.limit).toBe("people");

    // One leaves: the eleventh may write.
    const leaving = sessions[0].session;
    open.splice(open.indexOf(leaving), 1);
    await leaving.close();
    await until(() => sessions[10].session.getSnapshot().writable);
    expect(sessions[10].session.getSnapshot().limit).toBeNull();
  });
});
