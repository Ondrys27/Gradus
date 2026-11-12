import { describe, expect, it, vi } from "vitest";
import { workspaceFor } from "@/features/account/workspace";
import type { PermissionGrants } from "@/features/workers/permissions-catalog";
import { toolAllowed, toolsFor } from "./access";

vi.mock("server-only", () => ({}));

const { GRADY_TOOLS } = await import("./catalog");

const OWNER = "00000000-0000-4000-8000-000000000001";
const WORKER_ACCOUNT = "00000000-0000-4000-8000-000000000002";
const worker = { id: "00000000-0000-4000-8000-000000000003", ownerId: OWNER };

const names = (list: { name: string }[]) => list.map((tool) => tool.name);

describe("tools offered to the model", () => {
  it("the owner in their own space gets every tool", () => {
    const tools = toolsFor(workspaceFor(OWNER, null), GRADY_TOOLS);
    expect(tools.length).toBe(GRADY_TOOLS.length);
  });

  it("a read-only space gets only the reading tools", () => {
    const tools = toolsFor(workspaceFor(OWNER, null, undefined, true), GRADY_TOOLS);
    expect(tools.length).toBeGreaterThan(5);
    for (const tool of tools) expect(tool.kind, tool.name).toBe("read");
    expect(names(tools)).not.toContain("create_milestone");
    expect(names(tools)).not.toContain("update_settings");
  });

  it("a worker without pipeline rights never gets a pipeline tool", () => {
    const grants: PermissionGrants = {
      milestones: ["view", "update"],
      contacts: ["view", "create"],
    };
    const tools = names(toolsFor(workspaceFor(WORKER_ACCOUNT, worker, grants), GRADY_TOOLS));
    for (const tool of GRADY_TOOLS.filter((item) => item.section === "pipeline")) {
      expect(tools, tool.name).not.toContain(tool.name);
    }
    expect(tools).toContain("create_milestone");
    expect(tools).toContain("create_contact");
    expect(tools).not.toContain("delete_contact");
  });

  it("a worker gets exactly the rights granted: seeing the pipeline is not changing it", () => {
    const view = names(
      toolsFor(workspaceFor(WORKER_ACCOUNT, worker, { pipeline: ["view"] }), GRADY_TOOLS),
    );
    expect(view).toContain("list_deals");
    expect(view).not.toContain("create_deal");
    expect(view).not.toContain("move_deal_stage");
    const move = names(
      toolsFor(
        workspaceFor(WORKER_ACCOUNT, worker, { pipeline: ["view", "change_stage"] }),
        GRADY_TOOLS,
      ),
    );
    expect(move).toContain("move_deal_stage");
    expect(move).not.toContain("delete_deal");
  });

  it("in a company there are no notes, settings, company structure or finance without the right", () => {
    const tools = names(
      toolsFor(workspaceFor(WORKER_ACCOUNT, worker, { tasks: ["view"] }), GRADY_TOOLS),
    );
    for (const name of [
      "create_note",
      "update_settings",
      "move_worker",
      "set_worker_permissions",
      "save_transaction",
      "issue_invoice",
    ]) {
      expect(tools, name).not.toContain(name);
    }
    // Their own tasks and Messages are always theirs.
    expect(tools).toContain("list_crm_tasks");
    expect(tools).toContain("send_chat_message");
  });

  it("contacts open through cold calling too, as in the app", () => {
    const tools = names(
      toolsFor(
        workspaceFor(WORKER_ACCOUNT, worker, { cold_calling: ["view", "call"] }),
        GRADY_TOOLS,
      ),
    );
    expect(tools).toContain("move_contact");
    expect(tools).toContain("list_contact_tables");
    expect(tools).not.toContain("delete_contact");
  });

  it("a write tool is refused when read-only even for the owner", () => {
    const create = GRADY_TOOLS.find((tool) => tool.name === "create_deal")!;
    expect(toolAllowed(workspaceFor(OWNER, null), create)).toBe(true);
    expect(toolAllowed(workspaceFor(OWNER, null, undefined, true), create)).toBe(false);
  });
});
