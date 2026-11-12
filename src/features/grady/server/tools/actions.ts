import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { track } from "@/lib/analytics/track";
import type { Database, Json } from "@/types/database";
import {
  cardFromRow,
  CONFIRM_WINDOW_MS,
  storedResultOf,
  UNDO_WINDOW_MS,
  type StoredActionResult,
  type ActionAward,
  type ActionCard,
  type ActionStatus,
  type ToolRisk,
} from "../../actions";
import { toolAllowed } from "../../tools/access";
import { toolByName } from "../../tools/catalog";
import { stampRecords, undoRecords, type UndoRecord } from "../../tools/records";
import { ToolError, type AnyTool, type ToolContext } from "../../tools/types";

/**
 * Running Grady's tools and keeping their record (grady_actions). The
 * change itself always goes through the tool with the user's own client;
 * the admin client only writes the record, always with the session's user.
 */

type Admin = SupabaseClient<Database>;
type ActionRow = Database["public"]["Tables"]["grady_actions"]["Row"];

/** One call of a tool as the model made it (or as a bulk proposal lists it). */
export type ToolCall = { name: string; input: unknown };

/** More changes than this from one message wait for one confirmation of them all. */
export const BULK_THRESHOLD = 5;
/** The most changes one message may make. */
export const WRITES_PER_MESSAGE = 25;
export const BULK_TOOL = "bulk";

type StoredResult = Omit<StoredActionResult, "records" | "calls"> & {
  records?: UndoRecord[];
  calls?: ToolCall[];
};

export type ActionEnv = {
  ctx: ToolContext;
  admin: Admin;
  conversationId: string | null;
  messageId: string | null;
};

/** What the model reads back from a step: short, ids and statuses, never more. */
export type StepResult = { content: string; isError: boolean; card: ActionCard | null };

function resultOf(row: Pick<ActionRow, "result">): StoredResult {
  return storedResultOf(row) as StoredResult;
}

export const toCard = cardFromRow;

/** A failure as a short code: the tool's own, the database's known ones, else "failed". */
export function errorCodeOf(error: unknown): string {
  if (error instanceof ToolError) return error.code;
  const db = error as { code?: string; message?: string } | null;
  const message = db?.message ?? "";
  if (message.includes("read_only")) return "readOnly";
  if (db?.code === "42501" || message.includes("permission") || message.includes("forbidden"))
    return "forbidden";
  if (db?.code === "PGRST116" || db?.code === "22P02") return "notFound";
  if (db?.code === "23505") return "duplicate";
  if (db?.code === "23514" || db?.code === "22001") return "invalid";
  const named = /^[a-z][a-z0-9_]{2,40}$/.exec(message.trim());
  return named ? named[0] : "failed";
}

function errorText(error: unknown): string {
  if (error instanceof ToolError) return error.message;
  return "The change was refused.";
}

