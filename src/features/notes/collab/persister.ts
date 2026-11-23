/**
 * Saving a live note (28.4). Whoever has the note open saves it: about 2 s
 * after their last change (at most 10 s into long typing), with the version
 * lock. The database takes the state only from the version it was built on;
 * when someone saved in between, it answers with the stored state, which is
 * merged (Yjs) and saved again, so a newer state is never overwritten.
 *
 * Changes that came from others are saved by their authors. A browser keeps
 * them as unsaved until the author says they are in the database (a `saved`
 * message naming the last change it covered) and saves them itself only when
 * that never comes (the author lost the connection).
 *
 * Without a connection the changes stay in the browser (IndexedDB, see the
 * session) and the save runs when it is back.
 */
import { fitsLimits, type NoteDraft } from "../document";
import type { SaveStatus } from "../note-saver";
import { COLLAB } from "./limits";

export type CollabSaveResult =
  | { status: "saved"; version: number }
  | { status: "conflict"; version: number; state: Uint8Array | null; kind: string }
  | { status: "missing" }
  | { status: "deleted" }
  | { status: "denied" }
  | { status: "tooLarge" };

/** The document side of saving, given by the session. */
export interface CollabStore {
  encodeState(): Uint8Array;
  draft(): NoteDraft;
  /**
   * The database holds a newer state. "merged": the document now contains it;
   * "replaced": it is another generation or kind (or none at all), the note
   * has to be opened again.
   */
  absorb(state: Uint8Array | null, kind: string): "merged" | "replaced";
}

export type PersisterIO = {
  save(input: { base: number; state: Uint8Array; draft: NoteDraft; authors: string[] }): Promise<CollabSaveResult>;
  isOnline(): boolean;
  /** After a save (with what was saved): tell the others which of our changes it covered. */
  onSaved?(version: number, saved: NoteDraft): void;
  onReplaced?(): void;
  /** The note is gone for us (trash, access removed): nothing is kept for later. */
  onGone?(why: "deleted" | "denied"): void;
  onTooLarge?(): void;
  onStatus?(status: SaveStatus): void;
  /** Merges after a conflict, for analytics. */
  onMerged?(): void;
};

type Options = {
  version: number;
  saveDelayMs?: number;
  saveMaxWaitMs?: number;
  remoteSaveDelayMs?: number;
  retryDelaysMs?: readonly number[];
  maxBytes?: number;
  now?: () => number;
};

export class CollabPersister {
  /** The database version our document contains. */
  version: number;
  status: SaveStatus = "saved";

  private localChanges = 0;
  private savedLocalChanges = 0;
  private firstUnsavedAt: number | null = null;
  /** Changes of others not known to be in the database: sid → their last change number. */
  private remote = new Map<string, number>();
  /** Changes of others with no number (relayed when someone joined). */
  private untracked = 0;
  private authors = new Set<string>();

  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = 0;
  private inFlight: Promise<void> | null = null;
  private again = false;
  private attempt = 0;
  private stopped = false;
  private blockedTooLarge = false;

  private readonly saveDelay: number;
  private readonly maxWait: number;
  private readonly remoteDelay: number;
  private readonly retryDelays: readonly number[];
  private readonly maxBytes: number;
  private readonly now: () => number;

  constructor(
    private readonly store: CollabStore,
    private readonly io: PersisterIO,
    options: Options,
  ) {
    this.version = options.version;
    this.saveDelay = options.saveDelayMs ?? COLLAB.saveDelayMs;
    this.maxWait = options.saveMaxWaitMs ?? COLLAB.saveMaxWaitMs;
    this.remoteDelay = options.remoteSaveDelayMs ?? COLLAB.remoteSaveDelayMs;
    this.retryDelays = options.retryDelaysMs ?? COLLAB.retryDelaysMs;
    this.maxBytes = options.maxBytes ?? COLLAB.docBytes;
    this.now = options.now ?? Date.now;
  }

  /** Something was changed here, by `author`. */
  localChange(author: string) {
    if (this.stopped) return;
    this.localChanges += 1;
    this.authors.add(author);
    this.blockedTooLarge = false;
    const now = this.now();
    this.firstUnsavedAt ??= now;
    const due = Math.min(now + this.saveDelay, this.firstUnsavedAt + this.maxWait);
    this.schedule(due - now, true);
    this.setStatus(this.inFlight ? "saving" : "pending");
  }

  /** A change came from someone else (sid, their change number when it has one). */
  remoteChange(sid: string, seq: number | null, author: string | null) {
    if (this.stopped) return;
    if (seq === null) this.untracked += 1;
    else this.remote.set(sid, Math.max(this.remote.get(sid) ?? -1, seq));
    if (author) this.authors.add(author);
    if (this.status === "saved") this.setStatus("pending");
    this.schedule(this.remoteDelay, false);
  }

  /** Someone saved the note with their changes up to `upTo` in it. */
  peerSaved(sid: string, upTo: number) {
    const pending = this.remote.get(sid);
    if (pending !== undefined && pending <= upTo) this.remote.delete(sid);
    if (!this.dirty() && !this.inFlight) {
      this.clearTimer();
      this.setStatus("saved");
    }
  }

