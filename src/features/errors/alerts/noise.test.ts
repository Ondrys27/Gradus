import { describe, expect, it } from "vitest";
import { isStaleClientError, noiseRuleOf, type NoiseInput } from "./noise";
import { mayReload, RELOAD_GUARD_MS } from "./stale-client";

const prod = (message: string, extra: Partial<NoiseInput> = {}) =>
  noiseRuleOf({ message, dev: false, ...extra });

/** Messages from the production log of 26. 11. 2026 and real errors that must stay. */
describe("noiseRuleOf", () => {
  it("drops a request the person abandoned, keeps a real failure of the same route", () => {
    expect(prod("Error: aborted", { stack: "at abortIncoming (node:_http_server:838:17)" })).toBe(
      "abortedRequest",
    );
    expect(prod("AbortError: The user aborted a request.")).toBe("abortedRequest");
    expect(prod("AbortError: signal is aborted without reason")).toBe("abortedRequest");
    expect(prod("Error: aborted while saving the invoice")).toBeNull();
    expect(prod("TypeError: Cannot read properties of undefined (reading 'mode')")).toBeNull();
  });

  it("drops a lost connection only offline, while leaving, or on the dev server", () => {
    expect(prod("Error: Connection closed.")).toBeNull();
    expect(prod("TypeError: Failed to fetch")).toBeNull();
    expect(prod("Error: Connection closed.", { leaving: true })).toBe("connectionLost");
    expect(prod("TypeError: Load failed", { offline: true })).toBe("connectionLost");
    expect(noiseRuleOf({ message: "Error: Connection closed.", dev: true })).toBe("connectionLost");
    expect(prod("Error: Connection closed by the database", { offline: true })).toBeNull();
  });

  it("drops an extension's error, keeps the app's own with an extension further down", () => {
    expect(
      prod("TypeError: x is undefined", {
        stack: "TypeError: x is undefined\n    at run (chrome-extension://abcdef/content.js:1:20)",
      }),
    ).toBe("browserExtension");
    expect(
      prod("TypeError: x is undefined", {
        stack: "x@moz-extension://1234/inject.js:2:3",
      }),
    ).toBe("browserExtension");
    expect(
      prod("TypeError: x is undefined", {
        stack: [
          "TypeError: x is undefined",
          "    at Deal (https://www.gradusgo.com/_next/static/chunks/1.js:1:2)",
          "    at wrap (chrome-extension://abcdef/content.js:1:20)",
        ].join("\n"),
      }),
    ).toBeNull();
  });

  it("drops the browser's harmless notices", () => {
    expect(prod("ResizeObserver loop completed with undelivered notifications.")).toBe("browserNotice");
    expect(prod("Error: ResizeObserver loop limit exceeded")).toBe("browserNotice");
    expect(prod("Script error.")).toBe("browserNotice");
    expect(prod("Error: Script error in the invoice template")).toBeNull();
  });

  it("knows an old page after a deployment", () => {
    for (const message of [
      "ChunkLoadError: Loading chunk 6552 failed.",
      "Error: Loading chunk app/pipeline failed. (timeout: https://x/_next/static/chunks/a.js)",
      "Error: Loading CSS chunk 123 failed.",
      "TypeError: Failed to fetch dynamically imported module: https://x/_next/static/chunks/a.js",
      "TypeError: Importing a module script failed.",
      'Error: Failed to find Server Action "7f3a". This request might be from an older or newer deployment.',
    ]) {
      expect(isStaleClientError(message)).toBe(true);
      expect(prod(message)).toBe("staleClient");
    }
    expect(isStaleClientError("TypeError: Failed to fetch")).toBe(false);
    expect(isStaleClientError("Error: Loading the deals failed")).toBe(false);
  });

  it("drops a bot's malformed address", () => {
    expect(prod("URIError: URI malformed")).toBe("malformedAddress");
    expect(prod("Error: Failed to decode param '%E0%A4%A'")).toBe("malformedAddress");
  });

  it("drops the dev bundler's failures only on the dev server", () => {
    const manifest =
      'Error: Could not find the module "[project]/src/app/(app)/error.tsx#default" in the React Client Manifest. This is probably a bug in the React Server Components bundler.';
    const hmr =
      "Error: Module [project]/src/features/notes/notes-view.tsx [app-ssr] (ecmascript) was instantiated because it was required from module [project]/node_modules/next/dist/esm/build/templates/app-page.js";
    const intl = "Error: Failed to call `useTranslations` because the context from `NextIntlClientProvider` was not found.";
    for (const message of [manifest, hmr, intl]) {
      expect(noiseRuleOf({ message, dev: true })).toBe("devBundler");
      expect(prod(message)).toBeNull();
    }
  });

  it("keeps the real errors of the log", () => {
    expect(prod("Error: Minified React error #185; visit https://react.dev/errors/185")).toBeNull();
    expect(noiseRuleOf({ message: "Error: Maximum update depth exceeded.", dev: true })).toBeNull();
    expect(noiseRuleOf({ message: "Error: Gradus crash test", dev: true })).toBeNull();
    expect(prod("Error: Hydration failed because the server rendered text didn't match the client.")).toBeNull();
    expect(prod("unknown")).toBeNull();
  });
});

describe("mayReload", () => {
  it("reloads once, and not again within the guard", () => {
    expect(mayReload(null, 1_000_000)).toBe(true);
    expect(mayReload(1_000_000, 1_000_000 + 5_000)).toBe(false);
    expect(mayReload(1_000_000, 1_000_000 + RELOAD_GUARD_MS + 1)).toBe(true);
    expect(mayReload(Number.NaN, 1)).toBe(true);
  });
});
