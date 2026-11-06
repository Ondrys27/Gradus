import { fromOutline, indentWidth, unwrapRoot, type MindMapTree, type OutlineLine } from "./tree";

/**
 * Plain text with indentation (what most outliners copy and MindNode exports
 * as text): every line is a node, the indent is its level. Bullets in front
 * (- * + • ◦ ▪ ‣ – ·, 1.) are dropped, a box ([ ], [x], ☐, ☑, ✅) is the state.
 */

const BULLET = /^(?:[-*+•◦▪‣–·]|\d{1,9}[.)])[ \t]+/;
const BOX = /^(?:\[([ xX])\]|([☐☑☒✅✓✔]))[ \t]*/u;

export function parsePlainText(text: string): MindMapTree {
  const lines: OutlineLine[] = [];
  for (const raw of text.replace(/^﻿/, "").split(/\r\n?|\n/)) {
    if (!raw.trim()) continue;
    const indent = indentWidth(/^[ \t]*/.exec(raw)![0]);
    let title = raw.trim().replace(BULLET, "");
    let done: boolean | undefined;
    const box = BOX.exec(title);
    if (box) {
      done = box[1] !== undefined ? box[1] !== " " : box[2] !== "☐";
      title = title.slice(box[0].length);
    }
    lines.push({ indent, title, done });
  }
  return unwrapRoot(fromOutline(lines));
}
