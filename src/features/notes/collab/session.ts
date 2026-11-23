/**
 * One open note in one tab (28.4): its Yjs document, the copy in the browser
 * (IndexedDB, so changes made offline survive a reload), the live channel and
 * the saving. The editor binds to `doc`; everything else is here.
 *
 * Opening: the browser's copy is read, then the stored note. The same
 * generation merges; another generation (the note was rebuilt or replaced
 * meanwhile) replaces the browser's copy, and its unsaved changes are put
 * on top of the stored note as an ordinary change, so nothing typed offline
 * is lost. A note without a stored state is built from its content (an
 * existing note on its first live open). A state grown much bigger than its
 * text is rebuilt (compaction) when the note opens with nobody else in it.
 *
 * The I/O (database, browser storage, channel) is injected, so the whole
 * flow runs in Vitest.
 */
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { NoteDraft, TextOptions } from "../document";
import type { NoteKind } from "../mindmap/map-doc";
import type { SaveStatus } from "../note-saver";
import { COLLAB, ORIGIN_LOCAL, ORIGIN_REMOTE, ORIGIN_SEED, ORIGIN_SERVER } from "./limits";
import { CollabPersister, type CollabSaveResult } from "./persister";
import { CollabProvider, type CollabColor, type CollabTransport, type PeerMeta, type TransportStatus } from "./provider";
import { applyContent, carryOver, contentOf, draftOf, genOf, genOfState, kindOfDoc, seedGen, seedState } from "./ydoc";

/** Own unsaved work taken onto a rebuilt note: what it was based on, and what it is now. */
type Carry = { base: unknown | null; mine: unknown };

export type StoredNote = {
  kind: NoteKind;
  version: number;
  state: Uint8Array | null;
  content: unknown;
};

/** The browser's copy of the document (y-indexeddb in the app). */
export interface LocalReplica {
  /** The origin of the changes it loads into the document. */
  origin: unknown;
  ready: Promise<void>;
  get(key: string): Promise<unknown>;
  set(key: string, value: string | number): Promise<void>;
  /** Removes the copy (and stops writing into it). */
  clear(): Promise<void>;
  destroy(): void;
}

export type SessionIO = {
  /** The stored note; null when it is not there (yet), throws without a connection. */
  load(): Promise<StoredNote | null>;
  save(input: { base: number; state: Uint8Array; draft: NoteDraft; authors: string[] }): Promise<CollabSaveResult>;
  /** Closing the note ends the version being written (a snapshot). */
  checkpoint(): Promise<void>;
  openLocal(doc: Y.Doc): LocalReplica;
  transport(sid: string): CollabTransport;
  isOnline(): boolean;
  track?(event: "opened" | "limited" | "merged", props: Record<string, string | number | boolean>): void;
};

export type Me = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  color: CollabColor;
};

export type Person = { userId: string; name: string; avatarUrl: string | null; color: CollabColor; writer: boolean };

export type SessionSnapshot = {
  /** loading → ready; replaced = opened again (the editor starts over), gone = deleted or no access. */
  phase: "loading" | "ready" | "gone";
  /** The note's kind as stored (it may have been converted meanwhile). */
  kind: NoteKind;
  /** Bumped every time the document is replaced: the editor binds to the new one. */
  generation: number;
  /** May this tab write now (a writer, within the limits). */
  writable: boolean;
  limit: null | "people" | "size";
  connection: TransportStatus;
  save: SaveStatus;
  /** Others who have the note open now, one entry per person. */
  people: Person[];
  /** Names of the others writing right now. */
  typing: string[];
};

type Options = {
  noteId: string;
  kind: NoteKind;
  me: Me;
  /** May the account write the note (owner or editor, not a read-only space)? */
  canWrite: boolean;
  /** What the note holds when it is not stored yet (made in this tab). */
  initial: unknown;
  io: SessionIO;
  textOptions?: () => TextOptions;
  now?: () => number;
  /** Shorter pauses in the tests. */
  timings?: { saveDelayMs?: number; remoteSaveDelayMs?: number; batchMs?: number; retryDelaysMs?: number[] };
};

