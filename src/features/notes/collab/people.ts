import { BRANCH_COLORS } from "../mindmap/map-doc";
import type { CollabColor } from "./provider";

/** A person's colour of cursors and faces: always the same for the same account, a theme token. */
export function colorForPerson(userId: string): CollabColor {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return BRANCH_COLORS[hash % BRANCH_COLORS.length];
}

/** Who is writing right now, for "Píše Váša…" (one, two, or one and n more). */
export function typingLabel(
  names: string[],
  t: (key: "one" | "two" | "more", values: Record<string, string | number>) => string,
): string | null {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0) return null;
  if (unique.length === 1) return t("one", { name: unique[0] });
  if (unique.length === 2) return t("two", { first: unique[0], second: unique[1] });
  return t("more", { name: unique[0], count: unique.length - 1 });
}

/** The cursor of another person in the text: a thin line with their name. */
export function renderCaret(user: Record<string, unknown>): HTMLElement {
  const caret = document.createElement("span");
  caret.classList.add("collab-caret");
  caret.style.setProperty("--caret-color", String(user.color ?? "var(--color-violet)"));
  const label = document.createElement("span");
  label.classList.add("collab-caret__label");
  label.setAttribute("aria-hidden", "true");
  label.textContent = String(user.name ?? "");
  caret.append(label);
  return caret;
}

/** Another person's selection: tinted in their colour. */
export function renderSelection(user: Record<string, unknown>) {
  return {
    nodeName: "span",
    class: "collab-selection",
    style: `--caret-color: ${String(user.color ?? "var(--color-violet)")}`,
  };
}
