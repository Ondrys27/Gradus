import type { Database, Json } from "@/types/database";

/**
 * What the chat shows of the changes Grady makes or proposes (grady_actions):
 * shared by the route, the panel and its cards. The tools themselves live in
 * ./tools on the server; the browser only ever sees these cards.
 */

export const ACTION_STATUSES = [
  "pending",
  "done",
  "undone",
  "rejected",
  "expired",
  "failed",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export type ToolRisk = "instant" | "confirm";

/** A done change can be undone this long after it was made. */
export const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A proposal waits this long for Confirm / Cancel, then it expires. */
export const CONFIRM_WINDOW_MS = 30 * 60 * 1000;

/**
 * What the browser reads again after a change: the first two parts of the
 * TanStack Query keys of a section (["contacts", userId], …), without the user.
 */
export const QUERY_ROOTS = [
  "milestones",
  "notes",
  "note-links",
  "contacts",
  "pipeline",
  "crmTasks",
  "calendar",
  "scheduler",
  "finance",
  "chat",
  "workers",
  "account",
  "game",
  "dashboard",
  "cold-calling",
] as const;
export type QueryRoot = (typeof QUERY_ROOTS)[number];

/** A big moment the browser celebrates when the card arrives, as the screens do. */
export type ActionAward = {
  reason:
    | "task_completed"
    | "milestone_completed"
    | "deal_won"
    | "meeting_booked"
    | "contact_moved"
    | "calendar_event"
    | "transaction_added";
  refId?: string;
  /** A milestone or a won deal: the celebration with its name (and the milestone's reward). */
  celebrate?: { moment: "milestone" | "win"; subtitle: string; reward?: string | null };
};

/** One card under Grady's answer. */
export type ActionCard = {
  id: string;
  tool: string;
  risk: ToolRisk;
  status: ActionStatus;
  /** "Created the task “Buy a domain”", in the user's language, from the server. */
  summary: string;
  /** For a proposal: exactly what will happen (the whole text of a message or an e-mail). */
  preview: string | null;
  /** "Open": where the record is in the app. */
  href: string | null;
  /** Whether Undo is offered (a done change with something to undo). */
  undoable: boolean;
  error: string | null;
  createdAt: string;
  decidedAt: string | null;
  invalidate: QueryRoot[];
  awards: ActionAward[];
};

export function cardExpired(card: Pick<ActionCard, "status" | "createdAt">, now = Date.now()) {
  return card.status === "pending" && now - Date.parse(card.createdAt) > CONFIRM_WINDOW_MS;
}

export function canStillUndo(
  card: Pick<ActionCard, "status" | "undoable" | "createdAt" | "decidedAt">,
  now = Date.now(),
) {
  const at = Date.parse(card.decidedAt ?? card.createdAt);
  return card.status === "done" && card.undoable && now - at <= UNDO_WINDOW_MS;
}

type ActionRow = Database["public"]["Tables"]["grady_actions"]["Row"];

/** What grady_actions.result holds; written only by the server. */
export type StoredActionResult = {
  summary: string;
  preview?: string | null;
  href?: string | null;
  records?: unknown[];
  output?: Json;
  awards?: ActionAward[];
  invalidate?: QueryRoot[];
  /** A bulk proposal: the calls it runs once confirmed. */
  calls?: { name: string; input: unknown }[];
  undoable?: boolean;
};

export function storedResultOf(row: Pick<ActionRow, "result">): StoredActionResult {
  const value = row.result as StoredActionResult | null;
  return value && typeof value === "object" && !Array.isArray(value) ? value : { summary: "" };
}

/** The card of a row of grady_actions (the server's and the browser's reading alike). */
export function cardFromRow(row: ActionRow, now = Date.now()): ActionCard {
  const result = storedResultOf(row);
  const expired = row.status === "pending" && now - Date.parse(row.created_at) > CONFIRM_WINDOW_MS;
  const status = (ACTION_STATUSES as readonly string[]).includes(row.status)
    ? (row.status as ActionStatus)
    : "failed";
  return {
    id: row.id,
    tool: row.tool,
    risk: row.risk === "confirm" ? "confirm" : "instant",
    status: expired ? "expired" : status,
    summary: result.summary,
    preview: result.preview ?? null,
    href: result.href ?? null,
    undoable: Boolean(result.undoable) && (result.records?.length ?? 0) > 0,
    error: row.error,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    invalidate: result.invalidate ?? [],
    awards: row.status === "done" ? (result.awards ?? []) : [],
  };
}
