/**
 * A small XML reader for mind map files (OPML, FreeMind, XMind 8). It never
 * resolves anything outside the text: a DOCTYPE with an internal subset (where
 * entities would be declared) refuses the file, external identifiers are never
 * fetched, and only the five predefined entities and character references are
 * decoded; any other `&name;` stays as it is. Elements and nesting are bounded,
 * so a crafted file can not exhaust memory or the stack.
 */

export type XmlElement = { name: string; attributes: Record<string, string>; children: XmlNode[] };
export type XmlNode = XmlElement | string;

export type XmlErrorCode = "unsafe" | "malformed";

export class XmlError extends Error {
  constructor(readonly code: XmlErrorCode) {
    super(`xml: ${code}`);
    this.name = "XmlError";
  }
}

const MAX_DEPTH = 1000;
const MAX_ELEMENTS = 100_000;

const PREDEFINED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g,
    (match, entity: string) => {
      if (entity[0] === "#") {
        const code =
          entity[1] === "x" || entity[1] === "X"
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : "";
      }
      return PREDEFINED[entity] ?? match;
    },
  );
}

/** The name without a namespace prefix: `x:topic` → `topic`. */
function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon >= 0 ? name.slice(colon + 1) : name;
}

const NAME = /^[A-Za-z_][\w.:-]*/;

function parseAttributes(body: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  for (const match of body.matchAll(pattern)) {
    const name = match[1];
    // Namespace declarations say nothing about the content.
    if (name === "xmlns" || name.startsWith("xmlns:")) continue;
    attributes[localName(name)] = decodeEntities(match[3] ?? match[4] ?? "");
  }
  return attributes;
}

/** Where the tag starting at `from` (just after `<`) ends: the `>` outside quotes. */
function tagEnd(text: string, from: number): number {
  let quote: string | null = null;
  for (let index = from; index < text.length; index++) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

/** The root element of an XML document. Throws XmlError. */
export function parseXml(text: string): XmlElement {
  const document: XmlElement = { name: "#document", attributes: {}, children: [] };
  const stack: XmlElement[] = [document];
  let elements = 0;
  let index = 0;

  const top = () => stack[stack.length - 1];
  const addText = (value: string) => {
    if (stack.length > 1 && value) top().children.push(value);
  };

  while (index < text.length) {
    const open = text.indexOf("<", index);
    if (open < 0) {
      addText(decodeEntities(text.slice(index)));
      break;
    }
    if (open > index) addText(decodeEntities(text.slice(index, open)));

    if (text.startsWith("<!--", open)) {
      const end = text.indexOf("-->", open + 4);
      if (end < 0) throw new XmlError("malformed");
      index = end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", open)) {
      const end = text.indexOf("]]>", open + 9);
      if (end < 0) throw new XmlError("malformed");
      addText(text.slice(open + 9, end));
      index = end + 3;
      continue;
    }
    if (text.startsWith("<?", open)) {
      const end = text.indexOf("?>", open + 2);
      if (end < 0) throw new XmlError("malformed");
      index = end + 2;
      continue;
    }
    if (text.startsWith("<!", open)) {
      // A DOCTYPE: an internal subset could declare entities, so it is refused.
      const end = tagEnd(text, open + 2);
      if (end < 0) throw new XmlError("malformed");
      const declaration = text.slice(open, end + 1);
      if (declaration.includes("[") || /<!ENTITY/i.test(declaration)) {
        throw new XmlError("unsafe");
      }
      index = end + 1;
      continue;
    }

    const end = tagEnd(text, open + 1);
    if (end < 0) throw new XmlError("malformed");
    const body = text.slice(open + 1, end);
    index = end + 1;

    if (body.startsWith("/")) {
      const name = localName(body.slice(1).trim());
      const current = top();
      if (stack.length <= 1 || current.name !== name) throw new XmlError("malformed");
      stack.pop();
      continue;
    }

    const selfClosing = body.endsWith("/");
    const inner = selfClosing ? body.slice(0, -1) : body;
    const name = NAME.exec(inner)?.[0];
    if (!name) throw new XmlError("malformed");
    elements += 1;
    if (elements > MAX_ELEMENTS) throw new XmlError("unsafe");
    const element: XmlElement = {
      name: localName(name),
      attributes: parseAttributes(inner.slice(name.length)),
      children: [],
    };
    top().children.push(element);
    if (!selfClosing) {
      if (stack.length > MAX_DEPTH) throw new XmlError("unsafe");
      stack.push(element);
    }
  }

  if (stack.length > 1) throw new XmlError("malformed");
  const root = document.children.find((child): child is XmlElement => typeof child !== "string");
  if (!root) throw new XmlError("malformed");
  return root;
}

export function childElements(element: XmlElement, name?: string): XmlElement[] {
  return element.children.filter(
    (child): child is XmlElement => typeof child !== "string" && (!name || child.name === name),
  );
}

export function firstChild(element: XmlElement, name: string): XmlElement | undefined {
  return childElements(element, name)[0];
}

/** All text inside an element; block-level HTML tags (in rich text) count as a space. */
export function textContent(element: XmlElement): string {
  const parts: string[] = [];
  const walk = (current: XmlElement) => {
    for (const child of current.children) {
      if (typeof child === "string") parts.push(child);
      else {
        walk(child);
        if (/^(p|div|br|li|h[1-6]|tr)$/i.test(child.name)) parts.push(" ");
      }
    }
  };
  walk(element);
  return parts.join("");
}

/** Text safe inside an attribute value in double quotes. */
export function escapeAttribute(value: string): string {
  return (
    value
      // Control characters are not allowed in XML 1.0 at all.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/\n/g, "&#10;")
      .replace(/\t/g, "&#9;")
      .replace(/\r/g, "&#13;")
  );
}
