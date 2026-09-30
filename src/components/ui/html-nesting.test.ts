/**
 * Invalid HTML nesting (a `<div>` inside a `<p>`, a button inside a button)
 * makes the browser repair the DOM, and React then fails to hydrate. This test
 * reads every component with the TypeScript parser and flags block elements
 * inside text-level ones, and interactive elements inside buttons.
 *
 * Shared components are mapped to what they render, so `<Skeleton>` counts as
 * a `<div>` unless it is `inline`, and `<Button>` or a Base UI trigger counts
 * as a `<button>`. Elements passed through a `render` prop are not children and
 * are not checked.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../..");

/** Elements whose content model is phrasing content only. */
const TEXT_LEVEL = new Set(["p", "span", "label", "button", "h1", "h2", "h3", "h4", "h5", "h6"]);

const BLOCK = new Set([
  "div",
  "p",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "nav",
  "main",
  "ul",
  "ol",
  "li",
  "dl",
  "table",
  "form",
  "fieldset",
  "figure",
  "hr",
  "pre",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

const INTERACTIVE = new Set(["button", "a", "input", "select", "textarea"]);

/** Shared components and the element they render at their root. */
const COMPONENT_ROOT: Record<string, string> = {
  Button: "button",
  GlowCard: "div",
  StatTile: "div",
  ProgressBar: "div",
  ProgressRing: "div",
  EmptyState: "div",
  FormAlert: "div",
  PageHeader: "div",
  "Menu.Trigger": "button",
  "Menu.Item": "div",
  "Popover.Trigger": "button",
  "Select.Trigger": "button",
  "SelectPrimitive.Trigger": "button",
  "Drawer.Close": "button",
  "Popover.Close": "button",
  "Dialog.Trigger": "button",
  "Dialog.Close": "button",
  "Tabs.Tab": "button",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith(".tsx") && !name.endsWith(".test.tsx") ? [full] : [];
  });
}

function tagName(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  return opening.tagName.getText();
}

function attributes(node: ts.JsxElement | ts.JsxSelfClosingElement): ts.JsxAttributes {
  return (ts.isJsxElement(node) ? node.openingElement : node).attributes;
}

function hasAttribute(node: ts.JsxElement | ts.JsxSelfClosingElement, name: string): boolean {
  return attributes(node).properties.some(
    (prop) => ts.isJsxAttribute(prop) && prop.name.getText() === name,
  );
}

/** The HTML element a JSX element ends up as, or null when it cannot be known. */
function rendered(node: ts.JsxElement | ts.JsxSelfClosingElement): string | null {
  const tag = tagName(node);
  // With a `render` prop, Base UI renders that element instead.
  if (hasAttribute(node, "render")) return null;
  if (tag === "Skeleton") return hasAttribute(node, "inline") ? "span" : "div";
  if (/^motion\.[a-z]+$/.test(tag)) return tag.slice("motion.".length);
  if (/^[a-z]/.test(tag)) return tag;
  return COMPONENT_ROOT[tag] ?? null;
}

type Problem = string;

function problemsIn(file: string): Problem[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const problems: Problem[] = [];
  const rel = path.relative(SRC, file);

  /** Walks the children of `node`, carrying the nearest text-level and button ancestors. */
  const visit = (node: ts.Node, textParent: string | null, inButton: boolean) => {
    if (ts.isJsxAttribute(node)) return; // props such as `render` or `icon` are not children
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const element = rendered(node);
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const tag = tagName(node);
      if (element && textParent && BLOCK.has(element)) {
        problems.push(`${rel}:${line} <${tag}> (${element}) inside <${textParent}>`);
      }
      if (element && inButton && INTERACTIVE.has(element)) {
        problems.push(`${rel}:${line} <${tag}> (${element}) inside a button`);
      }
      const nextText = element && TEXT_LEVEL.has(element) ? element : element ? null : textParent;
      const nextButton = inButton || element === "button";
      if (ts.isJsxElement(node)) {
        for (const child of node.children) visit(child, nextText, nextButton);
      }
      return;
    }
    ts.forEachChild(node, (child) => visit(child, textParent, inButton));
  };
  visit(source, null, false);
  return problems;
}

describe("HTML nesting in components", () => {
  it("has no block element inside text and no interactive element inside a button", () => {
    const problems = sourceFiles(SRC).flatMap(problemsIn);
    expect(problems).toEqual([]);
  });
});
