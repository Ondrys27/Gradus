import { describe, expect, it } from "vitest";
import { isSidebarShortcut, isTypingTarget } from "./sidebar-shortcut";

const key = (overrides: Partial<KeyboardEvent> = {}) => ({
  key: "b",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  repeat: false,
  defaultPrevented: false,
  ...overrides,
});

describe("isSidebarShortcut", () => {
  it("is ⌘B on a Mac and Ctrl+B elsewhere, with Caps Lock too", () => {
    expect(isSidebarShortcut(key({ metaKey: true }))).toBe(true);
    expect(isSidebarShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isSidebarShortcut(key({ ctrlKey: true, key: "B" }))).toBe(true);
  });

  it("leaves ⌘⇧B to reporting a problem and ignores B alone or with Alt", () => {
    expect(isSidebarShortcut(key({ metaKey: true, shiftKey: true, key: "B" }))).toBe(false);
    expect(isSidebarShortcut(key())).toBe(false);
    expect(isSidebarShortcut(key({ metaKey: true, altKey: true }))).toBe(false);
    expect(isSidebarShortcut(key({ metaKey: true, key: "k" }))).toBe(false);
  });

  it("does not toggle again while the keys are held or when something else took them", () => {
    expect(isSidebarShortcut(key({ metaKey: true, repeat: true }))).toBe(false);
    expect(isSidebarShortcut(key({ metaKey: true, defaultPrevented: true }))).toBe(false);
  });
});

describe("isTypingTarget", () => {
  it("keeps the keys in fields and editable text (bold in the notes editor)", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const paragraph = document.createElement("p");
    editor.append(paragraph);
    document.body.append(editor);
    expect(isTypingTarget(paragraph)).toBe(true);
    editor.remove();
  });

  it("lets the page, links and buttons have the shortcut", () => {
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(document.createElement("a"))).toBe(false);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
  });
});
