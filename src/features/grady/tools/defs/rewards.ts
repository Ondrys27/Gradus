import { z } from "zod";
import { formatPrice } from "@/lib/format";
import { isCurrencyShape } from "@/lib/currency";
import { EVENT_CATALOG, REWARD_EVENTS } from "@/features/workers/rewards/catalog";
import {
  definitionErrors,
  definitionSchema,
  missingRefs,
  normalizeDefinition,
  type RuleDefinition,
  type SpaceRefs,
} from "@/features/workers/rewards/definition";
import { simulate, type EventSubject } from "@/features/workers/rewards/evaluate";
import { parseRule, RULES_PER_PLAN } from "@/features/workers/rewards/rules";
import { buildSentence } from "@/features/workers/rewards/sentence";
import type { UndoRecord } from "../records";
import { defineTool, ToolError, type ToolContext } from "../types";
import { deleted, hrefs, inserted, isoDate, READ_LIMIT, today, updated, uuid } from "./shared";

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

// ---------------------------------------------------------------------------
// The plan's rules (29.1): read, try, set — the same rules as the plan's sentences
// ---------------------------------------------------------------------------

const SETUP_CHANGES_MAX = 15;

/** The person's plan as the rules see it, after the database says the caller manages them. */
async function readPlan(ctx: ToolContext, workerId: string) {
  const { data: manages, error: manageError } = await ctx.db.rpc("reward_can_manage", {
    _space: ctx.workspaceId,
    _worker: workerId,
  });
  if (manageError) throw manageError;
  if (!manages) throw new ToolError("notFound");
  const [{ data: refsData, error: refsError }, { data: plan, error }] = await Promise.all([
    ctx.db.rpc("reward_plan_refs", { _worker: workerId }),
    ctx.db
      .from("reward_plans")
      .select("id, currency, approval, rules:reward_plan_rules(id, plan_id, worker_id, kind, definition, active, position)")
      .eq("space_id", ctx.workspaceId)
      .eq("worker_id", workerId)
      .maybeSingle(),
  ]);
  if (refsError) throw refsError;
  if (error) throw error;
  const raw = (refsData ?? {}) as Partial<SpaceRefs>;
  const refs: SpaceRefs = { tables: raw.tables ?? [], stages: raw.stages ?? [] };
  const rules = (plan?.rules ?? [])
    .flatMap((row) => {
      const rule = parseRule(row);
      return rule ? [rule] : [];
    })
    .sort((a, b) => a.position - b.position);
  return { plan, refs, rules, currency: plan?.currency ?? ctx.settings.currency };
}

/** Rules as sentences in the user's language, for the card before anything is saved. */
async function sentencesOf(ctx: ToolContext, definitions: RuleDefinition[], currency: string, refs: SpaceRefs) {
  const { getTranslations } = await import("next-intl/server");
  const t = await getTranslations({ locale: ctx.locale, namespace: "workers.rewardPlan.sentence" });
  const names = new Map([...refs.tables, ...refs.stages].map((item) => [item.id, item.name]));
  return definitions.map((definition) =>
    buildSentence(definition, {
      t: (key, values) => t(key as never, values as never),
      locale: ctx.locale,
      settings: ctx.settings,
      currency,
      nameOf: (id) => names.get(id) ?? null,
    })
      .map((piece) => piece.text)
      .join(""),
  );
}

/** A rule the model wrote: the editor's checks, and only the space's own tables and stages. */
function checkedRule(value: unknown, refs: SpaceRefs): RuleDefinition {
  const parsed = definitionSchema.safeParse(value);
  if (!parsed.success) throw new ToolError("invalid", "rule: not a valid rule definition");
  const definition = normalizeDefinition(parsed.data);
  const errors = definitionErrors(definition);
  if (errors.length) throw new ToolError("invalid", `rule: ${errors.join(", ")}`);
  if (missingRefs(definition, refs).length) throw new ToolError("invalid", "rule: unknown table or stage id");
  return definition;
}

const RULE_FORMAT =
  'A rule is {"event":{"key":EVENT,...},"conditions":{...},"reward":{...},"limits":{...},"stack":"sum"|"max","undo":"cancel"|"keep"}; get_reward_plan lists the events, what each allows, and the ids of the contact tables and pipeline stages.';

const changeSchema = z.object({
  op: z.enum(["add", "update", "remove"]),
  ruleId: uuid.optional().describe("The rule to update or remove (from get_reward_plan)."),
  rule: definitionSchema.optional().describe("The whole rule for add and update."),
});

