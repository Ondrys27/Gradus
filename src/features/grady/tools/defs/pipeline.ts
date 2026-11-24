import { z } from "zod";
import { can } from "@/features/account/workspace";
import { contactName } from "@/features/contacts/types";
import {
  addDealContact,
  createDeal,
  moveDeal,
  nextDealPositionIn,
  patchDeal,
  setDealAssignees,
} from "@/features/pipeline/ops";
import { MAX_DEAL_ASSIGNEES } from "@/features/pipeline/assignees";
import { dealSchema, DESCRIPTION_MAX, REASON_MAX, TITLE_MAX } from "@/features/pipeline/schemas";
import { STAGE_COLUMNS, type Stage } from "@/features/pipeline/types";
import { isCurrencyShape } from "@/lib/currency";
import { defineTool, ToolError, type ToolContext } from "../types";
import {
  hrefs,
  inserted,
  instant,
  isoDate,
  mustFind,
  ops,
  previousOf,
  quoted,
  updated,
  uuid,
} from "./shared";
import { restoreTrashed, trashed, trashRecord } from "./trash";

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
/** A history entry: the summary of a meeting fits, a transcript goes into an attachment. */
const HISTORY_MAX = 5000;
/** The deal_attachments limit (a long transcript). */
export const ATTACHMENT_MAX = 400_000;

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
      "Change a deal's title, value, currency, Close Date, delivery date (deadlineDate) or description. The stage changes only with move_deal_stage, the people on it only with set_deal_people.",
    input: z.object({
      dealId: uuid,
      title: z.string().trim().min(1).max(TITLE_MAX).optional(),
      value: amount.nullable().optional(),
      currency: z.string().length(3).optional(),
      closeDate: isoDate.nullable().optional(),
      deadlineDate: isoDate.nullable().optional(),
      description: z.string().trim().max(DESCRIPTION_MAX).optional(),
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
    name: "set_deal_people",
    section: "pipeline",
    action: "update",
    kind: "write",
    risk: "instant",
    description:
      "Set everyone who works on a deal, all equal (user ids of the owner and active workers, from list_people): the whole list, at least one. Add a person by passing the current people plus them; current people are in get_record / list_deals as people.",
    input: z.object({
      dealId: uuid,
      assigneeIds: z.array(uuid).min(1).max(MAX_DEAL_ASSIGNEES),
    }),
    describe: (_input, t) => t("set_deal_people", { title: "" }),
    async execute(ctx, input) {
      const deal = await readDeal(ctx, input.dealId);
      const { data: current, error } = await ctx.db
        .from("deal_assignees")
        .select("assignee_id")
        .eq("deal_id", deal.id)
        .limit(MAX_DEAL_ASSIGNEES);
      if (error) throw error;
      // Without "all deals" the user stays on it, as on the screen.
      if (!can(ctx.workspace, "pipeline", "view_all") && !input.assigneeIds.includes(ctx.userId)) {
        throw new ToolError("forbidden", "The user must stay on the deal.");
      }
      try {
        await setDealAssignees(ops(ctx), {
          dealId: deal.id,
          before: current.map((row) => row.assignee_id),
          ids: input.assigneeIds,
          from: "grady",
        });
      } catch (cause) {
        const message = (cause as { message?: string } | null)?.message ?? "";
        if (message.includes("deal_assignee_outside")) {
          throw new ToolError(
            "invalid",
            "Someone is not the owner or an active worker of the space.",
          );
        }
        throw cause;
      }
      return {
        output: { dealId: deal.id, people: input.assigneeIds.length },
        // The whole list as it was and as it is now; Undo sets the old list again.
        records: [
          {
            table: "deals",
            match: { id: deal.id },
            op: "update",
            before: { assignees: current.map((row) => row.assignee_id).sort() },
            after: { assignees: [...new Set(input.assigneeIds)].sort() },
          },
        ],
        summary: ctx.t("set_deal_people", { title: quoted(deal.title) }),
        href: hrefs.deal(deal.id),
      };
    },
    // The whole list changes at once: taken back by setting the old list again.
    undoable: true,
    async undo(ctx, records) {
      for (const record of records) {
        const dealId = String(record.match.id);
        const { data, error } = await ctx.db
          .from("deal_assignees")
          .select("assignee_id")
          .eq("deal_id", dealId)
          .limit(MAX_DEAL_ASSIGNEES);
        if (error) return { ok: false, reason: "failed" };
        const now = data.map((row) => row.assignee_id).sort();
        if (JSON.stringify(now) !== JSON.stringify(record.after?.assignees ?? null)) {
          return { ok: false, reason: "changed" };
        }
        const back = (record.before?.assignees as string[] | undefined) ?? [];
        if (!back.length) return { ok: false, reason: "gone" };
        try {
          await setDealAssignees(ops(ctx), { dealId, before: now, ids: back, from: "grady" });
        } catch {
          return { ok: false, reason: "failed" };
        }
      }
      return { ok: true };
    },
    invalidates: ["pipeline", "dashboard"],
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
        // The stage and the reason, as they were, and the stage it went to (Undo
        // moves it back only from there). A win's booked income stays (Finance).
        records: [
          {
            ...updated("deals", deal.id, {
              stage_id: deal.stage_id,
              lost_reason: deal.lost_reason,
            }),
            after: { stage_id: stage.id },
          },
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
    // Undo is a move back like on the board: the contact stays in Clients and a
    // win's booked income and XP stay, exactly as when the user drags it back.
    undoable: true,
    async undo(ctx, records) {
      for (const record of [...records].reverse()) {
        if (record.table !== "deals" || record.op !== "update") continue;
        const dealId = String(record.match.id);
        const deal = await ctx.db
          .from("deals")
          .select("id, stage_id, value, currency, entered_stage_at, created_at")
          .eq("user_id", ctx.workspaceId)
          .eq("id", dealId)
          .maybeSingle();
        if (deal.error) return { ok: false, reason: "failed" };
        if (!deal.data) return { ok: false, reason: "gone" };
        if (deal.data.stage_id !== record.after?.stage_id) return { ok: false, reason: "changed" };
        const stages = await stagesOf(ctx);
        const back = stages.find((item) => item.id === record.before?.stage_id);
        if (!back) return { ok: false, reason: "gone" };
        try {
          await moveDeal(ops(ctx), {
            deal: deal.data,
            stage: back,
            lostReason: (record.before?.lost_reason as string | null) ?? undefined,
            position: await nextDealPositionIn(ops(ctx), ctx.workspaceId, back.id),
            stages,
          });
        } catch (error) {
          console.error("grady undo of a stage move failed", (error as { code?: string }).code);
          return { ok: false, reason: "failed" };
        }
      }
      return { ok: true };
    },
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
    level: "delete",
    section: "pipeline",
    action: "delete",
    kind: "write",
    risk: "confirm",
    description:
      "Move a deal to the trash (its contact stays; its tasks and Date of realisation go with it); restore_from_trash brings it back within the trash's retention (7 days by default). The user confirms it first.",
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
      await trashRecord(ctx, "deal", deal.id);
      ctx.track("deal_deleted", {});
      return {
        output: { deleted: true, inTrash: true },
        summary: ctx.t("deleted_deal", { title: quoted(deal.title) }),
        records: [trashed("deals", deal.id)],
      };
    },
    undoable: true,
    undo: (ctx, records) => restoreTrashed(ctx, "deal", records),
    invalidates: ["pipeline", "contacts", "crmTasks", "calendar"],
  }),

  defineTool({
    name: "add_deal_history_entry",
    section: "contacts",
    action: "update",
    alsoAllowedBy: { section: "cold_calling", action: "call" },
    kind: "write",
    risk: "instant",
    description:
      "Write an entry into a deal's history: a meeting, call, e-mail or note with its text (e.g. the summary of a meeting), on the deal's primary contact or another contact of the deal. A deal without a contact has no history entries; then write a note instead.",
    input: z.object({
      dealId: uuid,
      type: z.enum(["meeting", "call", "email", "note"]),
      content: z.string().trim().min(1).max(HISTORY_MAX),
      contactId: uuid.optional(),
      occurredAt: instant.optional(),
    }),
    describe: (_input, t) => t("add_deal_history_entry", { title: "" }),
    async execute(ctx, input) {
      const deal = await readDeal(ctx, input.dealId);
      let contactId = input.contactId ?? deal.contact_id;
      if (input.contactId && input.contactId !== deal.contact_id) {
        const link = await ctx.db
          .from("deal_contacts")
          .select("contact_id")
          .eq("deal_id", deal.id)
          .eq("contact_id", input.contactId)
          .maybeSingle();
        if (link.error) throw link.error;
        if (!link.data) throw new ToolError("notFound", "That contact is not on the deal.");
        contactId = input.contactId;
      }
      if (!contactId) throw new ToolError("dealWithoutContact");
      const occurred = input.occurredAt ?? new Date().toISOString();
      if (Date.parse(occurred) > Date.now() + 60_000) throw new ToolError("occurredInFuture");
      const { data, error } = await ctx.db
        .from("contact_activities")
        .insert({
          user_id: ctx.workspaceId,
          contact_id: contactId,
          deal_id: deal.id,
          type: input.type,
          content: input.content,
          occurred_at: occurred,
        })
        .select("id")
        .single();
      if (error) throw error;
      ctx.track("contact_activity_logged", { type: input.type });
      return {
        output: { entryId: data.id },
        records: [inserted("contact_activities", data.id)],
        summary: ctx.t("add_deal_history_entry", { title: quoted(deal.title) }),
        href: hrefs.deal(deal.id),
      };
    },
    undoable: true,
    invalidates: ["pipeline", "contacts"],
  }),

  defineTool({
    name: "save_deal_attachment",
    section: "pipeline",
    action: "update",
    kind: "write",
    risk: "instant",
    description:
      "Keep a text with a deal as its attachment (the transcript of a meeting), only when the user asks for it.",
    input: z.object({
      dealId: uuid,
      name: z.string().trim().min(1).max(200),
      content: z.string().min(1).max(ATTACHMENT_MAX),
    }),
    describe: (input, t) => t("save_deal_attachment", { name: quoted(input.name), title: "" }),
    async execute(ctx, input) {
      const deal = await readDeal(ctx, input.dealId);
      const { data, error } = await ctx.db
        .from("deal_attachments")
        .insert({
          user_id: ctx.workspaceId,
          deal_id: deal.id,
          name: input.name,
          content: input.content,
          created_by: ctx.userId,
        })
        .select("id")
        .single();
      if (error) throw error;
      return {
        output: { attachmentId: data.id },
        records: [inserted("deal_attachments", data.id)],
        summary: ctx.t("save_deal_attachment", {
          name: quoted(input.name),
          title: quoted(deal.title),
        }),
        href: hrefs.deal(deal.id),
      };
    },
    undoable: true,
    invalidates: ["pipeline"],
  }),
];