async function insertAction(
  env: ActionEnv,
  row: {
    tool: string;
    risk: ToolRisk;
    status: ActionStatus;
    input: unknown;
    result: StoredResult;
    error?: string | null;
  },
): Promise<ActionRow> {
  const { data, error } = await env.admin
    .from("grady_actions")
    .insert({
      user_id: env.ctx.userId,
      space_id: env.ctx.workspaceId,
      conversation_id: env.conversationId,
      message_id: env.messageId,
      tool: row.tool,
      risk: row.risk,
      status: row.status,
      input: (row.input ?? {}) as Json,
      result: row.result as unknown as Json,
      error: row.error ?? null,
      decided_at: row.status === "pending" ? null : new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

function sectionOf(tool: AnyTool | null): string {
  return tool?.section ?? BULK_TOOL;
}

/** A tool by name the account may use now, with its input checked; or why not. */
function resolve(
  ctx: ToolContext,
  call: ToolCall,
): { ok: true; tool: AnyTool; input: unknown } | { ok: false; code: string; message: string } {
  const tool = toolByName(call.name);
  if (!tool) return { ok: false, code: "unknownTool", message: "There is no such tool." };
  if (!toolAllowed(ctx.workspace, tool)) {
    return {
      ok: false,
      code: ctx.workspace.readOnly && tool.kind === "write" ? "readOnly" : "forbidden",
      message: "The user may not do this in this space.",
    };
  }
  const parsed = tool.input.safeParse(call.input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid",
      message: parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join("; "),
    };
  }
  return { ok: true, tool, input: parsed.data };
}

/** Runs one tool now: the change, its record, the card. */
async function runNow(env: ActionEnv, tool: AnyTool, input: unknown) {
  const outcome = await tool.execute(env.ctx, input);
  const records = outcome.records?.length ? await stampRecords(env.ctx.db, outcome.records) : [];
  return {
    outcome,
    result: {
      summary: outcome.summary ?? tool.describe(input, env.ctx.t),
      href: outcome.href ?? null,
      records,
      output: (outcome.output ?? null) as Json,
      awards: outcome.awards ?? [],
      invalidate: tool.invalidates,
      undoable: tool.undoable && records.length > 0,
    } satisfies StoredResult,
  };
}

/** A reading tool: runs, nothing is recorded, no card. */
async function runRead(env: ActionEnv, tool: AnyTool, input: unknown): Promise<StepResult> {
  try {
    const outcome = await tool.execute(env.ctx, input);
    return { content: JSON.stringify(outcome.output), isError: false, card: null };
  } catch (error) {
    const code = errorCodeOf(error);
    if (code === "failed") console.error(`grady tool ${tool.name} failed`, error);
    return {
      content: JSON.stringify({ error: code, message: errorText(error) }),
      isError: true,
      card: null,
    };
  }
}

/**
 * One call of a tool from the chat: a reading tool answers, an instant
 * change is made and recorded, a confirm change is prepared (names read
 * through RLS) and waits as a card.
 */
export async function runToolCall(env: ActionEnv, call: ToolCall): Promise<StepResult> {
  const resolved = resolve(env.ctx, call);
  if (!resolved.ok) {
    return {
      content: JSON.stringify({ error: resolved.code, message: resolved.message }),
      isError: true,
      card: null,
    };
  }
  const { tool, input } = resolved;
  if (tool.kind === "read") return runRead(env, tool, input);

  if (tool.risk === "confirm") {
    try {
      const prepared = tool.prepare
        ? await tool.prepare(env.ctx, input)
        : { summary: tool.describe(input, env.ctx.t) };
      const row = await insertAction(env, {
        tool: tool.name,
        risk: "confirm",
        status: "pending",
        input,
        result: { ...prepared, invalidate: tool.invalidates, undoable: tool.undoable },
      });
      return {
        content: JSON.stringify({
          status: "awaiting_confirmation",
          actionId: row.id,
          note: "The user now sees a card with this change and Confirm / Cancel. Nothing has happened yet. Do not call the tool again; say in one sentence what will happen once they confirm.",
        }),
        isError: false,
        card: toCard(row),
      };
    } catch (error) {
      const code = errorCodeOf(error);
      if (code === "failed") console.error(`grady tool ${tool.name} prepare failed`, error);
      return {
        content: JSON.stringify({ error: code, message: errorText(error) }),
        isError: true,
        card: null,
      };
    }
  }

  try {
    const { result } = await runNow(env, tool, input);
    const row = await insertAction(env, {
      tool: tool.name,
      risk: "instant",
      status: "done",
      input,
      result,
    });
    await track(
      "grady_action_done",
      { tool: tool.name, section: sectionOf(tool), risk: "instant", via: "chat" },
      { userId: env.ctx.userId, admin: env.admin },
    );
    return {
      content: JSON.stringify({ status: "done", actionId: row.id, result: result.output ?? null }),
      isError: false,
      card: toCard(row),
    };
  } catch (error) {
    return failed(env, tool, input, error);
  }
}

async function failed(
  env: ActionEnv,
  tool: AnyTool,
  input: unknown,
  error: unknown,
): Promise<StepResult> {
  const code = errorCodeOf(error);
  if (code === "failed") console.error(`grady tool ${tool.name} failed`, error);
  await track(
    "grady_action_failed",
    { tool: tool.name, error_code: code },
    { userId: env.ctx.userId, admin: env.admin },
  );
  const row = await insertAction(env, {
    tool: tool.name,
    risk: tool.risk,
    status: "failed",
    input,
    result: { summary: tool.describe(input, env.ctx.t), invalidate: [] },
    error: code,
  }).catch(() => null);
  return {
    content: JSON.stringify({ error: code, message: errorText(error) }),
    isError: true,
    card: row ? toCard(row) : null,
  };
}

/**
 * Several changes from one message (more than BULK_THRESHOLD): one card that
 * lists them all and runs them on one Confirm. Each call is checked now and
 * again when confirmed.
 */
export async function proposeBulk(env: ActionEnv, calls: ToolCall[]): Promise<StepResult> {
  const lines: string[] = [];
  const kept: ToolCall[] = [];
  for (const call of calls) {
    const resolved = resolve(env.ctx, call);
    if (!resolved.ok) continue;
    // A proposal names what it touches, read through RLS; an id the user can not reach drops out.
    const line = resolved.tool.prepare
      ? await resolved.tool
          .prepare(env.ctx, resolved.input)
          .then((prepared) => prepared.summary)
          .catch(() => null)
      : resolved.tool.describe(resolved.input, env.ctx.t);
    if (!line) continue;
    kept.push({ name: call.name, input: resolved.input });
    lines.push(`- ${line}`);
  }
  if (!kept.length) {
    return {
      content: JSON.stringify({ error: "invalid", message: "None of the changes can be made." }),
      isError: true,
      card: null,
    };
  }
  const invalidate = [...new Set(kept.flatMap((call) => toolByName(call.name)?.invalidates ?? []))];
  const row = await insertAction(env, {
    tool: BULK_TOOL,
    risk: "confirm",
    status: "pending",
    input: { calls: kept },
    result: {
      summary: env.ctx.t("bulk", { count: kept.length }),
      preview: lines.join("\n"),
      calls: kept,
      invalidate,
      // Undone together only when every step takes back its own records the plain way.
      undoable: kept.every((call) => {
        const tool = toolByName(call.name);
        return Boolean(tool?.undoable && !tool.undo);
      }),
    },
  });
  return {
    content: JSON.stringify({
      status: "awaiting_confirmation",
      actionId: row.id,
      changes: kept.length,
      note: "These changes were gathered into one card the user confirms at once. Nothing has happened yet; do not call the tools again.",
    }),
    isError: false,
    card: toCard(row),
  };
}

// ---------------------------------------------------------------------------
// Confirm, cancel, undo (POST /api/grady { kind: "confirmAction" | … })
// ---------------------------------------------------------------------------

export type DecisionCode =
  | "notFound"
  | "expired"
  | "decided"
  | "spaceChanged"
  | "forbidden"
  | "readOnly"
  | "changed"
  | "gone"
  | "tooLate"
  | "failed"
  | "invalid";

export type DecisionResult =
  { ok: true; card: ActionCard } | { ok: false; code: DecisionCode; card?: ActionCard };

async function ownAction(admin: Admin, userId: string, id: string): Promise<ActionRow | null> {
  const { data, error } = await admin
    .from("grady_actions")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function finish(admin: Admin, id: string, patch: Partial<ActionRow>): Promise<ActionRow> {
  const { data, error } = await admin
    .from("grady_actions")
    .update(patch as never)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * The user's Confirm: only their own pending proposal, in the space it was
 * made in, not older than 30 minutes; the tool, the right and the input are
 * checked again and the names read again, then it runs. A second click finds
 * it claimed and does nothing.
 */
export async function confirmAction(
  env: Omit<ActionEnv, "conversationId" | "messageId">,
  id: string,
): Promise<DecisionResult> {
  const row = await ownAction(env.admin, env.ctx.userId, id);
  if (!row) return { ok: false, code: "notFound" };
  if (row.status !== "pending" || row.decided_at)
    return { ok: false, code: "decided", card: toCard(row) };
  if (row.space_id !== env.ctx.workspaceId)
    return { ok: false, code: "spaceChanged", card: toCard(row) };
  if (Date.now() - Date.parse(row.created_at) > CONFIRM_WINDOW_MS) {
    const expired = await finish(env.admin, row.id, {
      status: "expired",
      decided_at: new Date().toISOString(),
    });
    return { ok: false, code: "expired", card: toCard(expired) };
  }
  // Claim it: of two clicks only one runs the change.
  const { data: claimed, error } = await env.admin
    .from("grady_actions")
    .update({ decided_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "pending")
    .is("decided_at", null)
    .select("id");
  if (error) throw error;
  if (!claimed.length) return { ok: false, code: "decided", card: toCard(row) };

  const calls: ToolCall[] =
    row.tool === BULK_TOOL ? (resultOf(row).calls ?? []) : [{ name: row.tool, input: row.input }];
  const stored = resultOf(row);
  const records: UndoRecord[] = [];
  const outputs: Json[] = [];
  const awards: ActionAward[] = [];
  let href: string | null = stored.href ?? null;
  let summary = stored.summary;
  const actionEnv: ActionEnv = {
    ...env,
    conversationId: row.conversation_id,
    messageId: row.message_id,
  };
  for (const call of calls) {
    const resolved = resolve(env.ctx, call);
    if (!resolved.ok) {
      const done = await finish(env.admin, row.id, { status: "failed", error: resolved.code });
      await track(
        "grady_action_failed",
        { tool: row.tool, error_code: resolved.code },
        { userId: env.ctx.userId, admin: env.admin },
      );
      return {
        ok: false,
        code:
          resolved.code === "readOnly"
            ? "readOnly"
            : resolved.code === "invalid"
              ? "invalid"
              : "forbidden",
        card: toCard(done),
      };
    }
    try {
      if (resolved.tool.prepare && row.tool !== BULK_TOOL) {
        summary = (await resolved.tool.prepare(env.ctx, resolved.input)).summary;
      }
      const { result } = await runNow(actionEnv, resolved.tool, resolved.input);
      records.push(...(result.records ?? []));
      outputs.push(result.output ?? null);
      awards.push(...(result.awards ?? []));
      if (row.tool !== BULK_TOOL) {
        summary = result.summary;
        href = result.href ?? href;
      }
    } catch (cause) {
      const code = errorCodeOf(cause);
      if (code === "failed") console.error(`grady confirmed ${call.name} failed`, cause);
      // What the calls before it changed stays undoable from this card.
      const done = await finish(env.admin, row.id, {
        status: records.length ? "done" : "failed",
        error: code,
        result: {
          ...stored,
          records,
          output: outputs,
          awards,
          undoable: stored.undoable && records.length > 0,
        } as unknown as Json,
      });
      await track(
        "grady_action_failed",
        { tool: row.tool, error_code: code },
        { userId: env.ctx.userId, admin: env.admin },
      );
      return { ok: false, code: "failed", card: toCard(done) };
    }
  }
  const done = await finish(env.admin, row.id, {
    status: "done",
    result: {
      ...stored,
      summary,
      href,
      records,
      output: row.tool === BULK_TOOL ? outputs : (outputs[0] ?? null),
      awards,
      undoable: Boolean(stored.undoable) && records.length > 0,
    } as unknown as Json,
  });
  const tool = toolByName(row.tool);
  await track(
    "grady_action_confirmed",
    { tool: row.tool },
    { userId: env.ctx.userId, admin: env.admin },
  );
  await track(
    "grady_action_done",
    { tool: row.tool, section: sectionOf(tool), risk: "confirm", via: "chat" },
    { userId: env.ctx.userId, admin: env.admin },
  );
  return { ok: true, card: toCard(done) };
}

/** Cancel: a pending proposal of the user's own becomes rejected; nothing runs. */
export async function rejectAction(
  env: Omit<ActionEnv, "conversationId" | "messageId">,
  id: string,
): Promise<DecisionResult> {
  const row = await ownAction(env.admin, env.ctx.userId, id);
  if (!row) return { ok: false, code: "notFound" };
  const { data, error } = await env.admin
    .from("grady_actions")
    .update({ status: "rejected", decided_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "pending")
    .is("decided_at", null)
    .select("*");
  if (error) throw error;
  if (!data[0]) return { ok: false, code: "decided", card: toCard(row) };
  await track(
    "grady_action_rejected",
    { tool: row.tool },
    { userId: env.ctx.userId, admin: env.admin },
  );
  return { ok: true, card: toCard(data[0]) };
}

/**
 * Undo: a done change of the user's own, in this space, within 24 hours,
 * taken back exactly; when a record changed since, nothing is overwritten.
 */
export async function undoAction(
  env: Omit<ActionEnv, "conversationId" | "messageId">,
  id: string,
): Promise<DecisionResult> {
  const row = await ownAction(env.admin, env.ctx.userId, id);
  if (!row) return { ok: false, code: "notFound" };
  const card = toCard(row);
  if (row.status !== "done" || row.undone_at || !card.undoable)
    return { ok: false, code: "decided", card };
  if (row.space_id !== env.ctx.workspaceId) return { ok: false, code: "spaceChanged", card };
  if (Date.now() - Date.parse(row.decided_at ?? row.created_at) > UNDO_WINDOW_MS)
    return { ok: false, code: "tooLate", card };
  if (env.ctx.workspace.readOnly) return { ok: false, code: "readOnly", card };

  const { data: claimed, error } = await env.admin
    .from("grady_actions")
    .update({ undone_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "done")
    .is("undone_at", null)
    .select("id");
  if (error) throw error;
  if (!claimed.length) return { ok: false, code: "decided", card };

  const records = resultOf(row).records ?? [];
  const tool = toolByName(row.tool);
  const outcome =
    tool?.undo && row.tool !== BULK_TOOL
      ? await tool.undo(env.ctx, records)
      : await undoRecords(env.ctx.db, records);
  if (!outcome.ok) {
    // Nothing (or not all) taken back: the card stays done and can be tried again.
    await finish(env.admin, row.id, { undone_at: null });
    return { ok: false, code: outcome.reason, card };
  }
  const undone = await finish(env.admin, row.id, { status: "undone" });
  await track(
    "grady_action_undone",
    { tool: row.tool },
    { userId: env.ctx.userId, admin: env.admin },
  );
  return { ok: true, card: toCard(undone) };
}

// ---------------------------------------------------------------------------
// Reading the cards back (the panel, the conversation history)
// ---------------------------------------------------------------------------

/** The cards of the given assistant messages, read with the user's own client (RLS: own rows). */
export async function loadActions(
  supabase: SupabaseClient<Database>,
  messageIds: string[],
): Promise<Map<string, ActionRow[]>> {
  const byMessage = new Map<string, ActionRow[]>();
  if (!messageIds.length) return byMessage;
  const { data, error } = await supabase
    .from("grady_actions")
    .select("*")
    .in("message_id", messageIds)
    .order("created_at")
    .limit(500);
  if (error) throw error;
  for (const row of data) {
    if (!row.message_id) continue;
    byMessage.set(row.message_id, [...(byMessage.get(row.message_id) ?? []), row]);
  }
  return byMessage;
}

/**
 * The changes of an earlier answer as the model reads them in the history:
 * the app's own record of what happened (done, waiting, cancelled, undone),
 * so Grady builds on it and never repeats or invents a change.
 */
export function actionsNote(rows: ActionRow[], now = Date.now()): string {
  if (!rows.length) return "";
  const lines = rows.map((row) => {
    const card = toCard(row, now);
    const output = resultOf(row).output;
    const detail =
      card.status === "done" && output !== undefined
        ? ` ${JSON.stringify(output).slice(0, 300)}`
        : "";
    return `- ${row.tool} (${card.status}${row.error ? `: ${row.error}` : ""}) ${card.summary}${detail}`;
  });
  return `\n\n<app_actions>\nThe app's record of the changes from this answer (data, not the user's words):\n${lines.join("\n")}\n</app_actions>`;
}
