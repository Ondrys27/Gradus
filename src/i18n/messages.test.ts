/**
 * Guards the translation files against the class of bugs that otherwise only
 * shows up in the browser: a key missing in one language, or a `t("x")` call
 * whose key resolves to a nested object instead of a string (next-intl's
 * INSUFFICIENT_PATH).
 *
 * The call check reads every source file with the TypeScript parser, finds the
 * translators (`useTranslations`, `getTranslations`) with their namespace and
 * resolves each literal key used with them against en.json. Keys built from a
 * template literal are checked by their static prefix.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";

type Messages = { [key: string]: string | Messages };

const SRC = path.resolve(__dirname, "..");

function leafKeys(messages: Messages, prefix = ""): string[] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [full] : leafKeys(value, full);
  });
}

function resolve(messages: Messages, keyPath: string): string | Messages | undefined {
  let node: string | Messages | undefined = messages;
  for (const part of keyPath.split(".")) {
    if (node === undefined || typeof node === "string") return undefined;
    node = node[part];
  }
  return node;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts")
      ? [full]
      : [];
  });
}

const TRANSLATOR_FACTORIES = new Set(["useTranslations", "getTranslations"]);

/** Namespace of `useTranslations("ns")`, `await getTranslations("ns")` or `getTranslations({ namespace })`. */
function translatorNamespace(init: ts.Expression | undefined): string | null | undefined {
  let expr = init;
  if (expr && ts.isAwaitExpression(expr)) expr = expr.expression;
  if (!expr || !ts.isCallExpression(expr) || !ts.isIdentifier(expr.expression)) return undefined;
  if (!TRANSLATOR_FACTORIES.has(expr.expression.text)) return undefined;
  const [arg] = expr.arguments;
  if (!arg) return null;
  if (ts.isStringLiteralLike(arg)) return arg.text;
  if (ts.isObjectLiteralExpression(arg)) {
    for (const prop of arg.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === "namespace" &&
        ts.isStringLiteralLike(prop.initializer)
      ) {
        return prop.initializer.text;
      }
    }
    return null;
  }
  return undefined;
}

type Binding = { kind: "translator"; namespace: string | null } | { kind: "other" };

/** Looks for `name` declared directly in a scope-creating node (not in nested scopes). */
function bindingIn(scope: ts.Node, name: string): Binding | undefined {
  if (ts.isFunctionLike(scope)) {
    for (const param of scope.parameters) {
      if (ts.isIdentifier(param.name) && param.name.text === name) return { kind: "other" };
    }
  }
  const statements =
    ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope)
      ? scope.statements
      : undefined;
  if (!statements) return undefined;
  for (const statement of statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue;
      const namespace = translatorNamespace(decl.initializer);
      return namespace === undefined ? { kind: "other" } : { kind: "translator", namespace };
    }
  }
  return undefined;
}

function resolveBinding(from: ts.Node, name: string): Binding | undefined {
  for (let node: ts.Node | undefined = from; node; node = node.parent) {
    const found = bindingIn(node, name);
    if (found) return found;
  }
  return undefined;
}

type Call = {
  file: string;
  line: number;
  key: string;
  dynamic: boolean;
  /** `null` for a plain `t(key, values)` call, the method name for `t.rich`/`t.markup`. */
  method: string | null;
  /**
   * Property names passed as the call's values object, or `null` when they
   * cannot be read statically (a spread, a computed key, or anything other
   * than an object literal) — such calls are skipped by the variable check.
   */
  values: string[] | null;
};

/** Property names of an object literal, or `null` if that cannot be read statically. */
function objectLiteralKeys(expr: ts.Expression | undefined): string[] | null {
  if (!expr) return [];
  if (!ts.isObjectLiteralExpression(expr)) return null;
  const keys: string[] = [];
  for (const prop of expr.properties) {
    if (ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) {
      keys.push(prop.name.text);
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      keys.push(prop.name.text);
    } else {
      return null;
    }
  }
  return keys;
}

/**
 * Names of the ICU variables a message text expects: the argument of every
 * `{name}`, `{name, plural, ...}` or `{name, select, ...}`, including ones
 * nested inside a plural/select branch.
 *
 * A flat regex over `{word`-followed-by-`,`-or-`}` is not enough: a branch's
 * own message can itself start with "word," (e.g. plural's
 * `=0 {Synced, no new payments.}`) or be a single bare word (`one {it}`),
 * and both look exactly like a variable. So this reads the grammar properly:
 * a message is literal text interleaved with `{argument}`s, and inside a
 * plural/select argument, each `selector {message}` branch's brace belongs
 * to that branch — it is never itself re-read as a fresh argument's name.
 */
