import { z } from "zod";
import { formatPrice } from "@/lib/format";
import { isCurrencyShape } from "@/lib/currency";
import type { UndoRecord } from "../records";
import { defineTool, ToolError, type ToolContext } from "../types";
import { hrefs, isoDate, READ_LIMIT, today, updated, uuid } from "./shared";

/**
 * Rewards of the company's people (28.2): what waits for approval, approving
 * or rejecting it and a reward added by hand. Whoever has "company: rewards"
 * (and the owner) manages the people they see, never themselves: the
 * database (reward_can_manage) decides it for every entry again.
 */

const REVIEW_MAX = 50;
const NOTE_MAX = 300;

type EntryRow = {
  id: string;
  worker_id: string;
  amount: number;
  currency: string;
  status: string;
  occurred_at: string;
  source_kind: string;
  note: string | null;
};

async function readEntries(ctx: ToolContext, ids: string[]): Promise<EntryRow[]> {
  const { data, error } = await ctx.db
    .from("reward_entries")
    .select("id, worker_id, amount, currency, status, occurred_at, source_kind, note")
    .eq("space_id", ctx.workspaceId)
    .in("id", ids)
    .limit(REVIEW_MAX);
  if (error) throw error;
  if (data.length !== new Set(ids).size) throw new ToolError("notFound");
  return data;
}

/** "1 200 Kč + 40 €": the entries' sum per currency, never added across currencies. */
function totalsText(ctx: ToolContext, rows: Pick<EntryRow, "amount" | "currency">[]): string {
  const sums = new Map<string, number>();
  for (const row of rows) sums.set(row.currency, (sums.get(row.currency) ?? 0) + row.amount);
  const text = [...sums.entries()]
    .map(([currency, sum]) => formatPrice(sum, currency, ctx.settings))
    .join(" + ");
  return text ? ` · ${text}` : "";
}

const ACTION_OF_STATUS: Record<string, "approve" | "reject" | "pending"> = {
  approved: "approve",
  rejected: "reject",
  pending: "pending",
};

