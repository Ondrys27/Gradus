import { z } from "zod";
import { can } from "@/features/account/workspace";
import { contactName } from "@/features/contacts/types";
import {
  addDealContact,
  createDeal,
  deleteDeal,
  moveDeal,
  nextDealPositionIn,
  patchDeal,
} from "@/features/pipeline/ops";
import { dealSchema, DESCRIPTION_MAX, REASON_MAX, TITLE_MAX } from "@/features/pipeline/schemas";
import { STAGE_COLUMNS, type Stage } from "@/features/pipeline/types";
import { isCurrencyShape } from "@/lib/currency";
import { defineTool, ToolError, type ToolContext } from "../types";
import {
  hrefs,
  inserted,
  isoDate,
  mustFind,
  ops,
  previousOf,
  quoted,
  updated,
  uuid,
} from "./shared";

async function stagesOf(ctx: ToolContext): Promise<Stage[]> {
  const { data, error } = await ctx.db
    .from("pipeline_stages")
    .select(STAGE_COLUMNS)
    .eq("user_id", ctx.workspaceId)
    .order("position")
    .limit(50);
  if (error) throw error;
  return data;
}

async function readDeal(ctx: ToolContext, id: string) {
  return mustFind(
    ctx.db
      .from("deals")
      .select(
        "id, title, value, currency, expected_close_date, deadline_date, description, assignee_id, stage_id, entered_stage_at, created_at, lost_reason, contact_id",
      )
      .eq("user_id", ctx.workspaceId)
      .eq("id", id)
      .maybeSingle(),
  );
}

const amount = z.number().min(0).max(1e12);

