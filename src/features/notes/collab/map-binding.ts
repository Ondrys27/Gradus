/**
 * The map editor's view of a live map note: the tree as it is now (own and
 * others' changes), changes written into the shared document, and Undo / Redo
 * of this person's own changes only (Y.UndoManager on the local origin).
 */
import * as Y from "yjs";
import type { MapDoc } from "../mindmap/map-doc";
import { ORIGIN_LOCAL, Y_MAP, Y_NODES } from "./limits";
import { applyMapDoc, mapDocOf } from "./ydoc";

export class MapBinding {
  present: MapDoc;
  private undoManager: Y.UndoManager | null = null;
  private listeners = new Set<() => void>();

  /** Reading only; `attach` starts following the document (an effect, so Strict Mode is fine). */
  constructor(private readonly doc: Y.Doc) {
    this.present = mapDocOf(doc);
  }

  attach(): () => void {
    const undoManager = new Y.UndoManager([this.doc.getMap(Y_NODES), this.doc.getMap(Y_MAP)], {
      trackedOrigins: new Set([ORIGIN_LOCAL]),
      // Every change of the map is its own step.
      captureTimeout: 0,
    });
    this.undoManager = undoManager;
    this.doc.on("update", this.onUpdate);
    // Changes that came while not attached.
    this.onUpdate();
    return () => {
      this.doc.off("update", this.onUpdate);
      undoManager.destroy();
      if (this.undoManager === undoManager) this.undoManager = null;
    };
  }

  /** The tree as it is now. */
  current(): MapDoc {
    return this.present;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** One change of this person: the map becomes `next`. */
  change(next: MapDoc) {
    if (next === this.present) return;
    applyMapDoc(this.doc, next, ORIGIN_LOCAL);
  }

  canUndo(): boolean {
    return (this.undoManager?.undoStack.length ?? 0) > 0;
  }

  canRedo(): boolean {
    return (this.undoManager?.redoStack.length ?? 0) > 0;
  }

  undo() {
    this.undoManager?.undo();
  }

  redo() {
    this.undoManager?.redo();
  }

  private onUpdate = () => {
    this.present = mapDocOf(this.doc);
    for (const listener of this.listeners) listener();
  };
}
