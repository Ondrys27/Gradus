import { z } from "zod";
import type { Workspace } from "@/features/account/workspace";
import { toolsFor } from "@/features/grady/tools/access";
import { toolLevel, type AnyTool, type ToolLevel } from "@/features/grady/tools/types";
import { levelAllows, type McpLevel } from "./levels";

/**
 * The tools of the MCP server (28.8): Grady's catalog (GRADY_TOOLS, one
 * definition, two uses), filtered twice — what the account may do in the
 * space now (toolsFor, the app's rights, read-only mode) and what the
 * client's level allows — plus two of the server's own, whoami and
 * switch_space. Pure: the route runs them.
 */

/** The shape of a tool in tools/list (MCP 2025-06-18 / 2025-11-25). */
export type McpToolInfo = {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; [key: string]: unknown };
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
};

/** Steps whose effect leaves Gradus (an e-mail, a message, a number of the series, money). */
const OUTWARD =
  /^(send_|issue_invoice$|cancel_invoice$|mark_invoice_paid$|confirm_booking$|decline_booking$|cancel_booking$)/;

export function isOutward(name: string): boolean {
  return OUTWARD.test(name);
}

/** Grady's wording about his cards and their Undo, as a connected client sees it. */
export function mcpDescription(tool: AnyTool): string {
  let text = tool.description
    .replace(/\s*The user (sees the full text and )?confirms it first\./g, "")
    .replace(/; the user sees it on the card and confirms before it is sent\./g, ".")
    .replace(/\s*Never call it on your own initiative\./g, "")
    .replace(
      /Undo( on the card)? brings (it|them) back for 24 hours/g,
      "restore_from_trash brings $2 back",
    )
    .replace(/one entered by hand comes back with Undo for 24 hours/g, "it goes to the trash")
    .trim();
  const level = toolLevel(tool);
  if (level === "delete") {
    text += isOutward(tool.name)
      ? " Full access only. Irreversible outside Gradus: ask the user to confirm this exact step before calling it."
      : " Full access only. Ask the user to confirm before calling it; what it deletes goes to the trash (list_trash, restore_from_trash).";
  }
  return text;
}

function titleOf(name: string): string {
  const words = name.split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function schemaOf(input: z.ZodType): McpToolInfo["inputSchema"] {
  const schema = z.toJSONSchema(input, { io: "input", unrepresentable: "any" }) as Record<
    string,
    unknown
  >;
  delete schema.$schema;
  return { ...schema, type: "object" };
}

export function mcpToolOf(tool: AnyTool): McpToolInfo {
  const level = toolLevel(tool);
  const title = titleOf(tool.name);
  return {
    name: tool.name,
    title,
    description: mcpDescription(tool),
    inputSchema: schemaOf(tool.input),
    annotations: {
      title,
      readOnlyHint: level === "read",
      destructiveHint: level === "delete",
      idempotentHint: level === "read",
      openWorldHint: isOutward(tool.name),
    },
  };
}

// ---------------------------------------------------------------------------
// The server's own tools
// ---------------------------------------------------------------------------

export const whoamiInput = z.object({});
export const switchSpaceInput = z.object({
  spaceId: z
    .uuid()
    .optional()
    .describe("The company to act in from now on; leave out to list the companies."),
});

export const OWN_TOOLS = ["whoami", "switch_space"] as const;
export type OwnTool = (typeof OWN_TOOLS)[number];

export function isOwnTool(name: string): name is OwnTool {
  return (OWN_TOOLS as readonly string[]).includes(name);
}

const OWN_INFO: Record<OwnTool, { description: string; input: z.ZodType }> = {
  whoami: {
    description:
      "Who this connection acts as: the user, the company (space) it works in, the user's role and rights there, the access level of this connection (read / write / full) and whether the company is read-only. Call it first when unsure what you may do. Example: whoami {}.",
    input: whoamiInput,
  },
  switch_space: {
    description:
      'List the companies this connection may work in (the user allowed them when connecting), or switch to one of them by spaceId. Every later call acts in the chosen company with the user\'s rights there. A company not allowed when connecting needs a new connection. Example: switch_space {} lists them; switch_space {"spaceId": "…"} switches.',
    input: switchSpaceInput,
  },
};

function ownToolInfo(name: OwnTool): McpToolInfo {
  const title = titleOf(name);
  return {
    name,
    title,
    description: OWN_INFO[name].description,
    inputSchema: schemaOf(OWN_INFO[name].input),
    annotations: {
      title,
      readOnlyHint: name === "whoami",
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}

/** Whether a catalog tool is offered to this client in this space. */
export function mcpToolAllowed(
  tool: AnyTool,
  workspace: Workspace,
  level: McpLevel,
  open: boolean,
): boolean {
  if (!open) return false;
  return levelAllows(level, toolLevel(tool)) && toolsFor(workspace, [tool]).length === 1;
}

/**
 * tools/list: the server's own tools, then the catalog's in catalog order
 * (stable, so a client can cache it). `open` = connected apps are allowed in
 * this space (the company's switch, the worker's right, the plan); when not,
 * only whoami and switch_space remain.
 */
export function mcpTools(
  catalog: readonly AnyTool[],
  workspace: Workspace,
  level: McpLevel,
  open: boolean,
): McpToolInfo[] {
  return [
    ...OWN_TOOLS.map(ownToolInfo),
    ...catalog.filter((tool) => mcpToolAllowed(tool, workspace, level, open)).map(mcpToolOf),
  ];
}

/** Why a call of a catalog tool is refused, or null when it may run. */
export function refusalOf(
  tool: AnyTool | null,
  workspace: Workspace,
  level: McpLevel,
  open: boolean,
): {
  code: "unknownTool" | "mcpDisabled" | "insufficientLevel" | "readOnly" | "forbidden";
  needs?: ToolLevel;
} | null {
  if (!tool) return { code: "unknownTool" };
  if (!open) return { code: "mcpDisabled" };
  const needs = toolLevel(tool);
  if (!levelAllows(level, needs)) return { code: "insufficientLevel", needs };
  if (toolsFor(workspace, [tool]).length === 0) {
    return { code: workspace.readOnly && tool.kind === "write" ? "readOnly" : "forbidden" };
  }
  return null;
}
