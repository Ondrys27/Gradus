/**
 * The live provider of a note (28.4): Yjs changes and cursors between the
 * browsers that have the note open, over a transport (Supabase Realtime in
 * the app, an in-memory hub in the tests). No server of our own.
 *
 * - Own changes are sent together every ~50 ms, numbered.
 * - On joining (and every rejoin after a lost connection) a writer says hello
 *   with its state vector; every other writer answers with what it lacks and
 *   its own state vector, and the joiner sends back what they lack: changes
 *   made offline arrive this way.
 * - A reader never sends anything; a writer answers a newly present reader
 *   with what is not in the database yet.
 * - Cursors and names go as y-protocols awareness, at most every 100 ms.
 */
import * as Y from "yjs";
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
  type Awareness,
} from "y-protocols/awareness";
import { fromBase64, toBase64 } from "./encoding";
import { COLLAB, ORIGIN_REMOTE, ORIGIN_SEED, ORIGIN_SERVER } from "./limits";
import { toWire, WireAssembler, type CollabMessage, type Envelope, type Wire } from "./protocol";

export type CollabColor = "violet" | "teal" | "gold" | "green" | "orange" | "pink";

/** Who has the note open in one tab (Realtime presence). */
export type PeerMeta = {
  sid: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  color: CollabColor;
  writer: boolean;
  clientId: number;
  joinedAt: number;
};

export type TransportStatus = "connecting" | "connected" | "offline";

export type TransportHandlers = {
  message(payload: unknown): void;
  status(status: TransportStatus): void;
  peers(list: PeerMeta[]): void;
};

export interface CollabTransport {
  start(handlers: TransportHandlers): void;
  send(payload: Wire): void;
  track(meta: PeerMeta): void;
  stop(): void;
}

export type ProviderHooks = {
  /** A change of someone else got into the document. */
  remoteChange?(sid: string, seq: number | null, from: string, persisted: boolean): void;
  peerSaved?(sid: string, upTo: number): void;
  /** Someone works on another generation of the note. */
  otherGeneration?(gen: string, kind: CollabMessage["t"]): void;
  peers?(list: PeerMeta[]): void;
  status?(status: TransportStatus): void;
  /** What a newly present reader may lack: the state vector of the last state known to be stored. */
  storedStateVector?(): Uint8Array | null;
};

type Options = {
  doc: Y.Doc;
  awareness: Awareness;
  transport: CollabTransport;
  sid: string;
  userId: string;
  /** May this tab send (a writer within the limit, not read-only)? */
  canSend: () => boolean;
  gen: () => string;
  hooks?: ProviderHooks;
  batchMs?: number;
  awarenessMs?: number;
};

const EMPTY_UPDATE_BYTES = 2;

export class CollabProvider {
  readonly awareness: Awareness;
  status: TransportStatus = "connecting";
  peers: PeerMeta[] = [];

  private readonly doc: Y.Doc;
  private readonly transport: CollabTransport;
  private readonly assembler = new WireAssembler();
  private queued: Uint8Array[] = [];
  private queuedStored: Uint8Array[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private awarenessTimer: ReturnType<typeof setTimeout> | null = null;
  private awarenessChanged = false;
  private seq = 0;
  private sentSeq = 0;
  private applying: { sid: string; seq: number | null; from: string; persisted: boolean } | null = null;
  private knownPeers = new Set<string>();
  private meta: PeerMeta | null = null;
  private destroyed = false;

  constructor(private readonly options: Options) {
    this.doc = options.doc;
    this.awareness = options.awareness;
    this.transport = options.transport;
    this.doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);
    this.transport.start({
      message: (payload) => this.receive(payload),
      status: (status) => this.onStatus(status),
      peers: (list) => this.onPeers(list),
    });
  }

  /** The number of our last change already sent (what a save of now covers). */
  get lastSentSeq(): number {
    return this.sentSeq;
  }

  /** Shows this tab to the others (presence). */
  track(meta: PeerMeta) {
    this.meta = meta;
    this.transport.track(meta);
  }

  /** Our changes and cursor reach the others again (after the limit freed up, or rights came back). */
  resume() {
    if (this.status === "connected") this.greet();
  }

  /** Tells the others the database has the note at `version` with our changes up to `upTo`. */
  announceSaved(version: number, upTo: number) {
    this.post({ t: "saved", gen: this.options.gen(), v: version, upTo });
  }

  announceReset() {
    this.post({ t: "reset", gen: this.options.gen() });
  }

  /** Sends what is queued right away (before saving, so the numbers line up). */
  flushQueue() {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = null;
    this.sendQueued();
  }

  destroy() {
    if (this.destroyed) return;
    this.flushQueue();
    if (this.options.canSend() && this.status === "connected") {
      removeAwarenessStates(this.awareness, [this.doc.clientID], "local");
      this.sendAwareness();
    }
    this.destroyed = true;
    if (this.awarenessTimer) clearTimeout(this.awarenessTimer);
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    this.transport.stop();
  }

  // -------------------------------------------------------------------------

