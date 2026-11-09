/**
 * What a plan cell accepts: "12500", "12 500", "12,5k", "1.2m", "-3000" and
 * simple arithmetic "3*4000", "12 000 + 500", "(2+3)*1000", "×" and "x" for
 * times. No eval: a small parser over numbers, + − * / and brackets.
 *
 * Separators follow the user's number format (`decimal` is "," or "."):
 * both in one number → the last one is the decimal point; only the format's
 * decimal mark once → decimal; the other mark followed by exactly three
 * digits (or several times) → thousands; otherwise decimal ("12.5k" in a
 * Czech format is still 12 500). Spaces and apostrophes are never decimals.
 */

export const PLAN_AMOUNT_MAX = 999_999_999_999.99;

export type AmountInput = { ok: true; value: number | null } | { ok: false };

const SUFFIX: Record<string, number> = { k: 1_000, m: 1_000_000 };

function normalizeNumber(raw: string, decimal: "," | "."): number | null {
  const token = raw;
  const hasComma = token.includes(",");
  const hasDot = token.includes(".");
  let plain: string;
  if (hasComma && hasDot) {
    const last = Math.max(token.lastIndexOf(","), token.lastIndexOf("."));
    plain = token.slice(0, last).replace(/[.,]/g, "") + "." + token.slice(last + 1);
  } else if (hasComma || hasDot) {
    const mark = hasComma ? "," : ".";
    const pieces = token.split(mark);
    if (pieces.length > 2) {
      // 1.234.567 or 1,234,567: grouping, every group three digits.
      if (!pieces.slice(1).every((piece) => /^\d{3}$/.test(piece))) return null;
      plain = pieces.join("");
    } else if (mark === decimal) {
      plain = pieces.join(".");
    } else {
      plain = /^\d{3}$/.test(pieces[1]) ? pieces.join("") : pieces.join(".");
    }
  } else {
    plain = token;
  }
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(plain)) return null;
  return Number(plain);
}

type Token = { kind: "number"; value: number } | { kind: "op"; value: string };

function tokenize(text: string, decimal: "," | "."): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if ("+-*/()".includes(char)) {
      tokens.push({ kind: "op", value: char });
      index += 1;
      continue;
    }
    if (char === "×" || char === "x" || char === "X") {
      tokens.push({ kind: "op", value: "*" });
      index += 1;
      continue;
    }
    if (char === "−" || char === "–") {
      tokens.push({ kind: "op", value: "-" });
      index += 1;
      continue;
    }
    const match = /^[\d.,]+/.exec(text.slice(index));
    if (!match) return null;
    let value = normalizeNumber(match[0], decimal);
    if (value === null) return null;
    index += match[0].length;
    const suffix = text[index]?.toLowerCase();
    if (suffix && SUFFIX[suffix]) {
      value *= SUFFIX[suffix];
      index += 1;
    }
    tokens.push({ kind: "number", value });
  }
  return tokens;
}

/** Recursive descent: expression = term (± term)*, term = factor (×÷ factor)*. */
function evaluate(tokens: Token[]): number | null {
  let position = 0;
  const peek = () => tokens[position];
  const isOp = (value: string) => {
    const token = peek();
    return token?.kind === "op" && token.value === value;
  };

  function factor(): number | null {
    if (isOp("-")) {
      position += 1;
      const inner = factor();
      return inner === null ? null : -inner;
    }
    if (isOp("+")) {
      position += 1;
      return factor();
    }
    if (isOp("(")) {
      position += 1;
      const inner = expression();
      if (inner === null || !isOp(")")) return null;
      position += 1;
      return inner;
    }
    const token = peek();
    if (token?.kind !== "number") return null;
    position += 1;
    return token.value;
  }

  function term(): number | null {
    let value = factor();
    while (value !== null && (isOp("*") || isOp("/"))) {
      const op = (peek() as Token).value;
      position += 1;
      const right = factor();
      if (right === null) return null;
      if (op === "/" && right === 0) return null;
      value = op === "*" ? value * right : value / right;
    }
    return value;
  }

  function expression(): number | null {
    let value = term();
    while (value !== null && (isOp("+") || isOp("-"))) {
      const op = (peek() as Token).value;
      position += 1;
      const right = term();
      if (right === null) return null;
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  const result = expression();
  return position === tokens.length ? result : null;
}

/** The decimal mark of a number format, e.g. "," for cs-CZ. */
export function decimalMarkOf(numberLocale: string): "," | "." {
  const part = new Intl.NumberFormat(numberLocale)
    .formatToParts(1.5)
    .find((piece) => piece.type === "decimal");
  return part?.value === "," ? "," : ".";
}

/** Empty = a cleared cell (null); anything unreadable or out of range is refused. */
export function parseAmountInput(text: string, decimal: "," | "." = ","): AmountInput {
  const compact = text.replace(/[\s  '’]/g, "").replace(/^=/, "");
  if (compact === "") return { ok: true, value: null };
  if (compact.length > 80) return { ok: false };
  const tokens = tokenize(compact, decimal);
  if (!tokens?.length) return { ok: false };
  const value = evaluate(tokens);
  if (value === null || !Number.isFinite(value)) return { ok: false };
  const rounded = Math.round(value * 100) / 100;
  if (Math.abs(rounded) > PLAN_AMOUNT_MAX) return { ok: false };
  return { ok: true, value: rounded === 0 ? 0 : rounded };
}
