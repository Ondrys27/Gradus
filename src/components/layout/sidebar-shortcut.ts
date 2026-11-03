/**
 * ⌘B / Ctrl+B collapses or expands the sidebar on wide screens. Not with
 * Shift (⌘⇧B reports a problem) or Alt, and never while typing: in the notes
 * editor ⌘B is bold, so a field or editable text keeps the keys to itself.
 */
export function isSidebarShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "repeat" | "defaultPrevented"
  >,
): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    !event.altKey &&
    !event.repeat &&
    !event.defaultPrevented &&
    event.key.toLowerCase() === "b"
  );
}

/** A text field, a select or editable text (the notes editor) has the keys. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest("[contenteditable=''], [contenteditable=true]")) {
    return true;
  }
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
