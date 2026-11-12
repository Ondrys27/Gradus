import { can, type Workspace } from "@/features/account/workspace";
import { isGrantAction, isGrantSection } from "@/features/workers/permissions-catalog";
import type { AnyTool, ToolSection } from "./types";

/**
 * Which tools the model gets: only what the account may do in the active
 * space, by the same rules as useCan() in the app (the database enforces
 * them again on every write). A worker gets only their own rights; in a
 * read-only space only the reading tools are offered.
 */

type Right = { section: ToolSection; action: string | null };

function rightHolds(workspace: Workspace, { section, action }: Right, write: boolean): boolean {
  // Messages: every member of the space, conversation by conversation (RLS).
  if (section === "chat") return !(write && workspace.readOnly);
  // The account's own settings and notes: never a company's.
  if (section === "settings" || section === "notes") {
    if (write && workspace.readOnly) return false;
    return workspace.role === "owner";
  }
  if (section === "dashboard") return true;
  if (!isGrantSection(section) || !action || !isGrantAction(section, action)) return false;
  return can(workspace, section, action as never);
}

export function toolAllowed(workspace: Workspace, tool: AnyTool): boolean {
  const write = tool.kind === "write";
  if (write && workspace.readOnly) return false;
  if (tool.ownerOnly && workspace.role !== "owner") return false;
  if (tool.ownSpaceOnly && workspace.id !== workspace.userId) return false;
  // A right to change always comes with the right to see the section.
  const view: Right = { section: tool.section, action: tool.section === "chat" ? null : "view" };
  const own: Right = { section: tool.section, action: tool.action };
  const main =
    (tool.action === null || tool.action === "view" || rightHolds(workspace, view, false)) &&
    rightHolds(workspace, own, write);
  if (main) return true;
  const alt = tool.alsoAllowedBy;
  return Boolean(
    alt &&
    rightHolds(workspace, { section: alt.section, action: "view" }, false) &&
    rightHolds(workspace, alt, write),
  );
}

/** The tools of the catalog the account may use now, in catalog order (a stable, cacheable list). */
export function toolsFor<T extends AnyTool>(workspace: Workspace, catalog: readonly T[]): T[] {
  return catalog.filter((tool) => toolAllowed(workspace, tool));
}