  private post(m: CollabMessage) {
    if (this.destroyed || this.status !== "connected" || !this.options.canSend()) return false;
    const envelope: Envelope = { from: this.options.userId, sid: this.options.sid, m };
    for (const wire of toWire(envelope)) this.transport.send(wire);
    return true;
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === ORIGIN_REMOTE) {
      const applying = this.applying;
      if (applying) this.options.hooks?.remoteChange?.(applying.sid, applying.seq, applying.from, applying.persisted);
      return;
    }
    if (!this.options.canSend()) return;
    if (origin === ORIGIN_SERVER || origin === ORIGIN_SEED) this.queuedStored.push(update);
    else this.queued.push(update);
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null;
        this.sendQueued();
      }, this.options.batchMs ?? COLLAB.batchMs);
    }
  };

  private sendQueued() {
    if (this.status !== "connected" || !this.options.canSend()) {
      // The hello after the next join brings everything; nothing to keep.
      this.queued = [];
      this.queuedStored = [];
      return;
    }
    const gen = this.options.gen();
    if (this.queuedStored.length) {
      const d = toBase64(Y.mergeUpdates(this.queuedStored));
      this.queuedStored = [];
      this.post({ t: "update", gen, d, p: 1 });
    }
    if (this.queued.length) {
      const d = toBase64(Y.mergeUpdates(this.queued));
      this.queued = [];
      this.seq += 1;
      if (this.post({ t: "update", gen, d, q: this.seq })) this.sentSeq = this.seq;
    }
  }

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === "remote") return;
    const mine = [...added, ...updated, ...removed].includes(this.doc.clientID);
    if (!mine) return;
    this.awarenessChanged = true;
    if (this.awarenessTimer) return;
    this.awarenessTimer = setTimeout(() => {
      this.awarenessTimer = null;
      if (this.awarenessChanged) this.sendAwareness();
    }, this.options.awarenessMs ?? COLLAB.awarenessThrottleMs);
  };

  private sendAwareness() {
    this.awarenessChanged = false;
    const update = encodeAwarenessUpdate(this.awareness, [this.doc.clientID]);
    this.post({ t: "awareness", d: toBase64(update) });
  }

  private onStatus(status: TransportStatus) {
    this.status = status;
    this.options.hooks?.status?.(status);
    if (status === "connected") {
      if (this.meta) this.transport.track(this.meta);
      this.greet();
    }
  }

  private greet() {
    if (!this.options.canSend()) return;
    this.flushQueue();
    this.post({ t: "hello", gen: this.options.gen(), sv: toBase64(Y.encodeStateVector(this.doc)) });
    this.sendAwareness();
  }

  private onPeers(list: PeerMeta[]) {
    const others = list.filter((peer) => peer.sid !== this.options.sid);
    const present = new Set(others.map((peer) => peer.sid));
    // Cursors of the ones who left go away at once.
    const gone = this.peers.filter((peer) => !present.has(peer.sid)).map((peer) => peer.clientId);
    if (gone.length) removeAwarenessStates(this.awareness, gone, "remote");
    for (const peer of others) {
      if (this.knownPeers.has(peer.sid)) continue;
      this.knownPeers.add(peer.sid);
      // A reader can not say hello: it gets what is not stored yet.
      if (!peer.writer) this.answer(peer.sid, this.options.hooks?.storedStateVector?.() ?? null);
    }
    for (const sid of [...this.knownPeers]) if (!present.has(sid)) this.knownPeers.delete(sid);
    this.peers = list;
    this.options.hooks?.peers?.(list);
  }

  /** Sends `to` what it lacks against `sv` (everything when unknown), with our state vector. */
  private answer(to: string, sv: Uint8Array | null) {
    if (!this.options.canSend()) return;
    const diff = sv ? Y.encodeStateAsUpdate(this.doc, sv) : Y.encodeStateAsUpdate(this.doc);
    this.post({
      t: "sync",
      gen: this.options.gen(),
      to,
      d: toBase64(diff),
      sv: toBase64(Y.encodeStateVector(this.doc)),
    });
  }

  private apply(update: Uint8Array, source: NonNullable<CollabProvider["applying"]>) {
    this.applying = source;
    try {
      Y.applyUpdate(this.doc, update, ORIGIN_REMOTE);
    } catch {
      // A broken message changes nothing.
    } finally {
      this.applying = null;
    }
  }

  private receive(payload: unknown) {
    if (this.destroyed) return;
    const envelope = this.assembler.take(payload);
    if (!envelope || envelope.sid === this.options.sid) return;
    const { m } = envelope;
    if (m.t === "awareness") {
      try {
        applyAwarenessUpdate(this.awareness, fromBase64(m.d), "remote");
      } catch {
        // Ignore a broken cursor.
      }
      return;
    }
    if (m.gen !== this.options.gen()) {
      this.options.hooks?.otherGeneration?.(m.gen, m.t);
      return;
    }
    switch (m.t) {
      case "update":
        this.apply(fromBase64(m.d), {
          sid: envelope.sid,
          seq: m.p ? null : (m.q ?? null),
          from: envelope.from,
          persisted: m.p === 1,
        });
        return;
      case "hello":
        this.answer(envelope.sid, fromBase64(m.sv));
        return;
      case "sync": {
        this.apply(fromBase64(m.d), { sid: envelope.sid, seq: null, from: envelope.from, persisted: false });
        if (m.to !== this.options.sid || !this.options.canSend()) return;
        // Whatever the one who answered lacks (our changes made offline) goes back.
        const back = Y.encodeStateAsUpdate(this.doc, fromBase64(m.sv));
        if (back.byteLength > EMPTY_UPDATE_BYTES) {
          this.seq += 1;
          if (this.post({ t: "update", gen: m.gen, d: toBase64(back), q: this.seq })) this.sentSeq = this.seq;
        }
        return;
      }
      case "saved":
        this.options.hooks?.peerSaved?.(envelope.sid, m.upTo);
        return;
      case "reset":
        // The note was replaced in the same generation (converted, written outside): read it again.
        this.options.hooks?.otherGeneration?.(m.gen, m.t);
        return;
    }
  }
}
