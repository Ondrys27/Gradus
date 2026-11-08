import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  docKeys,
  missingKeys,
  priceIssues,
  pricedRows,
  routeKinds,
  routeOf,
  staleKeys,
  type PriceTools,
} from "./check";
import { expectedKeys, PRICE_TOOLS } from "./sources";

describe("docKeys", () => {
  it("reads the keys of the hidden code comments only", () => {
    const doc = [
      "Text about nav:notes is not a key.",
      "<!-- kód: nav:pipeline route:/app/pipeline -->",
      "| row | <!-- kód: ai:chat\n kind:emailReply --> |",
      "<!-- other: nav:ignored -->",
      "Prose mentioning `<!-- kód: … -->` adds nothing.",
    ].join("\n");
    expect([...docKeys(doc)].sort()).toEqual([
      "ai:chat",
      "kind:emailReply",
      "nav:pipeline",
      "route:/app/pipeline",
    ]);
  });
});

describe("missingKeys and staleKeys", () => {
  const expected = [
    { key: "nav:dashboard", source: "a" },
    { key: "nav:notes", source: "a" },
    { key: "ai:chat", source: "b" },
  ];

  it("lists what the code has and the document does not", () => {
    const keys = new Set(["nav:dashboard", "ai:chat"]);
    expect(missingKeys(expected, keys)).toEqual([{ key: "nav:notes", source: "a" }]);
  });

  it("lists keys of checked kinds that the code no longer has, ignoring other prefixes", () => {
    const keys = new Set(["nav:dashboard", "nav:gone", "ai:old", "other:thing"]);
    expect(staleKeys(expected, keys)).toEqual(["ai:old", "nav:gone"]);
  });
});

describe("routeOf", () => {
  it("drops route groups and the file name", () => {
    expect(routeOf("(app)/app/milniky/[id]/page.tsx")).toBe("/app/milniky/[id]");
    expect(routeOf("(marketing)/(cs)/page.tsx")).toBe("/");
    expect(routeOf("(marketing)/en/pricing/page.tsx")).toBe("/en/pricing");
    expect(routeOf("(app)/app/page.tsx")).toBe("/app");
  });
});

describe("routeKinds", () => {
  it("finds every kind the route dispatches on, once", () => {
    const source = `if (kind === "milestoneReview") a();\nif (kind === "ping") b();\nif (kind === "ping") c();`;
    expect(routeKinds(source)).toEqual(["milestoneReview", "ping"]);
  });
});

describe("pricedRows and priceIssues", () => {
  // 1 USD per 1,000 input tokens, 2 USD per 1,000 output tokens; cache ignored.
  const tools: PriceTools = {
    features: ["chat", "analysis"],
    price: (_feature, usage) => usage.inputTokens / 1000 + (usage.outputTokens / 1000) * 2,
  };
  const row = (label: string, price: string, comment: string) =>
    `| ${label} | ${price} <!-- cena: ${comment} --> |`;

  it("reads the job, the tokens and the shown price with its decimals", () => {
    const rows = pricedRows(row("A", "0,250 USD", "ai=chat in=50 read=10 write=5 out=100"));
    expect(rows).toEqual([
      {
        line: 1,
        feature: "chat",
        usage: { inputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5, outputTokens: 100 },
        shownUsd: 0.25,
        shownDecimals: 3,
      },
    ]);
  });

  it("ignores a cena comment without a job (prose about the format)", () => {
    expect(pricedRows("Marks `<!-- cena: … -->` are for the script.")).toEqual([]);
  });

  it("accepts prices that match at the shown precision, sorted from the most expensive", () => {
    const doc = [
      row("A", "0,30 USD", "ai=analysis in=100 out=100"),
      row("B", "0,25 USD", "ai=chat in=50 out=100"),
      row("C", "0,0030 USD", "ai=chat in=1 out=1"),
    ].join("\n");
    expect(priceIssues(pricedRows(doc), tools)).toEqual([]);
  });

  it("reports a wrong price, a missing price, an unknown job and a wrong order", () => {
    const doc = [
      row("A", "0,10 USD", "ai=chat in=50 out=100"),
      row("B", "", "ai=analysis in=100 out=100"),
      row("C", "0,01 USD", "ai=gone in=1 out=1"),
    ].join("\n");
    expect(priceIssues(pricedRows(doc), tools)).toEqual([
      "docs/funkce.md:1: shows 0.1 USD, the tokens give 0.25 USD",
      "docs/funkce.md:2: no price in USD on the row (tokens give 0.3000 USD)",
      "docs/funkce.md:2: costs more than the row above (line 1); sort from the most expensive",
      'docs/funkce.md:3: unknown AI job "gone"',
    ]);
  });
});

describe("docs/funkce.md", () => {
  const root = path.resolve(__dirname, "../..");
  const markdown = readFileSync(path.join(root, "docs/funkce.md"), "utf8");

  it("describes every section, page, Jarvis catalog entry and plan limit of the code", () => {
    const expected = expectedKeys(root);
    const keys = docKeys(markdown);
    expect(missingKeys(expected, keys).map((item) => item.key)).toEqual([]);
    expect(staleKeys(expected, keys)).toEqual([]);
  });

  it("shows Jarvis prices that match the tokens and src/config/costs.ts, most expensive first", () => {
    const rows = pricedRows(markdown);
    expect(rows.length).toBeGreaterThan(0);
    expect(priceIssues(rows, PRICE_TOOLS)).toEqual([]);
  });
});
