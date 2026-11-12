import { z } from "zod";
import { contactTools } from "./defs/contacts";
import { financeTools, invoiceTools } from "./defs/finance";
import { milestoneTools } from "./defs/milestones";
import { noteTools } from "./defs/notes";
import { chatTools, companyTools } from "./defs/people";
import { pipelineTools } from "./defs/pipeline";
import { readTools } from "./defs/read";
import { schedulerTools, settingsTools } from "./defs/settings";
import { calendarTools, crmTaskTools } from "./defs/work";
import type { AnyTool } from "./types";

/**
 * Every tool Grady has, in a fixed order (the list is part of the cached
 * prompt, so it must not change between calls of the same account). Out of
 * the catalog on purpose: subscription, payments, promo codes, deleting the
 * account, password and e-mail, administration, user_roles and the export
 * of the account's data.
 */
export const GRADY_TOOLS: readonly AnyTool[] = [
  ...readTools,
  ...milestoneTools,
  ...noteTools,
  ...contactTools,
  ...pipelineTools,
  ...crmTaskTools,
  ...calendarTools,
  ...schedulerTools,
  ...financeTools,
  ...invoiceTools,
  ...chatTools,
  ...companyTools,
  ...settingsTools,
];

const BY_NAME = new Map(GRADY_TOOLS.map((tool) => [tool.name, tool]));

export function toolByName(name: string): AnyTool | null {
  return BY_NAME.get(name) ?? null;
}

/** The tool as the Messages API takes it: name, description and the JSON schema of its input. */
export function modelToolOf(tool: AnyTool): {
  name: string;
  description: string;
  input_schema: { type: "object"; [key: string]: unknown };
} {
  const schema = z.toJSONSchema(tool.input, { io: "input", unrepresentable: "any" }) as Record<
    string,
    unknown
  >;
  delete schema.$schema;
  return {
    name: tool.name,
    description: `${tool.description}${tool.risk === "confirm" ? " The user confirms this change on a card before it runs." : ""}`,
    input_schema: { ...schema, type: "object" },
  };
}
