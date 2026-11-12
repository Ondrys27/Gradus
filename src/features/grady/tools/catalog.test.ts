import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import {
  actionsOf,
  isGrantSection,
  PERMISSION_CATALOG,
} from "@/features/workers/permissions-catalog";
import { QUERY_ROOTS } from "../actions";

vi.mock("server-only", () => ({}));

const { GRADY_TOOLS, modelToolOf, toolByName } = await import("./catalog");

/** A change that can not be taken back by a click, or that reaches people or money. */
const MUST_CONFIRM =
  /^(delete_|remove_|send_|issue_|cancel_|trash_|invite_|complete_milestone$|mark_invoice_paid$|confirm_booking$|decline_booking$)/;

/** What Grady never touches (CLAUDE.md, 26.2): none of it may appear in a tool. */
const OUT_OF_CATALOG =
  /subscription|payment_method|checkout|promo|password|e_?mail_change|account|admin|role|export|billing|plan_catalog/;

/** Every placeholder a card line may have. */
const SAMPLE_VALUES = {
  title: "X",
  name: "X",
  count: 2,
  query: "X",
  kind: "deal",
  type: "call",
  table: "X",
  stage: "X",
  amount: "1",
  row: "X",
  week: 1,
  milestone: "X",
  total: "1",
  number: "1",
  to: "x@example.com",
  section: "pipeline",
  when: "1. 1.",
};

const SECTIONS = new Set<string>([...PERMISSION_CATALOG.map((section) => section.key), "chat"]);

describe("Grady's tool catalog", () => {
  it("has unique snake_case names", () => {
    const names = GRADY_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]{1,63}$/);
    expect(toolByName("create_milestone")?.name).toBe("create_milestone");
    expect(toolByName("nope")).toBeNull();
  });

  it("every tool has a JSON schema, a section and a right of the permission catalog", () => {
    for (const tool of GRADY_TOOLS) {
      const model = modelToolOf(tool);
      expect(model.input_schema.type, tool.name).toBe("object");
      expect(model.description.length, tool.name).toBeGreaterThan(20);
      expect(SECTIONS.has(tool.section), `${tool.name}: ${tool.section}`).toBe(true);
      if (isGrantSection(tool.section)) {
        expect(tool.action, tool.name).not.toBeNull();
        expect(actionsOf(tool.section) as readonly string[], tool.name).toContain(tool.action);
      } else {
        // Notes, settings and the dashboard have no rights; Messages go by conversation.
        expect(tool.action, tool.name).toBeNull();
      }
      if (tool.alsoAllowedBy && isGrantSection(tool.alsoAllowedBy.section)) {
        expect(actionsOf(tool.alsoAllowedBy.section) as readonly string[]).toContain(
          tool.alsoAllowedBy.action,
        );
      }
      for (const root of tool.invalidates) expect(QUERY_ROOTS as readonly string[]).toContain(root);
    }
  });

  it("deleting, sending, issuing, cancelling, inviting, removing and completing a milestone wait for Confirm", () => {
    const confirm = GRADY_TOOLS.filter((tool) => MUST_CONFIRM.test(tool.name));
    expect(confirm.length).toBeGreaterThan(10);
    for (const tool of confirm) expect(tool.risk, tool.name).toBe("confirm");
    expect(toolByName("complete_milestone")?.risk).toBe("confirm");
    expect(toolByName("delete_contact")?.risk).toBe("confirm");
    expect(toolByName("send_chat_message")?.risk).toBe("confirm");
  });

  it("reading tools never change anything and are never proposals", () => {
    for (const tool of GRADY_TOOLS.filter((item) => item.kind === "read")) {
      expect(tool.risk, tool.name).toBe("instant");
      expect(tool.undoable, tool.name).toBe(false);
    }
  });

  it("keeps subscription, payments, promo codes, the account, administration and roles out", () => {
    for (const tool of GRADY_TOOLS) expect(tool.name, tool.name).not.toMatch(OUT_OF_CATALOG);
    // The only settings tool changes the user's own display and Grady preferences.
    expect(
      GRADY_TOOLS.filter((tool) => tool.section === "settings").map((tool) => tool.name),
    ).toEqual(["update_settings"]);
    const settings = modelToolOf(toolByName("update_settings")!).input_schema as unknown as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(settings.properties)).not.toContain("email");
    expect(Object.keys(settings.properties)).not.toContain("locale");
  });

  it("company structure and rights are the owner's alone", () => {
    for (const name of [
      "move_worker",
      "save_worker_group",
      "set_worker_permissions",
      "remove_worker",
    ]) {
      expect(toolByName(name)?.ownerOnly, name).toBe(true);
    }
  });

  it("every tool has its progress line, and every card line exists, in both languages", () => {
    // The keys the definitions ask for (t("…") and the booking steps), read from their source.
    const dir = path.resolve(__dirname, "defs");
    const source = readdirSync(dir)
      .map((file) => readFileSync(path.join(dir, file), "utf8"))
      .join("\n");
    const keys = new Set(
      [...source.matchAll(/\bt\("([a-z_]+)"/g), ...source.matchAll(/: "([a-z]+_booking)"/g)].map(
        (match) => match[1],
      ),
    );
    for (const step of ["confirm", "decline", "cancel"]) keys.add(`${step}_booking`);
    keys.add("bulk");
    expect(keys.size).toBeGreaterThan(60);
    for (const messages of [cs, en]) {
      const t = createTranslator({ locale: "en", messages, namespace: "grady.tools" });
      const tools = (messages as { grady: { tools: Record<string, unknown> } }).grady.tools;
      const progress = tools.progress as Record<string, string>;
      for (const tool of GRADY_TOOLS)
        expect(progress[tool.name], `progress.${tool.name}`).toBeTruthy();
      for (const key of keys) {
        expect(typeof tools[key], key).toBe("string");
        expect(t(key as never, SAMPLE_VALUES as never), key).not.toMatch(/grady\.tools/);
      }
    }
  });
});