export const pipelineTools = [
  defineTool({
    name: "create_deal",
    section: "pipeline",
    action: "create",
    kind: "write",
    risk: "instant",
    description:
      "Create a deal in a stage (default the first open stage), optionally for a contact, with a value, currency (ISO code, default the user's) and Close Date. Get stage ids from list_deals.",
    input: z.object({
      title: z.string().trim().min(1).max(TITLE_MAX),
      contactId: uuid.optional(),
      stageId: uuid.optional(),
      value: amount.optional(),
      currency: z.string().length(3).optional(),
      closeDate: isoDate.optional(),
      description: z.string().trim().max(DESCRIPTION_MAX).optional(),
    }),
    describe: (input, t) => t("create_deal", { title: quoted(input.title) }),
    async execute(ctx, input) {
      const stages = await stagesOf(ctx);
      const stage = input.stageId
        ? stages.find((item) => item.id === input.stageId)
        : stages.find((item) => !item.is_won && !item.is_lost);
      if (!stage) throw new ToolError("notFound", "No such stage.");
      if (input.contactId) {
        await mustFind(
          ctx.db
            .from("contacts")
            .select("id")
            .eq("user_id", ctx.workspaceId)
            .eq("id", input.contactId)
            .maybeSingle(),
        );
      }
      // Without the right to change amounts the value stays empty, as in the form.
      const value =
        input.value !== undefined && can(ctx.workspace, "pipeline", "change_amount")
          ? input.value
          : null;
      const parsed = dealSchema.safeParse({
        title: input.title,
        contact_id: input.contactId ?? null,
        value,
        currency: (input.currency ?? ctx.settings.currency).toUpperCase(),
        expected_close_date: input.closeDate ?? null,
        stage_id: stage.id,
        description: input.description ?? "",
        lost_reason: "",
      });
      if (!parsed.success || !isCurrencyShape(parsed.data.currency)) throw new ToolError("invalid");
      const deal = await createDeal(ops(ctx), {
        workspaceId: ctx.workspaceId,
        input: parsed.data,
        position: await nextDealPositionIn(ops(ctx), ctx.workspaceId, stage.id),
        source: "grady",
        stage,
      });
      return {
        output: { dealId: deal.id, stage: stage.name },
        records: [inserted("deals", deal.id)],
        href: hrefs.deal(deal.id),
        awards: stage.is_won
          ? [
              {
                reason: "deal_won",
                refId: deal.id,
                celebrate: { moment: "win", subtitle: deal.title },
              },
            ]
          : [],
      };
    },
    undoable: true,
    invalidates: ["pipeline", "contacts", "finance", "dashboard"],
  }),

  defineTool({
    name: "update_deal",
    section: "pipeline",
    action: "update",
    kind: "write",
    risk: "instant",
    description:
      "Change a deal's title, value, currency, Close Date, delivery date (deadlineDate), description or the worker it is assigned to. The stage changes only with move_deal_stage.",
    input: z.object({
      dealId: uuid,
      title: z.string().trim().min(1).max(TITLE_MAX).optional(),
      value: amount.nullable().optional(),
      currency: z.string().length(3).optional(),
      closeDate: isoDate.nullable().optional(),
      deadlineDate: isoDate.nullable().optional(),
      description: z.string().trim().max(DESCRIPTION_MAX).optional(),
      assigneeId: uuid.optional(),
    }),
    describe: (_input, t) => t("update_deal", { title: "" }),
    async execute(ctx, input) {
      const deal = await readDeal(ctx, input.dealId);
      if (
        (input.value !== undefined || input.currency !== undefined) &&
        !can(ctx.workspace, "pipeline", "change_amount")
      ) {
        throw new ToolError("forbidden", "The user may not change amounts.");
      }
      const patch = {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.value !== undefined ? { value: input.value } : {}),
        ...(input.currency !== undefined ? { currency: input.currency.toUpperCase() } : {}),
        ...(input.closeDate !== undefined ? { expected_close_date: input.closeDate } : {}),
        ...(input.deadlineDate !== undefined ? { deadline_date: input.deadlineDate } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.assigneeId !== undefined ? { assignee_id: input.assigneeId } : {}),
      };
      if (!Object.keys(patch).length) throw new ToolError("invalid", "Nothing to change.");
      const saved = await patchDeal(ops(ctx), deal.id, patch);
      return {
        output: { dealId: deal.id },
        records: [updated("deals", deal.id, previousOf(deal, patch))],
        summary: ctx.t("update_deal", { title: quoted(saved.title) }),
        href: hrefs.deal(deal.id),
      };
    },
    undoable: true,
    invalidates: ["pipeline", "calendar", "contacts"],
  }),

  defineTool({
    name: "move_deal_stage",
    section: "pipeline",
    action: "change_stage",
    kind: "write",
    risk: "instant",
    description:
      "Move a deal to another stage (stage ids from list_deals). A won stage celebrates the win and puts the contact into Clients; a lost stage can carry the reason.",
    input: z.object({
      dealId: uuid,
      stageId: uuid,
      lostReason: z.string().trim().max(REASON_MAX).optional(),
    }),
    describe: (_input, t) => t("move_deal_stage", { title: "", stage: "" }),
    async execute(ctx, input) {
      const [deal, stages] = await Promise.all([readDeal(ctx, input.dealId), stagesOf(ctx)]);
      const stage = stages.find((item) => item.id === input.stageId);
      if (!stage) throw new ToolError("notFound", "No such stage.");
      if (stage.id === deal.stage_id) throw new ToolError("sameStage");
      const from = stages.find((item) => item.id === deal.stage_id);
      await moveDeal(ops(ctx), {
        deal,
        stage,
        lostReason: input.lostReason,
        position: await nextDealPositionIn(ops(ctx), ctx.workspaceId, stage.id),
        stages,
      });
      const won = stage.is_won && !from?.is_won;
      return {
        output: { dealId: deal.id, stage: stage.name, won },
        // The stage, its time and the reason, as they were. A win's booked income stays (Finance).
        records: [
          updated("deals", deal.id, {
            stage_id: deal.stage_id,
            lost_reason: deal.lost_reason,
          }),
        ],
        summary: ctx.t(won ? "won_deal" : "move_deal_stage", {
          title: quoted(deal.title),
          stage: quoted(stage.name),
        }),
        href: hrefs.deal(deal.id),
        awards: won
          ? [
              {
                reason: "deal_won",
                refId: deal.id,
                celebrate: { moment: "win", subtitle: deal.title },
              },
            ]
          : [],
      };
    },
    // A win puts the contact into Clients and may book income: moving back is a move of its own.
    undoable: false,
    invalidates: ["pipeline", "contacts", "finance", "dashboard", "game"],
  }),

  defineTool({
    name: "add_deal_contact",
    section: "pipeline",
    action: "update",
    kind: "write",
    risk: "instant",
    description:
      "Add another contact to a deal, with an optional note on their role. The first contact becomes the primary one.",
    input: z.object({ dealId: uuid, contactId: uuid, note: z.string().trim().max(200).optional() }),
    describe: (_input, t) => t("add_deal_contact", { name: "", title: "" }),
    async execute(ctx, input) {
      const [deal, contact] = await Promise.all([
        readDeal(ctx, input.dealId),
        mustFind(
          ctx.db
            .from("contacts")
            .select("id, company_name, first_name, last_name")
            .eq("user_id", ctx.workspaceId)
            .eq("id", input.contactId)
            .maybeSingle(),
        ),
      ]);
      const row = await addDealContact(ops(ctx), {
        workspaceId: ctx.workspaceId,
        dealId: deal.id,
        contactId: contact.id,
        note: input.note ?? "",
        created: false,
      });
      return {
        output: { dealId: deal.id, contactId: contact.id, primary: row.is_primary },
        records: [inserted("deal_contacts", row.id)],
        summary: ctx.t("add_deal_contact", {
          name: quoted(contactName(contact)),
          title: quoted(deal.title),
        }),
        href: hrefs.deal(deal.id),
      };
    },
    undoable: true,
    invalidates: ["pipeline", "contacts"],
  }),

  defineTool({
    name: "delete_deal",
    section: "pipeline",
    action: "delete",
    kind: "write",
    risk: "confirm",
    description:
      "Delete a deal for good (its contact stays; tasks only on it go). The user confirms it first.",
    input: z.object({ dealId: uuid }),
    describe: (_input, t) => t("delete_deal", { title: "" }),
    async prepare(ctx, input) {
      const deal = await readDeal(ctx, input.dealId);
      return {
        summary: ctx.t("delete_deal", { title: quoted(deal.title) }),
        href: hrefs.deal(deal.id),
      };
    },
    async execute(ctx, input) {
      const deal = await readDeal(ctx, input.dealId);
      await deleteDeal(ops(ctx), deal.id);
      return {
        output: { deleted: true },
        summary: ctx.t("deleted_deal", { title: quoted(deal.title) }),
      };
    },
    undoable: false,
    invalidates: ["pipeline", "contacts", "crmTasks", "calendar"],
  }),
];
