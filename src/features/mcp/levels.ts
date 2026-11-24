import type { ToolLevel } from "@/features/grady/tools/types";

/**
 * How much a connected app (an MCP client such as Claude, 28.8) may do,
 * chosen by the person on the consent screen and changeable in Settings →
 * Connected apps. Each level adds to the one before:
 * - read: only the reading tools,
 * - write: plus the changes that can be taken back,
 * - full: plus deleting (into the trash), sending e-mails and messages,
 *   issuing invoices and the other steps that reach people or money.
 * On top of the level, the tool must be one the account may use in the
 * space (toolsFor, the same rights as the app); the level never adds a right.
 */
export const MCP_LEVELS = ["read", "write", "full"] as const;
export type McpLevel = (typeof MCP_LEVELS)[number];

export function isMcpLevel(value: unknown): value is McpLevel {
  return typeof value === "string" && (MCP_LEVELS as readonly string[]).includes(value);
}

const ALLOWED: Record<McpLevel, readonly ToolLevel[]> = {
  read: ["read"],
  write: ["read", "write"],
  full: ["read", "write", "delete"],
};

/** Whether a client of this level gets a tool of this level. */
export function levelAllows(level: McpLevel, tool: ToolLevel): boolean {
  return ALLOWED[level].includes(tool);
}

/** OAuth scopes, one per tool level; a level grants its own and those below. */
export const MCP_SCOPES = ["gradus.read", "gradus.write", "gradus.delete"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export function scopesOf(level: McpLevel): McpScope[] {
  return ALLOWED[level].map((tool) => `gradus.${tool}` as McpScope);
}

export function scopeString(level: McpLevel): string {
  return scopesOf(level).join(" ");
}

/**
 * The level a client asks for in `scope` (to preselect on the consent screen):
 * the highest scope it names; none or unknown = "write", the usual choice.
 */
export function levelFromScope(scope: string | null | undefined): McpLevel {
  const asked = new Set((scope ?? "").split(/\s+/).filter(Boolean));
  if (asked.has("gradus.delete")) return "full";
  if (asked.has("gradus.write")) return "write";
  if (asked.has("gradus.read")) return "read";
  return "write";
}

/** The lowest level that has a tool of this level (for "insufficient_scope"). */
export function levelFor(tool: ToolLevel): McpLevel {
  return tool === "read" ? "read" : tool === "write" ? "write" : "full";
}
