import { describe, expect, it } from "vitest";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import { accessSentences, accessSummary } from "./access-summary";
import { grantsFromRows, templateGrants, type PermissionGrants } from "./permissions-catalog";

function translator(messages: typeof cs) {
  const root = messages.workers.access as unknown as Record<string, unknown>;
  return (key: string, values: Record<string, string> = {}) => {
    const text = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], root);
    if (typeof text !== "string") throw new Error(`missing workers.access.${key}`);
    return text.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? "");
  };
}

const name = (section: string) => section.toUpperCase();

describe("accessSummary", () => {
  it("says a cold caller sees Cold Calling and their tasks, nothing of money or deals", () => {
    const summary = accessSummary(templateGrants("coldCaller"));
    expect(summary.lines.map((line) => line.section)).toEqual(["tasks", "cold_calling", "company", "integrations"]);
    expect(summary.lines.find((line) => line.section === "cold_calling")?.actions).toEqual(["call"]);
    expect(summary.lines.find((line) => line.section === "tasks")?.scope).toBe("own");
    expect(summary.hidden).toEqual(expect.arrayContaining(["pipeline", "finance", "invoices", "contacts"]));
    expect(summary.hidden).not.toContain("integrations");
  });

  it("names the scope of deals and every allowed action in catalog order", () => {
    const line = accessSummary(templateGrants("accountant")).lines.find((entry) => entry.section === "pipeline");
    expect(line).toEqual({ section: "pipeline", scope: "all", actions: ["see_amounts"] });
    const sales = accessSummary(templateGrants("sales")).lines.find((entry) => entry.section === "pipeline");
    expect(sales?.scope).toBe("own");
    expect(sales?.actions).toEqual(["see_amounts", "create", "update", "change_stage", "change_amount"]);
  });

  it("leaves connected apps out while connecting one is off", () => {
    const grants: PermissionGrants = { integrations: ["view"], tasks: ["view"] };
    expect(accessSummary(grants).lines.map((line) => line.section)).toEqual(["tasks"]);
  });

  it("starts a new worker without a choice on their own tasks and branch only", () => {
    const summary = accessSummary(grantsFromRows([]));
    expect(summary.lines.map((line) => line.section)).toEqual(["tasks", "company", "integrations"]);
  });
});

describe("accessSentences", () => {
  it.each([
    ["cs", cs],
    ["en", en],
  ] as const)("has a text for every action and scope (%s)", (_lang, messages) => {
    const all = accessSentences(templateGrants("all"), translator(messages), name);
    expect(all.lines.length).toBeGreaterThan(5);
    expect(all.hidden).toBeNull();
    for (const template of ["sales", "coldCaller", "assistant", "accountant"] as const) {
      const sentences = accessSentences(templateGrants(template), translator(messages), name);
      expect(sentences.hidden).toBeTruthy();
      expect(sentences.always.length).toBeGreaterThan(10);
    }
  });

  it("reads as plain words", () => {
    const sentences = accessSentences(templateGrants("coldCaller"), translator(cs), name);
    expect(sentences.lines).toContain("COLD_CALLING: volat a posouvat kontakty");
    expect(sentences.lines).toContain("TASKS: jen to tvoje, zakládat, upravovat");
    expect(sentences.hidden).toContain("FINANCE");
    const viewOnly = accessSentences({ contacts: ["view"] }, translator(cs), name);
    expect(viewOnly.lines).toEqual(["CONTACTS: jen prohlížet"]);
  });
});