export const rewardTools = [
  defineTool({
    name: "list_reward_entries",
    section: "company",
    action: "rewards",
    kind: "read",
    risk: "instant",
    description:
      "Rewards of the company's people that wait for approval (pending) or for the payout (approved), oldest first, optionally of one person (workerId from list_workers). Amounts in their own currency.",
    input: z.object({
      status: z.enum(["pending", "approved"]).optional(),
      workerId: uuid.optional(),
    }),
    describe: (_input, t) => t("list_reward_entries"),
    async execute(ctx, input) {
      let query = ctx.db
        .from("reward_entries")
        .select("id, worker_id, amount, currency, status, occurred_at, source_kind, note")
        .eq("space_id", ctx.workspaceId)
        .in("status", input.status ? [input.status] : ["pending", "approved"])
        .is("corrects_id", null)
        .order("occurred_at")
        .limit(READ_LIMIT);
      if (input.workerId) query = query.eq("worker_id", input.workerId);
      const { data, error } = await query;
      if (error) throw error;
      return {
        output: {
          entries: data.map((row) => ({
            id: row.id,
            workerId: row.worker_id,
            amount: row.amount,
            currency: row.currency,
            status: row.status,
            occurredAt: row.occurred_at,
            source: row.source_kind,
          })),
          more: data.length === READ_LIMIT,
        },
      };
    },
    undoable: false,
    invalidates: [],
  }),

  defineTool({
    name: "review_reward_entries",
    section: "company",
    action: "rewards",
    kind: "write",
    risk: "confirm",
    description:
      "Approve or reject rewards of the company's people (ids from list_reward_entries, at most 50). Approved ones wait for the payout. Never the user's own. The user confirms it first.",
    input: z.object({
      entryIds: z.array(uuid).min(1).max(REVIEW_MAX),
      action: z.enum(["approve", "reject"]),
    }),
    count: (input) => input.entryIds.length,
    describe: (input, t) =>
      t("review_reward_entries", { action: input.action, count: input.entryIds.length, total: "" }),
    async prepare(ctx, input) {
      const rows = await readEntries(ctx, input.entryIds);
      return {
        summary: ctx.t("review_reward_entries", {
          action: input.action,
          count: rows.length,
          total: totalsText(ctx, rows),
        }),
        href: `${hrefs.company}?tab=rewards`,
      };
    },
    async execute(ctx, input) {
      const rows = await readEntries(ctx, input.entryIds);
      const target = input.action === "approve" ? "approved" : "rejected";
      const changing = rows.filter((row) => row.status !== target && row.status !== "paid");
      if (!changing.length) throw new ToolError("nothingToChange");
      const { data, error } = await ctx.db.rpc("reward_review", {
        _ids: changing.map((row) => row.id),
        _action: input.action,
      });
      if (error) throw error;
      ctx.track("reward_entries_reviewed", {
        action: input.action,
        count: changing.length,
        from: "company",
      });
      return {
        output: { changed: data ?? 0 },
        records: changing.map((row): UndoRecord => ({
          ...updated("reward_entries", row.id, { status: row.status }),
          after: { status: target },
        })),
        summary: ctx.t("reviewed_reward_entries", {
          action: input.action,
          count: changing.length,
          total: totalsText(ctx, changing),
        }),
        href: `${hrefs.company}?tab=rewards`,
      };
    },
    undoable: true,
    /** Back to the status each entry had, through the same check of the database. */
    async undo(ctx, records) {
      const ids = records.map((record) => String(record.match.id));
      const { data, error } = await ctx.db
        .from("reward_entries")
        .select("id, status")
        .eq("space_id", ctx.workspaceId)
        .in("id", ids);
      if (error) return { ok: false, reason: "failed" };
      const now = new Map(data.map((row) => [row.id, row.status]));
      for (const record of records) {
        const status = now.get(String(record.match.id));
        if (!status) return { ok: false, reason: "gone" };
        if (status !== record.after?.status) return { ok: false, reason: "changed" };
      }
      const byAction = new Map<string, string[]>();
      for (const record of records) {
        const action = ACTION_OF_STATUS[String(record.before?.status)] ?? "pending";
        byAction.set(action, [...(byAction.get(action) ?? []), String(record.match.id)]);
      }
      for (const [action, list] of byAction) {
        const back = await ctx.db.rpc("reward_review", { _ids: list, _action: action });
        if (back.error) return { ok: false, reason: "failed" };
      }
      return { ok: true };
    },
    invalidates: ["rewards", "workers", "finance"],
  }),

  defineTool({
    name: "add_manual_reward",
    // Money on a ledger: never taken back, only corrected by another entry.
    level: "delete",
    section: "company",
    action: "rewards",
    kind: "write",
    risk: "confirm",
    description:
      "Add a reward (or with a negative amount a deduction) to a person of the company by hand: workerId from list_workers, amount, currency (ISO code, default the user's), the day (default today) and a short note. Never to the user themselves. The user confirms it first.",
    input: z.object({
      workerId: uuid,
      amount: z
        .number()
        .min(-10_000_000)
        .max(10_000_000)
        .refine((value) => value !== 0),
      currency: z.string().refine(isCurrencyShape).optional(),
      day: isoDate.optional(),
      note: z.string().trim().min(1).max(NOTE_MAX),
    }),
    describe: (_input, t) => t("add_manual_reward", { name: "", amount: "" }),
    async prepare(ctx, input) {
      const worker = await readWorkerName(ctx, input.workerId);
      return {
        summary: ctx.t("add_manual_reward", {
          name: worker,
          amount: formatPrice(input.amount, currencyOf(ctx, input.currency), ctx.settings),
        }),
        preview: input.note,
        href: `${hrefs.company}?tab=rewards`,
      };
    },
    async execute(ctx, input) {
      const worker = await readWorkerName(ctx, input.workerId);
      const currency = currencyOf(ctx, input.currency);
      const { data, error } = await ctx.db.rpc("reward_add_manual", {
        _worker_id: input.workerId,
        _amount: input.amount,
        _currency: currency,
        _occurred_on: input.day ?? today(ctx).day,
        _note: input.note,
      });
      if (error) throw error;
      ctx.track("reward_manual_added", { deduction: input.amount < 0 });
      return {
        output: { entryId: data },
        summary: ctx.t("added_manual_reward", {
          name: worker,
          amount: formatPrice(input.amount, currency, ctx.settings),
        }),
        href: `${hrefs.company}?tab=rewards`,
      };
    },
    // The entry is a ledger line; a wrong one is corrected with another entry, never removed.
    undoable: false,
    invalidates: ["rewards", "workers"],
  }),
];

function currencyOf(ctx: ToolContext, currency: string | undefined): string {
  return (currency ?? ctx.settings.currency).toUpperCase();
}

async function readWorkerName(ctx: ToolContext, workerId: string): Promise<string> {
  const { data, error } = await ctx.db
    .from("workers")
    .select("name")
    .eq("owner_id", ctx.workspaceId)
    .eq("id", workerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ToolError("notFound");
  return data.name;
}