export const rewardRuleTools = [
  defineTool({
    name: "get_reward_plan",
    section: "company",
    action: "rewards",
    kind: "read",
    risk: "instant",
    description: `The reward plan of one person of the company (workerId from list_workers): its currency, approval and rules, the events a rule can listen to with what each allows, and the person's company's contact tables and pipeline stages by id. ${RULE_FORMAT}`,
    input: z.object({ workerId: uuid }),
    describe: (_input, t) => t("get_reward_plan"),
    async execute(ctx, input) {
      const { plan, refs, rules, currency } = await readPlan(ctx, input.workerId);
      return {
        output: {
          plan: plan ? { currency, approval: plan.approval } : null,
          rules: rules.map((rule) => ({ id: rule.id, active: rule.active, rule: rule.definition })),
          events: REWARD_EVENTS.map((key) => {
            const spec = EVENT_CATALOG[key];
            return {
              key,
              group: spec.group,
              moves: spec.move ?? null,
              who: spec.who,
              rewards: spec.rewards,
              value: spec.value,
              tags: spec.tags,
              once: spec.once,
              via: spec.via ?? null,
              cap: spec.cap,
              bonusAndTiers: spec.counted,
            };
          }),
          tables: refs.tables,
          stages: refs.stages,
        },
      };
    },
    undoable: false,
    invalidates: [],
  }),

  defineTool({
    name: "try_reward_rule",
    section: "company",
    action: "rewards",
    kind: "read",
    risk: "instant",
    description: `What one rule would have paid a person in the last 30 days on their real work (a dry run, nothing is written): the total, the number of events and the first 10. Use it to show the owner a rule before saving it. ${RULE_FORMAT}`,
    input: z.object({ workerId: uuid, rule: definitionSchema }),
    describe: (_input, t) => t("try_reward_rule"),
    async execute(ctx, input) {
      const { refs, currency } = await readPlan(ctx, input.workerId);
      const definition = checkedRule(input.rule, refs);
      const { data, error } = await ctx.db.rpc("reward_history", { _worker: input.workerId, _days: 30 });
      if (error) throw error;
      const result = simulate(definition, (Array.isArray(data) ? data : []) as EventSubject[], {
        planCurrency: currency,
        timeZone: ctx.timezone,
      });
      return {
        output: {
          count: result.count,
          totals: result.totals,
          first: result.first.map((entry) => ({ at: entry.at, amount: entry.amount, currency: entry.currency, bonus: entry.bonus })),
        },
      };
    },
    undoable: false,
    invalidates: [],
  }),

  defineTool({
    name: "save_reward_rules",
    section: "company",
    action: "rewards",
    kind: "write",
    risk: "confirm",
    description: `Set a person's reward rules on the user's word ("pay 400 for every meeting booked", "raise the share to 5 %"): add, update (the whole rule) or remove, at most 15 changes; a plan is made when the person has none. Call get_reward_plan first, never invent ids, and try_reward_rule to show what a rule would have paid. What the rules cannot express, tell the user with the nearest option instead. The user confirms it first. ${RULE_FORMAT}`,
    input: z.object({
      workerId: uuid,
      changes: z.array(changeSchema).min(1).max(SETUP_CHANGES_MAX),
    }),
    count: (input) => input.changes.length,
    describe: (input, t) => t("save_reward_rules", { count: input.changes.length }),
    async prepare(ctx, input) {
      const { refs, rules, currency } = await readPlan(ctx, input.workerId);
      const ops = planOps(input.changes, refs, rules.map((rule) => rule.id), rules.length);
      const name = await readWorkerName(ctx, input.workerId);
      const shown = await sentencesOf(
        ctx,
        ops.flatMap((op) => (op.op === "remove" ? [rules.find((rule) => rule.id === op.ruleId)!.definition] : [op.definition])),
        currency,
        refs,
      );
      const marks = ops.map((op) => (op.op === "add" ? "+" : op.op === "update" ? "~" : "−"));
      return {
        summary: ctx.t("save_reward_rules_for", { name, count: ops.length }),
        preview: shown.map((line, index) => `${marks[index]} ${line}`).join("\n"),
        href: `${hrefs.company}?worker=${input.workerId}&wtab=rewards`,
      };
    },
    async execute(ctx, input) {
      const { plan, refs, rules } = await readPlan(ctx, input.workerId);
      const ops = planOps(input.changes, refs, rules.map((rule) => rule.id), rules.length);
      const name = await readWorkerName(ctx, input.workerId);
      const records: UndoRecord[] = [];
      let planId = plan?.id ?? null;
      if (!planId) {
        const { getTranslations } = await import("next-intl/server");
        const t = await getTranslations({ locale: ctx.locale, namespace: "workers.rewardPlan" });
        const { data, error } = await ctx.db
          .from("reward_plans")
          .insert({
            space_id: ctx.workspaceId,
            worker_id: input.workerId,
            name: t("defaultName"),
            currency: ctx.settings.currency,
          })
          .select("id")
          .single();
        if (error) throw error;
        planId = data.id;
        records.push(inserted("reward_plans", data.id));
      }
      let position = rules.reduce((max, rule) => Math.max(max, rule.position + 1), 0);
      for (const op of ops) {
        if (op.op === "remove") {
          const rule = rules.find((item) => item.id === op.ruleId)!;
          const { error } = await ctx.db.from("reward_plan_rules").delete().eq("id", op.ruleId);
          if (error) throw error;
          records.push(
            deleted("reward_plan_rules", rule.id, {
              plan_id: rule.plan_id,
              space_id: ctx.workspaceId,
              worker_id: rule.worker_id,
              kind: "event",
              definition: rule.definition,
              active: rule.active,
              position: rule.position,
            }),
          );
        } else if (op.op === "update") {
          const rule = rules.find((item) => item.id === op.ruleId)!;
          const { error } = await ctx.db.from("reward_plan_rules").update({ definition: op.definition }).eq("id", op.ruleId);
          if (error) throw error;
          records.push(updated("reward_plan_rules", op.ruleId, { definition: rule.definition }));
        } else {
          const { data, error } = await ctx.db
            .from("reward_plan_rules")
            .insert({
              kind: "event",
              definition: op.definition,
              plan_id: planId,
              space_id: ctx.workspaceId,
              worker_id: input.workerId,
              position: position++,
            })
            .select("id")
            .single();
          if (error) throw error;
          records.push(inserted("reward_plan_rules", data.id));
        }
      }
      ctx.track("reward_setup_applied", {
        from: "grady",
        added: ops.filter((op) => op.op === "add").length,
        updated: ops.filter((op) => op.op === "update").length,
        removed: ops.filter((op) => op.op === "remove").length,
      });
      return {
        output: { saved: ops.length },
        records,
        summary: ctx.t("saved_reward_rules", { name, count: ops.length }),
        href: `${hrefs.company}?worker=${input.workerId}&wtab=rewards`,
      };
    },
    // Undo puts the plan's rules back as they were (24 h, nothing changed since).
    undoable: true,
    invalidates: ["rewards", "workers"],
  }),
];