  dirty(): boolean {
    return this.localChanges !== this.savedLocalChanges || this.remote.size > 0 || this.untracked > 0;
  }

  hasLocalUnsaved(): boolean {
    return this.localChanges !== this.savedLocalChanges;
  }

  /** The connection is back: save what waits. */
  online() {
    if (this.stopped || !this.dirty()) return;
    this.attempt = 0;
    this.clearTimer();
    this.run();
  }

  /** Saves now and resolves when it is saved or has failed. */
  async flush(): Promise<void> {
    // A save already running finishes first; then the newest state goes once.
    for (let i = 0; i < 3 && this.inFlight; i++) await this.inFlight;
    if (this.inFlight || this.stopped || !this.dirty() || this.blockedTooLarge || !this.io.isOnline()) return;
    this.clearTimer();
    this.run();
    for (let i = 0; i < 3 && this.inFlight; i++) await this.inFlight;
  }

  stop() {
    this.stopped = true;
    this.clearTimer();
  }

  dispose() {
    this.stop();
  }

  private setStatus(status: SaveStatus) {
    if (this.status === status) return;
    this.status = status;
    this.io.onStatus?.(status);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerAt = 0;
  }

  /** `replace`: a newer own change moves the save (debounce); otherwise only an earlier one wins. */
  private schedule(ms: number, replace: boolean) {
    const at = this.now() + Math.max(0, ms);
    if (this.timer && !replace && this.timerAt <= at) return;
    this.clearTimer();
    this.timerAt = at;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.timerAt = 0;
        this.run();
      },
      Math.max(0, ms),
    );
  }

  private run() {
    if (this.stopped) return;
    if (this.inFlight) {
      this.again = true;
      return;
    }
    if (!this.dirty()) {
      this.setStatus("saved");
      return;
    }
    if (!this.io.isOnline()) {
      this.setStatus("offline");
      return;
    }
    const state = this.store.encodeState();
    const draft = this.store.draft();
    if (state.byteLength > this.maxBytes || !fitsLimits(draft)) {
      this.blockedTooLarge = true;
      this.setStatus("tooLarge");
      this.io.onTooLarge?.();
      return;
    }
    const localAt = this.localChanges;
    const remoteAt = new Map(this.remote);
    const untrackedAt = this.untracked;
    const authors = [...this.authors];
    this.setStatus("saving");

    this.inFlight = (async () => {
      let conflicts = 0;
      let base = this.version;
      let payload = { state, draft };
      for (;;) {
        let result: CollabSaveResult;
        try {
          result = await this.io.save({ base, state: payload.state, draft: payload.draft, authors });
        } catch {
          this.failed();
          return;
        }
        if (result.status === "saved") {
          this.version = result.version;
          this.savedLocalChanges = Math.max(this.savedLocalChanges, localAt);
          if (this.savedLocalChanges === this.localChanges) this.firstUnsavedAt = null;
          for (const [sid, seq] of remoteAt) {
            if ((this.remote.get(sid) ?? -1) <= seq) this.remote.delete(sid);
          }
          this.untracked = Math.max(0, this.untracked - untrackedAt);
          for (const author of authors) this.authors.delete(author);
          this.attempt = 0;
          this.io.onSaved?.(result.version, payload.draft);
          this.setStatus(this.dirty() ? "pending" : "saved");
          if (this.dirty()) {
            this.schedule(
              this.localChanges !== this.savedLocalChanges ? this.saveDelay : this.remoteDelay,
              false,
            );
          }
          return;
        }
        if (result.status === "conflict") {
          const outcome = this.store.absorb(result.state, result.kind);
          if (outcome === "replaced") {
            this.stop();
            this.io.onReplaced?.();
            return;
          }
          this.io.onMerged?.();
          this.version = result.version;
          base = result.version;
          conflicts += 1;
          if (conflicts > 5) {
            this.failed();
            return;
          }
          // The merged document, saved again on the version it now contains.
          payload = { state: this.store.encodeState(), draft: this.store.draft() };
          if (payload.state.byteLength > this.maxBytes || !fitsLimits(payload.draft)) {
            this.blockedTooLarge = true;
            this.setStatus("tooLarge");
            this.io.onTooLarge?.();
            return;
          }
          continue;
        }
        if (result.status === "deleted" || result.status === "denied") {
          this.stop();
          this.setStatus("denied");
          this.io.onGone?.(result.status);
          return;
        }
        if (result.status === "tooLarge") {
          this.blockedTooLarge = true;
          this.setStatus("tooLarge");
          this.io.onTooLarge?.();
          return;
        }
        // missing: a note made here is not in the database yet; its autosave inserts it.
        this.failed("pending");
        return;
      }
    })().finally(() => {
      this.inFlight = null;
      if (this.again) {
        this.again = false;
        this.run();
      }
    });
  }

  private failed(status: SaveStatus = this.io.isOnline() ? "error" : "offline") {
    this.setStatus(status);
    if (status === "offline") return;
    const wait = this.retryDelays[Math.min(this.attempt, this.retryDelays.length - 1)];
    this.attempt += 1;
    this.schedule(wait, false);
  }
}
