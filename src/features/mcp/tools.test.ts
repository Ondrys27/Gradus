import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { workspaceFor, type Workspace } from "@/features/account/workspace";
import { toolAllowed } from "@/features/grady/tools/access";
import { toolLevel } from "@/features/grady/tools/types";
import { templateGrants } from "@/features/workers/permissions-catalog";
import { levelAllows, MCP_LEVELS, type McpLevel } from "./levels";

vi.mock("server-only", () => ({}));

const { GRADY_TOOLS, toolByName } = await import("@/features/grady/tools/catalog");
const { isOutward, mcpDescription, mcpToolAllowed, mcpTools, refusalOf, OWN_TOOLS } =
  await import("./tools");

const OWNER = "00000000-0000-4000-8000-000000000001";
const ACCOUNT = "00000000-0000-4000-8000-000000000002";
const worker = { id: "00000000-0000-4000-8000-0000000000aa", ownerId: OWNER };

const ROLES: Record<string, Workspace> = {
  owner: workspaceFor(OWNER, null),
  ownerReadOnly: workspaceFor(OWNER, null, undefined, true),
  assistant: workspaceFor(ACCOUNT, worker, templateGrants("assistant")),
  sales: workspaceFor(ACCOUNT, worker, templateGrants("sales")),
  accountant: workspaceFor(ACCOUNT, worker, templateGrants("accountant")),
};

describe("MCP tools: every tool × level × role", () => {
  for (const [role, workspace] of Object.entries(ROLES)) {
    for (const level of MCP_LEVELS) {
      it(`${role} at ${level}: exactly the app's rights, cut by the level`, () => {
        const listed = new Set(
          mcpTools(GRADY_TOOLS, workspace, level, true).map((tool) => tool.name),
        );
        for (const tool of GRADY_TOOLS) {
          const expected = levelAllows(level, toolLevel(tool)) && toolAllowed(workspace, tool);
          expect(listed.has(tool.name), `${tool.name}`).toBe(expected);
          expect(mcpToolAllowed(tool, workspace, level, true), tool.name).toBe(expected);
          // A call is refused exactly when the tool is not listed.
          expect(refusalOf(tool, workspace, level, true) === null, tool.name).toBe(expected);
        }
        for (const own of OWN_TOOLS) expect(listed.has(own)).toBe(true);
      });
    }
  }

  it("a worker gets nothing above their rights at any level", () => {
    const assistant = new Set(
      mcpTools(GRADY_TOOLS, ROLES.assistant, "full", true).map((t) => t.name),
    );
    for (const name of [
      "list_deals",
      "delete_deal",
      "finance_month",
      "issue_invoice",
      "send_invoice",
      "set_worker_permissions",
      "remove_worker",
      "update_settings",
    ]) {
      expect(assistant.has(name), name).toBe(false);
    }
    expect(refusalOf(toolByName("list_deals"), ROLES.assistant, "full", true)?.code).toBe(
      "forbidden",
    );
    expect(assistant.has("create_crm_task")).toBe(true);
  });

  it("read only lists only reading tools; read-only mode only reads whatever the level", () => {
    // switch_space changes only the connection's company, never data.
    const data = (list: ReturnType<typeof mcpTools>) =>
      list.filter((tool) => tool.name !== "switch_space");
    for (const tool of data(mcpTools(GRADY_TOOLS, ROLES.owner, "read", true))) {
      expect(tool.annotations.readOnlyHint, tool.name).toBe(true);
    }
    for (const tool of data(mcpTools(GRADY_TOOLS, ROLES.ownerReadOnly, "full", true))) {
      expect(tool.annotations.readOnlyHint, tool.name).toBe(true);
    }
    expect(refusalOf(toolByName("create_crm_task"), ROLES.owner, "read", true)).toEqual({
      code: "insufficientLevel",
      needs: "write",
    });
    expect(refusalOf(toolByName("create_crm_task"), ROLES.ownerReadOnly, "full", true)?.code).toBe(
      "readOnly",
    );
  });

  it("deleting, sending and issuing only with full access, marked destructive and asking for confirmation", () => {
    const write = new Set(mcpTools(GRADY_TOOLS, ROLES.owner, "write", true).map((t) => t.name));
    for (const name of ["delete_deal", "send_invoice", "issue_invoice", "send_chat_message"]) {
      expect(write.has(name), name).toBe(false);
    }
    const full = mcpTools(GRADY_TOOLS, ROLES.owner, "full", true);
    for (const name of ["send_invoice", "issue_invoice"]) {
      const tool = full.find((item) => item.name === name)!;
      expect(tool.annotations.destructiveHint).toBe(true);
      expect(tool.annotations.openWorldHint).toBe(true);
      expect(tool.description).toMatch(/ask the user to confirm/i);
      expect(isOutward(name)).toBe(true);
    }
    expect(full.find((item) => item.name === "delete_deal")?.description).toMatch(/trash/);
  });

  it("switched off in the company (switch, right or plan): only whoami and switch_space", () => {
    expect(mcpTools(GRADY_TOOLS, ROLES.owner, "full", false).map((tool) => tool.name)).toEqual([
      ...OWN_TOOLS,
    ]);
    expect(refusalOf(toolByName("list_milestones"), ROLES.owner, "full", false)?.code).toBe(
      "mcpDisabled",
    );
    expect(refusalOf(null, ROLES.owner, "full", true)?.code).toBe("unknownTool");
  });

  it("describes tools without Grady's cards, with valid names and object schemas", () => {
    for (const level of MCP_LEVELS as readonly McpLevel[]) {
      for (const tool of mcpTools(GRADY_TOOLS, ROLES.owner, level, true)) {
        expect(tool.name).toMatch(/^[a-z][a-z0-9_]{1,63}$/);
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.description).not.toMatch(/the user confirms it first|on the card/i);
        expect(tool.title.length).toBeGreaterThan(2);
      }
    }
    expect(mcpDescription(toolByName("delete_crm_task")!)).toContain("restore_from_trash");
  });

  it("docs/mcp.md lists every tool under its level", () => {
    const doc = readFileSync(path.resolve(__dirname, "../../../docs/mcp.md"), "utf8");
    for (const name of OWN_TOOLS) expect(doc, name).toContain(`| \`${name}\` |`);
    for (const level of ["read", "write", "delete"] as const) {
      const section = doc.split(`(\`${level}\`)`)[1]?.split("###")[0] ?? "";
      for (const tool of GRADY_TOOLS.filter((item) => toolLevel(item) === level)) {
        expect(section, `${tool.name} under ${level}`).toContain(`| \`${tool.name}\` |`);
      }
    }
  });
});