function placeholdersIn(message: string): Set<string> {
  const names = new Set<string>();
  const isWord = (c: string | undefined) => !!c && /\w/.test(c);

  const skipWs = (i: number) => {
    while (i < message.length && /\s/.test(message[i]!)) i++;
    return i;
  };
  const readIdent = (i: number): [string, number] => {
    let j = i;
    while (isWord(message[j])) j++;
    return [message.slice(i, j), j];
  };

  /** Plain message text (literal characters and `{argument}`s) up to an unmatched `}` or the end. */
  const scanMessage = (start: number): number => {
    let i = start;
    while (i < message.length && message[i] !== "}") {
      if (message[i] === "{") {
        i = scanArgument(i);
      } else if (message[i] === "'" && /['{}#]/.test(message[i + 1] ?? "")) {
        // ICU escaping only starts before one of ' { } # — elsewhere (an
        // apostrophe in "You've") it is just a normal character. '' is a
        // literal quote; otherwise the escape runs to the next '.
        i++;
        if (message[i] === "'") i++;
        else {
          const close = message.indexOf("'", i + 1);
          i = close === -1 ? message.length : close + 1;
        }
      } else {
        i++;
      }
    }
    return i;
  };

  /** `i` is at an argument's opening `{`. Returns the index right after its matching `}`. */
  function scanArgument(i: number): number {
    i = skipWs(i + 1);
    const [name, afterName] = readIdent(i);
    if (name) names.add(name);
    i = skipWs(afterName);
    if (message[i] !== ",") return i + 1; // `{name}`, or malformed — don't loop forever
    i = skipWs(i + 1);
    const [type, afterType] = readIdent(i);
    i = skipWs(afterType);
    if (type === "plural" || type === "selectordinal" || type === "select") {
      if (message[i] === ",") i = skipWs(i + 1);
      if (message.startsWith("offset:", i)) {
        i = skipWs(i + "offset:".length);
        while (/\d/.test(message[i] ?? "")) i++;
        i = skipWs(i);
      }
      while (i < message.length && message[i] !== "}") {
        // A selector is "=" + digits, or a bare word (other, one, few, a select key, ...).
        if (message[i] === "=") {
          i++;
          while (/\d/.test(message[i] ?? "")) i++;
        } else {
          i = readIdent(i)[1];
        }
        i = skipWs(i);
        if (message[i] === "{") {
          i = scanMessage(i + 1);
          if (message[i] === "}") i++;
        }
        i = skipWs(i);
      }
      return i + 1;
    }
    // A simple format (number, date, time, ...): its style is literal text, not a message.
    let depth = 1;
    while (i < message.length && depth > 0) {
      if (message[i] === "{") depth++;
      else if (message[i] === "}") depth--;
      i++;
    }
    return i;
  }

  scanMessage(0);
  return names;
}

function translationCalls(file: string): Call[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const calls: Call[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      let callee = node.expression;
      let method: string | null = null;
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
        method = callee.name.text;
        callee = callee.expression;
      }
      // `t.raw` may return objects on purpose and `t.has` only asks.
      const checked = method === null || method === "rich" || method === "markup";
      const [arg, valuesArg] = node.arguments;
      if (checked && ts.isIdentifier(callee) && arg) {
        const binding = resolveBinding(node, callee.text);
        if (binding?.kind === "translator") {
          const ns = binding.namespace;
          const join = (key: string) => (ns ? `${ns}.${key}` : key);
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          const rel = path.relative(SRC, file);
          const values = objectLiteralKeys(valuesArg);
          if (ts.isStringLiteralLike(arg)) {
            calls.push({ file: rel, line, key: join(arg.text), dynamic: false, method, values });
          } else if (ts.isTemplateExpression(arg) && arg.head.text.endsWith(".")) {
            calls.push({
              file: rel,
              line,
              key: join(arg.head.text.slice(0, -1)),
              dynamic: true,
              method,
              values,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

describe("translation files", () => {
  it("en.json and cs.json have exactly the same keys", () => {
    const enKeys = new Set(leafKeys(en as Messages));
    const csKeys = new Set(leafKeys(cs as Messages));
    expect(
      [...enKeys].filter((key) => !csKeys.has(key)),
      "missing in cs.json",
    ).toEqual([]);
    expect(
      [...csKeys].filter((key) => !enKeys.has(key)),
      "missing in en.json",
    ).toEqual([]);
  });

  it("no key is both a text and a group of texts in the other language", () => {
    const mismatched = leafKeys(en as Messages).filter(
      (key) => typeof resolve(cs as Messages, key) !== "string",
    );
    expect(mismatched).toEqual([]);
  });
});

describe("translation calls in the code", () => {
  const calls = sourceFiles(SRC).flatMap(translationCalls);

  it("finds the calls it is meant to check", () => {
    // A sanity floor so a broken parser cannot make the next test pass vacuously.
    expect(calls.length).toBeGreaterThan(500);
  });

  it("every literal key resolves to a text, never to a group of texts", () => {
    const broken = calls
      .filter((call) => !call.dynamic)
      .flatMap((call) => {
        const value = resolve(en as Messages, call.key);
        if (typeof value === "string") return [];
        const why = value === undefined ? "missing" : "is an object";
        return [`${call.file}:${call.line} ${call.key} ${why}`];
      });
    expect(broken).toEqual([]);
  });

  it("every dynamic key starts in an existing group of texts", () => {
    const broken = calls
      .filter((call) => call.dynamic)
      .flatMap((call) => {
        const value = resolve(en as Messages, call.key);
        return value !== undefined && typeof value !== "string"
          ? []
          : [`${call.file}:${call.line} ${call.key}.*`];
      });
    expect(broken).toEqual([]);
  });

  it("every plain t() call passes exactly the variables its text expects", () => {
    // Scoped to literal-key, non-rich/markup calls whose values are a plain
    // object literal (or omitted) — the rest cannot be checked statically and
    // are left alone rather than risking a false positive.
    const broken = calls
      .filter((call) => !call.dynamic && call.method === null && call.values !== null)
      .flatMap((call) => {
        const text = resolve(en as Messages, call.key);
        if (typeof text !== "string") return []; // already reported above
        const required = placeholdersIn(text);
        const passed = new Set(call.values!);
        const missing = [...required].filter((name) => !passed.has(name));
        const extra = [...passed].filter((name) => !required.has(name));
        if (missing.length === 0 && extra.length === 0) return [];
        const parts = [
          ...missing.map((name) => `missing {${name}}`),
          ...extra.map((name) => `extra ${name}`),
        ];
        return [`${call.file}:${call.line} ${call.key}: ${parts.join(", ")}`];
      });
    expect(broken).toEqual([]);
  });
});