export class CollabSession {
  doc: Y.Doc;
  awareness: Awareness;
  readonly sid = crypto.randomUUID();

  private snapshot: SessionSnapshot;
  private listeners = new Set<() => void>();
  private local: LocalReplica | null = null;
  private provider: CollabProvider | null = null;
  private persister: CollabPersister | null = null;
  private kind: NoteKind;
  private canWrite: boolean;
  private storedSV: Uint8Array | null = null;
  /** The content last known to be stored: the base of own changes carried onto a rebuilt note. */
  private base: unknown | null = null;
  private typingAt = new Map<string, number>();
  private typingTimer: ReturnType<typeof setInterval> | null = null;
  private peers: PeerMeta[] = [];
  private authoredHere = false;
  private closed = false;
  private closing = false;
  private lastPull = 0;
  private dirtyMark: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;
  private readonly joinedAt: number;
  ready: Promise<void>;

  constructor(private readonly options: Options) {
    this.kind = options.kind;
    this.canWrite = options.canWrite;
    this.now = options.now ?? Date.now;
    this.joinedAt = this.now();
    this.doc = new Y.Doc();
    this.awareness = new Awareness(this.doc);
    this.snapshot = {
      phase: "loading",
      kind: options.kind,
      generation: 0,
      writable: false,
      limit: null,
      connection: "connecting",
      save: "saved",
      people: [],
      typing: [],
    };
    this.ready = this.open(null);
  }

  // --- reading -------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionSnapshot => this.snapshot;

  get noteKind(): NoteKind {
    return this.kind;
  }

  /** The note as it is now, derived for the database (title, content, text). */
  draft(): NoteDraft {
    return draftOf(this.doc, this.kind, this.options.textOptions?.());
  }

  hasUnsaved(): boolean {
    return !!this.persister?.hasLocalUnsaved();
  }

  // --- changing ------------------------------------------------------------

  /** The account's rights changed (a share, a read-only space). */
  setCanWrite(canWrite: boolean) {
    if (this.canWrite === canWrite) return;
    this.canWrite = canWrite;
    this.trackPresence();
    this.recompute();
    if (this.snapshot.writable) this.provider?.resume();
  }

  /** New content as one change of this person (a restored version, a branch from the menu). */
  applyContent(content: unknown) {
    if (!this.snapshot.writable) throw new Error("note_read_only");
    applyContent(this.doc, this.kind, content, ORIGIN_LOCAL);
  }

  /** The awareness field of the map: which node this person has selected. */
  setSelectedNode(id: string | null) {
    this.awareness.setLocalStateField("node", id);
  }

  /** Saves now (leaving the note, before Grady reads it). */
  async flush(): Promise<void> {
    await this.ready;
    this.provider?.flushQueue();
    await this.persister?.flush();
  }

  /** Reads the stored note again (Grady wrote into it, a peer is on another generation). */
  async pull(): Promise<void> {
    await this.ready;
    if (this.closed || this.snapshot.phase !== "ready") return;
    this.lastPull = this.now();
    let stored: StoredNote | null;
    try {
      stored = await this.options.io.load();
    } catch {
      return;
    }
    if (!stored || this.closed) return;
    if (stored.kind !== this.kind) {
      this.restart(null);
      return;
    }
    const gen = stored.state ? genOfState(stored.state) : seedGen(stored.version);
    if (gen !== genOf(this.doc)) {
      this.restart(this.carryNow());
      return;
    }
    if (stored.state && this.adopt(stored.state, ORIGIN_SERVER)) {
      this.storedSV = Y.encodeStateVector(this.doc);
      if (!this.persister?.dirty()) this.setBase(contentOf(this.doc, this.kind));
    }
    if (this.persister && stored.version > this.persister.version) this.persister.version = stored.version;
  }

