/**
 * Autosave of notes, independent of what is on screen. Every edit is kept per
 * note: it is sent ~600 ms after the last keystroke, at most one request per
 * note is in flight and a newer edit always follows the older one, so a slow
 * answer can never overwrite newer text. Switching to another note does not
 * cancel anything; the previous note finishes saving on its own.
 *
 * Unsent edits are mirrored to a backup (localStorage in the app), so a lost
 * connection, a closed tab or a crash loses nothing: the next load sends them.
 * A failed save is retried with growing pauses and at once when the browser
 * is back online.
 */
import { fitsLimits, type NoteDraft } from "./document";

export type SaveStatus = "saved" | "pending" | "saving" | "error" | "offline" | "tooLarge";

export type BackupEntry = { draft: NoteDraft; editedAt: number };
export type DraftBackup = {
  read(): Record<string, BackupEntry>;
  write(entries: Record<string, BackupEntry>): void;
};

type Options = {
  save: (id: string, draft: NoteDraft) => Promise<void>;
  delay?: number;
  retryDelays?: readonly number[];
  backup?: DraftBackup;
  isOnline?: () => boolean;
  now?: () => number;
};

type Entry = {
  draft: NoteDraft;
  editedAt: number;
  version: number;
  savedVersion: number;
  status: SaveStatus;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<void> | null;
  again: boolean;
  attempt: number;
};

export const SAVE_DELAY_MS = 600;
export const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000] as const;

export class NoteSaver {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private snapshot = 0;
  private readonly delay: number;
  private readonly retryDelays: readonly number[];
  private readonly isOnline: () => boolean;
  private readonly now: () => number;

  constructor(private readonly options: Options) {
    this.delay = options.delay ?? SAVE_DELAY_MS;
    this.retryDelays = options.retryDelays ?? RETRY_DELAYS_MS;
    this.isOnline = options.isOnline ?? (() => true);
    this.now = options.now ?? Date.now;
  }

  /** A new state of a note's text; saved after the pause unless another edit comes. */
  edit(id: string, draft: NoteDraft, editedAt = this.now()): void {
    const entry = this.entries.get(id) ?? {
      draft,
      editedAt,
      version: 0,
      savedVersion: 0,
      status: "saved" as SaveStatus,
      timer: null,
      inFlight: null,
      again: false,
      attempt: 0,
    };
    entry.draft = draft;
    entry.editedAt = editedAt;
    entry.version += 1;
    entry.attempt = 0;
    if (entry.status !== "saving") entry.status = "pending";
    this.entries.set(id, entry);
    this.schedule(id, entry, this.delay);
    this.emit();
  }

  /** Sends the note's unsaved text now and resolves once it is saved or has failed. */
  async flush(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    let sent = false;
    // A request already running finishes first; then the newest text goes once.
    for (let round = 0; round < 4; round++) {
      if (entry.inFlight) {
        await entry.inFlight;
        continue;
      }
      if (sent || entry.version === entry.savedVersion) return;
      sent = true;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
      this.run(id);
      if (!entry.inFlight) return;
    }
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.flush(id)));
  }

  /** Forgets unsaved text of a note that is going away (a blank note being removed). */
  discard(id: string): void {
    const entry = this.entries.get(id);
    if (entry?.timer) clearTimeout(entry.timer);
    this.entries.delete(id);
    this.writeBackup();
    this.emit();
  }

  /** Every failed or offline note is tried again now (the browser is back online). */
  retryNow(): void {
    for (const [id, entry] of this.entries) {
      if (entry.version !== entry.savedVersion && !entry.inFlight) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = null;
        this.run(id);
      }
    }
  }

  /** The text not yet confirmed by the server, or null when everything is saved. */
  unsavedDraft(id: string): NoteDraft | null {
    const entry = this.entries.get(id);
    return entry && entry.version !== entry.savedVersion ? entry.draft : null;
  }

  /** The latest text known for the note, saved or not. */
  latestDraft(id: string): NoteDraft | null {
    return this.entries.get(id)?.draft ?? null;
  }

  statusOf(id: string): SaveStatus | null {
    return this.entries.get(id)?.status ?? null;
  }

  hasUnsaved(): boolean {
    for (const entry of this.entries.values()) {
      if (entry.version !== entry.savedVersion) return true;
    }
    return false;
  }

  /** Unsaved edits left from an earlier visit, to send again. */
  readBackup(): Record<string, BackupEntry> {
    try {
      return this.options.backup?.read() ?? {};
    } catch {
      return {};
    }
  }

  /** Writes what is not saved yet to the backup now (the page is being hidden). */
  writeBackup(): void {
    if (!this.options.backup) return;
    const unsaved: Record<string, BackupEntry> = {};
    for (const [id, entry] of this.entries) {
      if (entry.version !== entry.savedVersion) {
        unsaved[id] = { draft: entry.draft, editedAt: entry.editedAt };
      }
    }
    try {
      this.options.backup.write(unsaved);
    } catch {
      // Storage full or blocked: the save itself still runs.
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Changes with every status change, for useSyncExternalStore. */
  getSnapshot = (): number => this.snapshot;

  dispose(): void {
    for (const entry of this.entries.values()) if (entry.timer) clearTimeout(entry.timer);
    this.listeners.clear();
  }

  private emit() {
    this.snapshot += 1;
    for (const listener of this.listeners) listener();
  }

  private schedule(id: string, entry: Entry, ms: number) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      this.run(id);
    }, ms);
  }

  private run(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.inFlight) {
      entry.again = true;
      return;
    }
    if (entry.version === entry.savedVersion) {
      entry.status = "saved";
      this.emit();
      return;
    }
    this.writeBackup();
    if (!fitsLimits(entry.draft)) {
      entry.status = "tooLarge";
      this.emit();
      return;
    }
    if (!this.isOnline()) {
      entry.status = "offline";
      this.emit();
      return;
    }

    const version = entry.version;
    entry.status = "saving";
    this.emit();
    entry.inFlight = this.options
      .save(id, entry.draft)
      .then(
        () => {
          entry.savedVersion = Math.max(entry.savedVersion, version);
          entry.attempt = 0;
          if (entry.savedVersion === entry.version) {
            entry.status = "saved";
            this.writeBackup();
          } else {
            entry.status = "pending";
          }
        },
        () => {
          entry.status = this.isOnline() ? "error" : "offline";
          const wait = this.retryDelays[Math.min(entry.attempt, this.retryDelays.length - 1)];
          entry.attempt += 1;
          if (!entry.timer) this.schedule(id, entry, wait);
        },
      )
      .finally(() => {
        entry.inFlight = null;
        if (entry.again) {
          entry.again = false;
          this.run(id);
        }
        this.emit();
      });
  }
}