type PlannedOp =
  | { op: "add"; definition: RuleDefinition }
  | { op: "update"; ruleId: string; definition: RuleDefinition }
  | { op: "remove"; ruleId: string };

/** The model's changes checked: rules like the editor's, ids of the person's own rules, the plan's limit. */
function planOps(
  changes: ReadonlyArray<z.infer<typeof changeSchema>>,
  refs: SpaceRefs,
  ruleIds: readonly string[],
  count: number,
): PlannedOp[] {
  const ops = changes.map((change): PlannedOp => {
    if (change.op !== "add" && !(change.ruleId && ruleIds.includes(change.ruleId))) throw new ToolError("notFound");
    if (change.op === "remove") return { op: "remove", ruleId: change.ruleId! };
    const definition = checkedRule(change.rule, refs);
    return change.op === "update" ? { op: "update", ruleId: change.ruleId!, definition } : { op: "add", definition };
  });
  const after = count + ops.filter((op) => op.op === "add").length - ops.filter((op) => op.op === "remove").length;
  if (after > RULES_PER_PLAN) throw new ToolError("invalid", `a plan holds at most ${RULES_PER_PLAN} rules`);
  return ops;
}

function currencyOf(ctx: ToolContext, currency: string | undefined): string {
  return (currency ?? ctx.settings.currency).toUpperCase();
}

/** The name of a person of the company now: somebody who left gets nothing new (28.1). */
async function readWorkerName(ctx: ToolContext, workerId: string): Promise<string> {
  const { data, error } = await ctx.db
    .from("workers")
    .select("name, status")
    .eq("owner_id", ctx.workspaceId)
    .eq("id", workerId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status === "inactive") throw new ToolError("notFound");
  return data.name;
}
