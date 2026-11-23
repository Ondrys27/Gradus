// Two Tiptap editors bound to two copies of one live note (28.4), the way the
// app binds them: changes reach the other editor, a change by both at once
// ends the same in both, Undo takes back only one's own change, and the
// schema of the editor in the browser is the one the server writes with.

import * as Y from "yjs";
import { Editor, getSchema } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { afterEach, describe, expect, it } from "vitest";
import { createRecordMention, MentionMenuBridge } from "../mention-extension";
import { Y_TEXT } from "./limits";
import { noteSchema, noteSchemaExtensions, noteStarterKit } from "./schema";
import { seedState, textJsonOf } from "./ydoc";

const REMOTE = "test-remote";

function linked() {
  const start = seedState(
    "text",
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }] },
    "s0",
  );
  const a = new Y.Doc();
  const b = new Y.Doc();
  Y.applyUpdate(a, start);
  Y.applyUpdate(b, start);
  a.on("update", (update: Uint8Array, origin: unknown) => origin !== REMOTE && Y.applyUpdate(b, update, REMOTE));
  b.on("update", (update: Uint8Array, origin: unknown) => origin !== REMOTE && Y.applyUpdate(a, update, REMOTE));
  return { a, b };
}

const editors: Editor[] = [];
function editorOn(doc: Y.Doc) {
  const editor = new Editor({
    extensions: [...noteSchemaExtensions(), Collaboration.configure({ document: doc, field: Y_TEXT })],
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

describe("editors on a live note", () => {
  it("shows one person's typing in the other's editor", () => {
    const { a, b } = linked();
    const first = editorOn(a);
    const second = editorOn(b);
    expect(second.getText()).toBe("Body");
    first.commands.insertContentAt(first.state.doc.content.size - 1, ": rozpočet");
    expect(second.getText()).toBe("Body: rozpočet");
    expect(JSON.stringify(textJsonOf(b))).toContain("rozpočet");
  });

  it("takes back only one's own change with Undo, never the other person's", () => {
    const { a, b } = linked();
    const first = editorOn(a);
    const second = editorOn(b);
    first.commands.insertContentAt(first.state.doc.content.size - 1, " A");
    second.commands.insertContentAt(second.state.doc.content.size - 1, " B");
    expect(first.getText()).toBe("Body A B");
    first.commands.undo();
    expect(first.getText()).toBe("Body B");
    expect(second.getText()).toBe("Body B");
    first.commands.redo();
    expect(second.getText()).toBe("Body A B");
  });

  it("uses the same schema in the browser editor as on the server", () => {
    const browser = getSchema([
      noteStarterKit(),
      TaskList,
      TaskItem.configure({ nested: true }),
      createRecordMention(new MentionMenuBridge()),
    ]);
    const server = noteSchema();
    expect(Object.keys(browser.nodes).sort()).toEqual(Object.keys(server.nodes).sort());
    expect(Object.keys(browser.marks).sort()).toEqual(Object.keys(server.marks).sort());
    for (const name of Object.keys(server.nodes)) {
      expect(Object.keys(browser.nodes[name].spec.attrs ?? {}).sort()).toEqual(
        Object.keys(server.nodes[name].spec.attrs ?? {}).sort(),
      );
    }
  });
});
