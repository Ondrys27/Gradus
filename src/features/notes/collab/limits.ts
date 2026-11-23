/**
 * Live writing of notes (28.4): the numbers in one place. The database checks
 * the size of the state too (notes_ydoc_size, 2 MB).
 */
export const COLLAB = {
  /** People writing one note at once; whoever comes later reads until a place frees up. */
  maxPeople: 10,
  /** Local changes are sent together after this pause. */
  batchMs: 50,
  /** A note is saved this long after the last own change… */
  saveDelayMs: 2_000,
  /** …but no later than this during long typing. */
  saveMaxWaitMs: 10_000,
  /** Changes that came from others are saved by them; only if they never are, by us. */
  remoteSaveDelayMs: 8_000,
  retryDelaysMs: [2_000, 5_000, 10_000, 30_000] as readonly number[],
  /** The largest Yjs state a browser saves (the database allows 2 MB). */
  docBytes: 1_500_000,
  /** A stored state this big and much bigger than its text alone is rebuilt on open. */
  compactMinBytes: 64_000,
  compactRatio: 3,
  /** Realtime messages stay below its payload limit; bigger ones go in parts. */
  chunkChars: 180_000,
  /** "Píše Váša…" while the last change is at most this old. */
  typingMs: 3_000,
  /** Cursor moves are sent at most this often. */
  awarenessThrottleMs: 100,
  /** A closed note keeps its session this long (Strict Mode, a quick return). */
  releaseGraceMs: 3_000,
} as const;

/** The Yjs names inside a note's document. */
export const Y_TEXT = "default";
export const Y_MAP = "map";
export const Y_NODES = "nodes";
export const Y_META = "meta";

/** Who made a change of the document (Yjs transaction origins). */
export const ORIGIN_REMOTE = "gradus:remote";
export const ORIGIN_SERVER = "gradus:server";
export const ORIGIN_SEED = "gradus:seed";
export const ORIGIN_LOCAL = "gradus:local";
