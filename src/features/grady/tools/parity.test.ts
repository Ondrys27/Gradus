import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { workspaceFor } from "@/features/account/workspace";
import { templateGrants } from "@/features/workers/permissions-catalog";
import { toolAllowed } from "./access";
import { toolLevel, TOOL_LEVELS } from "./types";

vi.mock("server-only", () => ({}));

const { GRADY_TOOLS } = await import("./catalog");

/**
 * Parity (28.7): Grady may do for each user exactly what that user may do.
 * docs/grady-operace.md is the table of what the app does, the operation,
 * the right, the level and whether it can be taken back; this test keeps it
 * and the catalog in step, and checks for every operation and two roles (the
 * owner, a worker with the Assistant template) that the tools offered are
 * exactly those the table says.
 */

const OWNER = "00000000-0000-4000-8000-000000000001";
const ASSISTANT = "00000000-0000-4000-8000-000000000002";
const worker = { id: "00000000-0000-4000-8000-000000000003", ownerId: OWNER };

type Row = {
  action: string;
  tool: string;
  right: string;
  level: string;
  undoable: string;
  owner: string;
  assistant: string;
};

function tableRows(): Row[] {
  const doc = readFileSync(path.resolve(__dirname, "../../../../docs/grady-operace.md"), "utf8");
  const section = doc.split("## Operace")[1]?.split("\n## ")[0] ?? "";
  return section
    .split("\n")
    .filter((line) => /^\| .*`[a-z_]+`/.test(line))
    .map((line) => {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      return {
        action: cells[0],
        tool: cells[1].replace(/`/g, ""),
        right: cells[2],
        level: cells[3],
        undoable: cells[4],
        owner: cells[5],
        assistant: cells[6],
      };
    });
}

const yes = (value: boolean) => (value ? "ano" : "ne");
const rightOf = (tool: (typeof GRADY_TOOLS)[number]) =>
  tool.action ? `${tool.section}.${tool.action}` : tool.section;

/** Writes that are not taken back by Undo, and why (anything else must be). */
const WRITES_WITHOUT_UNDO: Record<string, string> = {
  move_contact: "a move is a step of the contact's history; moving back is a move of its own",
  share_note: "the person it was shared with may already have it open",
};

describe("docs/grady-operace.md and the catalog", () => {
  const rows = tableRows();

  it("lists every operation exactly once, and nothing that is not one", () => {
    const listed = rows.map((row) => row.tool);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(GRADY_TOOLS.map((tool) => tool.name).sort());
  });

  it.each(GRADY_TOOLS.map((tool) => [tool.name, tool] as const))(
    "%s: right, level and Undo as the table says",
    (_name, tool) => {
      const row = rows.find((item) => item.tool === tool.name)!;
      expect(row.action.length).toBeGreaterThan(3);
      expect(row.right).toBe(rightOf(tool));
      expect(row.level).toBe(toolLevel(tool));
      expect(row.undoable).toBe(yes(tool.undoable));
    },
  );
});

describe("allowed or refused by the rights, per role", () => {
  const rows = tableRows();
  const owner = workspaceFor(OWNER, null);
  const assistant = workspaceFor(ASSISTANT, worker, templateGrants("assistant"));

  it.each(GRADY_TOOLS.map((tool) => [tool.name, tool] as const))("%s", (_name, tool) => {
    const row = rows.find((item) => item.tool === tool.name)!;
    expect(yes(toolAllowed(owner, tool)), "owner").toBe(row.owner);
    expect(yes(toolAllowed(assistant, tool)), "assistant").toBe(row.assistant);
  });

  it("a read-only space keeps only the reading operations, for both", () => {
    for (const ws of [
      workspaceFor(OWNER, null, undefined, true),
      workspaceFor(ASSISTANT, worker, templateGrants("assistant"), true),
    ]) {
      for (const tool of GRADY_TOOLS) {
        if (toolAllowed(ws, tool)) expect(toolLevel(tool), tool.name).toBe("read");
      }
    }
  });

  it("the assistant gets nothing of the sections the template leaves out", () => {
    for (const tool of GRADY_TOOLS) {
      if (["pipeline", "finance", "invoices", "scheduler", "settings"].includes(tool.section)) {
        expect(toolAllowed(assistant, tool), tool.name).toBe(false);
      }
    }
  });
});

describe("levels for outside clients (MCP, 28.8)", () => {
  it("every tool has a level; reading tools read, everything that waits for Confirm and is not undoable is 'delete'", () => {
    for (const tool of GRADY_TOOLS) {
      const level = toolLevel(tool);
      expect(TOOL_LEVELS, tool.name).toContain(level);
      if (tool.kind === "read") expect(level, tool.name).toBe("read");
      else expect(level, tool.name).not.toBe("read");
      if (tool.kind === "write" && tool.risk === "confirm" && !tool.undoable) {
        if (!(tool.name in WRITES_WITHOUT_UNDO)) expect(level, tool.name).toBe("delete");
      }
      if (/^(delete_|trash_|send_|issue_|cancel_|remove_)/.test(tool.name)) {
        expect(level, tool.name).toBe("delete");
      }
    }
  });

  it("writes are undoable, except the listed ones", () => {
    for (const tool of GRADY_TOOLS) {
      if (toolLevel(tool) !== "write") continue;
      if (tool.name in WRITES_WITHOUT_UNDO) expect(tool.undoable, tool.name).toBe(false);
      else expect(tool.undoable, tool.name).toBe(true);
    }
  });
});

describe("the deleted() record of a tool", () => {
  it("keeps what a client may write and what the database sets on insert", async () => {
    const { deleted } = await import("./defs/shared");
    const record = deleted(
      "crm_tasks",
      "t1",
      { id: "t1", user_id: "s", title: "Call", description: undefined },
      { status: "done", completion_note: null },
    );
    expect(record).toEqual({
      table: "crm_tasks",
      match: { id: "t1" },
      op: "delete",
      row: { user_id: "s", title: "Call" },
      then: { status: "done", completion_note: null },
    });
  });
});