  online() {
    this.persister?.online();
  }

  /** Tells the others to read the note again (it was converted or replaced from here). */
  announceReset() {
    this.provider?.announceReset();
  }

  /** Closes the note: saves, ends the version, leaves the channel. */
  async close(): Promise<void> {
    if (this.closed || this.closing) return;
    this.closing = true;
    try {
      await this.flush();
      if (this.authoredHere && this.persister && !this.persister.dirty()) await this.options.io.checkpoint();
    } catch {
      // The copy in the browser keeps what did not reach the database.
    }
    this.teardown();
  }

  /** On page hide: a best-effort save and snapshot, the session stays. */
  hide() {
    if (this.closed) return;
    void this.flush().then(() => {
      if (this.authoredHere && this.persister && !this.persister.dirty()) {
        this.authoredHere = false;
        void this.options.io.checkpoint().catch(() => undefined);
      }
    });
  }

  // --- the flow ------------------------------------------------------------

  private emit(patch: Partial<SessionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private teardown() {
    this.closed = true;
    if (this.typingTimer) clearInterval(this.typingTimer);
    if (this.dirtyMark) clearTimeout(this.dirtyMark);
    this.persister?.dispose();
    this.provider?.destroy();
    this.awareness.destroy();
    this.local?.destroy();
    this.doc.off("update", this.onUpdate);
    this.doc.destroy();
    this.listeners.clear();
  }

  /** Opens the note again on a new document, with unsaved content carried over. */
  private carryNow(): Carry | null {
    return this.persister?.hasLocalUnsaved() ? { base: this.base, mine: contentOf(this.doc, this.kind) } : null;
  }

  private setBase(content: unknown) {
    this.base = content;
    void this.local?.set("base", JSON.stringify(content)).catch(() => undefined);
  }

  private restart(carry: Carry | null) {
    if (this.closed || this.closing) return;
    this.persister?.dispose();
    this.provider?.destroy();
    this.provider = null;
    this.persister = null;
    this.doc.off("update", this.onUpdate);
    const oldLocal = this.local;
    this.local = null;
    this.awareness.destroy();
    this.doc = new Y.Doc();
    this.awareness = new Awareness(this.doc);
    this.emit({ phase: "loading", writable: false });
    this.ready = (async () => {
      await oldLocal?.clear().catch(() => undefined);
      await this.open(carry);
    })();
  }

  private async open(carry: Carry | null): Promise<void> {
    const { io } = this.options;
    const fallbackGen = (version: number) => seedGen(version);

    // 1. The browser's copy.
    let local: LocalReplica | null = io.openLocal(this.doc);
    let localDirty = false;
    let localVersion: number | null = null;
    let localBase: unknown | null = null;
    try {
      await local.ready;
      localDirty = (await local.get("dirty")) === 1;
      const v = await local.get("version");
      localVersion = typeof v === "number" ? v : null;
      const b = await local.get("base");
      localBase = typeof b === "string" ? JSON.parse(b) : null;
    } catch {
      local = null;
    }
    const hasLocal = genOf(this.doc) !== null && kindOfDoc(this.doc) === this.kind;

    // 2. The stored note.
    let stored: StoredNote | null | undefined;
    try {
      stored = await io.load();
    } catch {
      stored = undefined; // offline
    }
    if (this.closed) return;

    let version: number;
    if (stored === undefined) {
      // Offline: the browser's copy, or the content we have, on an unknown version.
      if (!hasLocal) this.adopt(seedState(this.kind, this.options.initial, `offline:${crypto.randomUUID()}`), ORIGIN_SEED);
      version = hasLocal ? (localVersion ?? -1) : -1;
      this.base = hasLocal ? localBase : contentOf(this.doc, this.kind);
    } else if (stored === null) {
      // Not stored yet (made in this tab, its autosave inserts it): built as everyone will build it.
      if (!hasLocal) this.adopt(seedState(this.kind, this.options.initial, fallbackGen(0)), ORIGIN_SEED);
      version = hasLocal ? (localVersion ?? 0) : 0;
      this.base = hasLocal ? localBase : contentOf(this.doc, this.kind);
    } else {
      if (stored.kind !== this.kind) {
        // Converted to the other kind meanwhile: the screen opens it as that, own work of the old kind stays out.
        this.kind = stored.kind;
        this.emit({ kind: stored.kind });
        carry = null;
        localDirty = false;
      }
      const storedGen = (stored.state ? genOfState(stored.state) : null) ?? fallbackGen(stored.version);
      const sameGen = hasLocal && genOf(this.doc) === storedGen;
      if (hasLocal && !sameGen) {
        // Another generation: the copy goes; what was typed offline comes on top as a change.
        if (localDirty && carry === null) carry = { base: localBase, mine: contentOf(this.doc, this.kind) };
        await local?.clear().catch(() => undefined);
        this.doc.destroy();
        this.awareness.destroy();
        this.doc = new Y.Doc();
        this.awareness = new Awareness(this.doc);
        local = io.openLocal(this.doc);
        try {
          await local.ready;
        } catch {
          local = null;
        }
        localDirty = false;
      }
      if (!stored.state || !this.adopt(stored.state, ORIGIN_SERVER)) {
        // No state yet, or one that does not read: built from the stored content.
        this.adopt(seedState(this.kind, stored.content, fallbackGen(stored.version)), ORIGIN_SEED);
      }
      version = stored.version;
      this.storedSV = Y.encodeStateVector(this.doc);
      this.base = sameGen && localDirty ? localBase : contentOf(this.doc, this.kind);

      if (carry === null && !localDirty && this.canWrite && stored.state) {
        const compacted = await this.maybeCompact(stored, local);
        if (compacted) {
          version = compacted.version;
          local = compacted.local;
        }
      }
    }
    if (this.closed) return;
    this.local = local;
    if (this.base !== null && !localDirty) void local?.set("base", JSON.stringify(this.base)).catch(() => undefined);

    this.doc.on("update", this.onUpdate);
    this.awareness.setLocalStateField("user", {
      name: this.options.me.name,
      color: `var(--color-${this.options.me.color})`,
      userId: this.options.me.userId,
    });

    this.persister = new CollabPersister(
      {
        encodeState: () => Y.encodeStateAsUpdate(this.doc),
        draft: () => this.draft(),
        absorb: (state, kind) => this.absorb(state, kind),
      },
      {
        save: (input) => io.save(input),
        isOnline: () => io.isOnline(),
        onSaved: (savedVersion, saved) => {
          this.storedSV = Y.encodeStateVector(this.doc);
          this.setBase(saved.content);
          void this.local?.set("version", savedVersion).catch(() => undefined);
          if (!this.persister?.hasLocalUnsaved()) void this.local?.set("dirty", 0).catch(() => undefined);
          this.provider?.announceSaved(savedVersion, this.provider.lastSentSeq);
        },
        onReplaced: () => this.restart(this.carryNow()),
        onGone: () => {
          void this.local?.clear().catch(() => undefined);
          this.local = null;
          this.emit({ phase: "gone", writable: false });
        },
        onTooLarge: () => this.recompute(),
        onStatus: (status) => this.emit({ save: status }),
        onMerged: () => io.track?.("merged", { from: "save" }),
      },
      {
        version,
        saveDelayMs: this.options.timings?.saveDelayMs,
        remoteSaveDelayMs: this.options.timings?.remoteSaveDelayMs,
        retryDelaysMs: this.options.timings?.retryDelaysMs,
      },
    );
    if (localDirty) this.persister.localChange(this.options.me.userId);

    this.provider = new CollabProvider({
      doc: this.doc,
      awareness: this.awareness,
      transport: io.transport(this.sid),
      sid: this.sid,
      userId: this.options.me.userId,
      canSend: () => this.snapshot.writable,
      gen: () => genOf(this.doc) ?? "",
      batchMs: this.options.timings?.batchMs,
      hooks: {
        remoteChange: (sid, seq, from, persisted) => {
          this.typingAt.set(from, this.now());
          this.tickTyping();
          if (!persisted) this.persister?.remoteChange(sid, seq, from);
        },
        peerSaved: (sid, upTo) => this.persister?.peerSaved(sid, upTo),
        otherGeneration: () => {
          if (this.now() - this.lastPull > 5_000) void this.pull();
        },
        peers: (list) => {
          this.peers = list;
          this.recompute();
        },
        status: (status) => {
          this.emit({ connection: status });
          if (status !== "connected") return;
          this.persister?.online();
          if (this.compacted) {
            this.compacted = false;
            this.provider?.announceReset();
          }
        },
        storedStateVector: () => this.storedSV,
      },
    });
    this.recompute();
    this.trackPresence();

    if (carry !== null && this.canWrite) {
      // Unsaved work from before: its own changes, as an ordinary change on top of the stored note.
      const merged = carryOver(this.kind, carry.base, carry.mine, contentOf(this.doc, this.kind));
      applyContent(this.doc, this.kind, merged, ORIGIN_LOCAL);
      io.track?.("merged", { from: "reopen" });
    }
    this.emit({
      phase: "ready",
      generation: this.snapshot.generation + 1,
      save: this.persister.status,
    });
    io.track?.("opened", { writer: this.canWrite, others: this.snapshot.people.length });
  }

  /**
   * A grown state is rebuilt from its content (a new generation) before the
   * editor shows it. Whoever still has the older one open reloads it.
   */
  private async maybeCompact(
    stored: StoredNote,
    local: LocalReplica | null,
  ): Promise<{ version: number; local: LocalReplica | null } | null> {
    const size = stored.state?.byteLength ?? 0;
    if (size < COLLAB.compactMinBytes || !this.options.io.isOnline()) return null;
    const content = contentOf(this.doc, this.kind);
    const gen = `c:${crypto.randomUUID()}`;
    const fresh = seedState(this.kind, content, gen);
    if (size < fresh.byteLength * COLLAB.compactRatio) return null;
    let result: CollabSaveResult;
    try {
      result = await this.options.io.save({
        base: stored.version,
        state: fresh,
        draft: draftOf(this.doc, this.kind, this.options.textOptions?.()),
        authors: [],
      });
    } catch {
      return null;
    }
    if (result.status !== "saved" || this.closed) return null;
    await local?.clear().catch(() => undefined);
    this.doc.destroy();
    this.awareness.destroy();
    this.doc = new Y.Doc();
    this.awareness = new Awareness(this.doc);
    let replica: LocalReplica | null = this.options.io.openLocal(this.doc);
    try {
      await replica.ready;
    } catch {
      replica = null;
    }
    this.adopt(fresh, ORIGIN_SEED);
    this.storedSV = Y.encodeStateVector(this.doc);
    this.compacted = true;
    return { version: result.version, local: replica };
  }

  /** Set when this open rebuilt the note: the others hear it once the channel is up. */
  private compacted = false;

  /** Whether the state could be read into the document. */
  private adopt(state: Uint8Array, origin: unknown): boolean {
    try {
      Y.applyUpdate(this.doc, state, origin);
      return true;
    } catch {
      return false;
    }
  }

  private absorb(state: Uint8Array | null, kind: string): "merged" | "replaced" {
    if (!state || kind !== this.kind || genOfState(state) !== genOf(this.doc)) return "replaced";
    if (!this.adopt(state, ORIGIN_SERVER)) return "replaced";
    this.storedSV = Y.encodeStateVector(this.doc);
    return "merged";
  }

  private onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === ORIGIN_REMOTE || origin === ORIGIN_SERVER || origin === ORIGIN_SEED) return;
    if (this.local && origin === this.local.origin) return;
    if (!this.snapshot.writable) return;
    this.authoredHere = true;
    this.persister?.localChange(this.options.me.userId);
    if (!this.dirtyMark) {
      this.dirtyMark = setTimeout(() => {
        this.dirtyMark = null;
        if (this.persister?.hasLocalUnsaved()) void this.local?.set("dirty", 1).catch(() => undefined);
      }, 300);
    }
    if (this.persister?.status === "tooLarge") this.recompute();
  };

  private trackPresence() {
    this.provider?.track({
      sid: this.sid,
      userId: this.options.me.userId,
      name: this.options.me.name,
      avatarUrl: this.options.me.avatarUrl,
      color: this.options.me.color,
      writer: this.canWrite,
      clientId: this.doc.clientID,
      joinedAt: this.joinedAt,
    });
  }

  /** Who is here, whether this tab may write, the limits. */
  private recompute() {
    const mine = this.options.me.userId;
    const byUser = new Map<string, Person>();
    for (const peer of this.peers) {
      if (peer.sid === this.sid || peer.userId === mine) continue;
      const known = byUser.get(peer.userId);
      byUser.set(peer.userId, {
        userId: peer.userId,
        name: peer.name,
        avatarUrl: peer.avatarUrl,
        color: peer.color,
        writer: (known?.writer ?? false) || peer.writer,
      });
    }
    // The first ten people writing (by when they came) may write; later ones read.
    const writers = [...this.peers, ...(this.canWrite && !this.peers.some((p) => p.sid === this.sid) ? [{ sid: this.sid, userId: mine, joinedAt: this.joinedAt, writer: true } as PeerMeta] : [])]
      .filter((peer) => peer.writer)
      .sort((a, b) => a.joinedAt - b.joinedAt || (a.sid < b.sid ? -1 : 1));
    const order: string[] = [];
    for (const peer of writers) if (!order.includes(peer.userId)) order.push(peer.userId);
    const overPeople = this.canWrite && order.indexOf(mine) >= COLLAB.maxPeople;
    const tooLarge = this.persister?.status === "tooLarge";
    const limit = overPeople ? "people" : tooLarge ? "size" : null;
    const writable = this.canWrite && !overPeople && !tooLarge && this.snapshot.phase !== "gone";
    if (limit && limit !== this.snapshot.limit) {
      this.options.io.track?.("limited", { reason: limit });
    }
    const wasWritable = this.snapshot.writable;
    this.emit({ people: [...byUser.values()], writable, limit, typing: this.typingNames(byUser) });
    if (writable && !wasWritable && this.snapshot.phase === "ready") this.provider?.resume();
  }

  private typingNames(byUser: Map<string, Person>): string[] {
    const now = this.now();
    const names: string[] = [];
    for (const [userId, at] of this.typingAt) {
      if (now - at > COLLAB.typingMs) {
        this.typingAt.delete(userId);
        continue;
      }
      const name = byUser.get(userId)?.name;
      if (name) names.push(name);
    }
    return names;
  }

  private tickTyping() {
    const people = new Map(this.snapshot.people.map((person) => [person.userId, person]));
    const typing = this.typingNames(people);
    if (typing.join("|") !== this.snapshot.typing.join("|")) this.emit({ typing });
    if (this.typingTimer || typing.length === 0) return;
    this.typingTimer = setInterval(() => {
      const names = this.typingNames(new Map(this.snapshot.people.map((person) => [person.userId, person])));
      if (names.join("|") !== this.snapshot.typing.join("|")) this.emit({ typing: names });
      if (names.length === 0 && this.typingTimer) {
        clearInterval(this.typingTimer);
        this.typingTimer = null;
      }
    }, 1_000);
  }
}
