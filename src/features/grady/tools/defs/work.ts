import { z } from "zod";
import { can } from "@/features/account/workspace";
import {
  DEFAULT_DURATION,
  DESCRIPTION_MAX as TASK_DESCRIPTION_MAX,
  DURATION_MAX,
  NOTE_MAX,
  taskInputSchema,
  TITLE_MAX as TASK_TITLE_MAX,
} from "@/features/crm-tasks/logic";
import {
  completeCrmTask,
  createCrmTask,
  deleteCrmTask,
  reopenCrmTask,
  toCrmTaskRow,
  updateCrmTask,
} from "@/features/crm-tasks/ops";
import { createEvent, deleteEvent, updateEvent } from "@/features/calendar/ops";
import {
  DESCRIPTION_MAX as EVENT_DESCRIPTION_MAX,
  eventSchema,
  TITLE_MAX as EVENT_TITLE_MAX,
} from "@/features/calendar/schemas";
import { EVENT_KINDS } from "@/features/calendar/types";
import { zonedWallClockToInstant } from "@/lib/format";
import { defineTool, ToolError, type ToolContext } from "../types";
import {
  hrefs,
  instant,
  inserted,
  isoDate,
  mustFind,
  ops,
  previousOf,
  quoted,
  today,
  updated,
  uuid,
} from "./shared";

/** Sales tasks (crm_tasks) and calendar events. */

async function readCrmTask(ctx: ToolContext, id: string) {
  return mustFind(
    ctx.db
      .from("crm_tasks")
      .select(
        "id, title, description, due_at, duration_minutes, assignee_id, deal_id, contact_id, status, completion_note",
      )
      .eq("user_id", ctx.workspaceId)
      .eq("id", id)
      .maybeSingle(),
  );
}

async function readEvent(ctx: ToolContext, id: string) {
  return mustFind(
    ctx.db
      .from("calendar_events")
      .select(
        "id, title, kind, starts_at, ends_at, all_day, description, contact_id, deal_id, source",
      )
      .eq("user_id", ctx.workspaceId)
      .eq("id", id)
      .maybeSingle(),
  );
}

/** A deal's delivery date is the database's own event: the calendar only opens the deal. */
function assertOwnEvent(event: { source: string }) {
  if (event.source === "deal_deadline") {
    throw new ToolError(
      "dealDeadline",
      "This event follows the deal's delivery date; change the deal instead.",
    );
  }
}

const HOUR_MS = 3_600_000;

export const crmTaskTools = [
  defineTool({
    name: "create_crm_task",
    section: "tasks",
    action: "create",
    kind: "write",
    risk: "instant",
    description:
      "Create a sales task on a deal and / or a contact (at least one), due at a moment (ISO with offset; default tomorrow 9:00 in the user's time zone), lasting durationMinutes (default 15), assigned to a person of list_people (default the user).",
    input: z.object({
      title: z.string().trim().min(1).max(TASK_TITLE_MAX),
      dealId: uuid.optional(),
      contactId: uuid.optional(),
      dueAt: instant.optional(),
      durationMinutes: z.number().int().min(1).max(DURATION_MAX).optional(),
      assigneeId: uuid.optional(),
      description: z.string().trim().max(TASK_DESCRIPTION_MAX).optional(),
    }),
    describe: (input, t) => t("create_crm_task", { title: quoted(input.title) }),
    async execute(ctx, input) {
      if (
        input.assigneeId &&
        input.assigneeId !== ctx.userId &&
        !can(ctx.workspace, "tasks", "assign_others")
      ) {
        throw new ToolError("forbidden", "The user may not assign tasks to others.");
      }
      const parsed = taskInputSchema.safeParse({
        title: input.title,
        description: input.description ?? "",
        due_at:
          input.dueAt ??
          zonedWallClockToInstant(today(ctx).tomorrow, "09:00", ctx.timezone).toISOString(),
        duration_minutes: input.durationMinutes ?? DEFAULT_DURATION,
        assignee_id: input.assigneeId ?? null,
        deal_id: input.dealId ?? null,
        contact_id: input.contactId ?? null,
      });
      if (!parsed.success) throw new ToolError("invalid", "A task needs a deal or a contact.");
      const task = await createCrmTask(ops(ctx), {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        input: parsed.data,
        from: "grady",
      });
      return {
        output: { taskId: task.id },
        records: [inserted("crm_tasks", task.id)],
        href: hrefs.crmTask(task.id),
      };
    },
    undoable: true,
    invalidates: ["crmTasks", "pipeline", "contacts", "calendar", "dashboard"],
  }),

  defineTool({
    name: "update_crm_task",
    section: "tasks",
    action: "update",
    kind: "write",
    risk: "instant",
    description: "Change a sales task: title, description, due moment, duration or who does it.",
    input: z.object({
      taskId: uuid,
      title: z.string().trim().min(1).max(TASK_TITLE_MAX).optional(),
      description: z.string().trim().max(TASK_DESCRIPTION_MAX).optional(),
      dueAt: instant.optional(),
      durationMinutes: z.number().int().min(1).max(DURATION_MAX).optional(),
      assigneeId: uuid.optional(),
    }),
    describe: (_input, t) => t("update_crm_task", { title: "" }),
    async execute(ctx, input) {
      const task = await readCrmTask(ctx, input.taskId);
      if (
        input.assigneeId &&
        input.assigneeId !== task.assignee_id &&
        !can(ctx.workspace, "tasks", "assign_others")
      ) {
        throw new ToolError("forbidden", "The user may not assign tasks to others.");
      }
      const row = toCrmTaskRow({
        title: input.title ?? task.title,
        description: input.description ?? task.description ?? "",
        due_at: input.dueAt ?? task.due_at,
        duration_minutes: input.durationMinutes ?? task.duration_minutes,
        assignee_id: input.assigneeId ?? task.assignee_id,
        deal_id: task.deal_id,
        contact_id: task.contact_id,
      });
      await updateCrmTask(ops(ctx), task.id, row, "form");
      return {
        output: { taskId: task.id },
        records: [updated("crm_tasks", task.id, previousOf(task, row))],
        summary: ctx.t("update_crm_task", { title: quoted(row.title) }),
        href: hrefs.crmTask(task.id),
      };
    },
    undoable: true,
    invalidates: ["crmTasks", "pipeline", "calendar", "dashboard"],
  }),

  defineTool({
    name: "complete_crm_task",
    section: "tasks",
    action: "view",
    kind: "write",
    risk: "instant",
    description:
      "Mark a sales task done, with an optional note on how it went (it shows in the deal's and contact's history).",
    input: z.object({ taskId: uuid, note: z.string().trim().max(NOTE_MAX).optional() }),
    describe: (_input, t) => t("complete_crm_task", { title: "" }),
    async execute(ctx, input) {
      const task = await readCrmTask(ctx, input.taskId);
      if (task.status === "done") throw new ToolError("alreadyDone");
      await completeCrmTask(ops(ctx), task, input.note ?? "");
      return {
        output: { taskId: task.id, status: "done" },
        records: [
          updated("crm_tasks", task.id, {
            status: task.status,
            completion_note: task.completion_note,
          }),
        ],
        summary: ctx.t("complete_crm_task", { title: quoted(task.title) }),
        href: hrefs.crmTask(task.id),
      };
    },
    undoable: true,
    invalidates: ["crmTasks", "pipeline", "contacts", "dashboard"],
  }),

  defineTool({
    name: "reopen_crm_task",
    section: "tasks",
    action: "view",
    kind: "write",
    risk: "instant",
    description: "Put a done sales task back among the open ones (its note goes).",
    input: z.object({ taskId: uuid }),
    describe: (_input, t) => t("reopen_crm_task", { title: "" }),
    async execute(ctx, input) {
      const task = await readCrmTask(ctx, input.taskId);
      if (task.status !== "done") throw new ToolError("alreadyOpen");
      await reopenCrmTask(ops(ctx), task.id);
      return {
        output: { taskId: task.id, status: "open" },
        records: [
          updated("crm_tasks", task.id, { status: "done", completion_note: task.completion_note }),
        ],
        summary: ctx.t("reopen_crm_task", { title: quoted(task.title) }),
        href: hrefs.crmTask(task.id),
      };
    },
    undoable: true,
    invalidates: ["crmTasks", "pipeline", "contacts", "dashboard"],
  }),

  defineTool({
    name: "delete_crm_task",
    section: "tasks",
    action: "delete",
    kind: "write",
    risk: "confirm",
    description: "Delete a sales task for good. The user confirms it first.",
    input: z.object({ taskId: uuid }),
    describe: (_input, t) => t("delete_crm_task", { title: "" }),
    async prepare(ctx, input) {
      const task = await readCrmTask(ctx, input.taskId);
      return {
        summary: ctx.t("delete_crm_task", { title: quoted(task.title) }),
        href: hrefs.crmTask(task.id),
      };
    },
    async execute(ctx, input) {
      const task = await readCrmTask(ctx, input.taskId);
      await deleteCrmTask(ops(ctx), task.id);
      return {
        output: { deleted: true },
        summary: ctx.t("deleted_crm_task", { title: quoted(task.title) }),
      };
    },
    undoable: false,
    invalidates: ["crmTasks", "pipeline", "contacts", "calendar", "dashboard"],
  }),
];

export const calendarTools = [
  defineTool({
    name: "create_event",
    section: "calendar",
    action: "create",
    kind: "write",
    risk: "instant",
    description:
      "Create a calendar event: a meeting, task or deadline, with a start and end (ISO with offset; default one hour) or all day on a date, optionally for a contact or a deal.",
    input: z.object({
      title: z.string().trim().min(1).max(EVENT_TITLE_MAX),
      kind: z.enum(EVENT_KINDS).optional(),
      startsAt: instant.optional(),
      endsAt: instant.optional(),
      allDayDate: isoDate.optional(),
      description: z.string().trim().max(EVENT_DESCRIPTION_MAX).optional(),
      contactId: uuid.optional(),
      dealId: uuid.optional(),
    }),
    describe: (input, t) => t("create_event", { title: quoted(input.title) }),
    async execute(ctx, input) {
      if (!input.allDayDate && !input.startsAt)
        throw new ToolError("invalid", "Give startsAt or allDayDate.");
      const allDay = Boolean(input.allDayDate);
      const startsAt = allDay
        ? zonedWallClockToInstant(input.allDayDate!, "00:00", ctx.timezone).toISOString()
        : new Date(input.startsAt!).toISOString();
      const endsAt = allDay
        ? null
        : new Date(
            input.endsAt ?? new Date(Date.parse(startsAt) + HOUR_MS).toISOString(),
          ).toISOString();
      const parsed = eventSchema.safeParse({
        title: input.title,
        kind: input.kind ?? "meeting",
        starts_at: startsAt,
        ends_at: endsAt,
        all_day: allDay,
        description: input.description ?? "",
        contact_id: input.contactId ?? null,
        deal_id: input.dealId ?? null,
      });
      if (!parsed.success)
        throw new ToolError(
          "invalid",
          parsed.error.issues.map((issue) => issue.message).join(", "),
        );
      const event = await createEvent(ops(ctx), {
        workspaceId: ctx.workspaceId,
        input: parsed.data,
      });
      const date = input.allDayDate ?? null;
      return {
        output: { eventId: event.id },
        records: [inserted("calendar_events", event.id)],
        href: hrefs.event(event.id, date ?? undefined),
        awards: [{ reason: parsed.data.kind === "meeting" ? "meeting_booked" : "calendar_event" }],
      };
    },
    undoable: true,
    invalidates: ["calendar", "dashboard", "pipeline", "contacts"],
  }),

  defineTool({
    name: "update_event",
    section: "calendar",
    action: "update",
    kind: "write",
    risk: "instant",
    description:
      "Change or move a calendar event: title, description, start and end (ISO with offset). Moving keeps its length when only startsAt is given.",
    input: z.object({
      eventId: uuid,
      title: z.string().trim().min(1).max(EVENT_TITLE_MAX).optional(),
      description: z.string().trim().max(EVENT_DESCRIPTION_MAX).optional(),
      startsAt: instant.optional(),
      endsAt: instant.optional(),
    }),
    describe: (_input, t) => t("update_event", { title: "" }),
    async execute(ctx, input) {
      const event = await readEvent(ctx, input.eventId);
      assertOwnEvent(event);
      const length = event.ends_at
        ? Date.parse(event.ends_at) - Date.parse(event.starts_at)
        : HOUR_MS;
      const startsAt = input.startsAt ? new Date(input.startsAt).toISOString() : undefined;
      const endsAt = input.endsAt
        ? new Date(input.endsAt).toISOString()
        : startsAt && !event.all_day
          ? new Date(Date.parse(startsAt) + length).toISOString()
          : undefined;
      const patch = {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(startsAt ? { starts_at: startsAt } : {}),
        ...(endsAt ? { ends_at: endsAt } : {}),
      };
      if (!Object.keys(patch).length) throw new ToolError("invalid", "Nothing to change.");
      if (
        (patch.ends_at ?? event.ends_at) &&
        (patch.ends_at ?? event.ends_at)! <= (patch.starts_at ?? event.starts_at) &&
        !event.all_day
      ) {
        throw new ToolError("invalid", "The end must be after the start.");
      }
      await updateEvent(ops(ctx), { id: event.id, patch, kind: event.kind });
      return {
        output: { eventId: event.id },
        records: [updated("calendar_events", event.id, previousOf(event, patch))],
        summary: ctx.t("update_event", { title: quoted(patch.title ?? event.title) }),
        href: hrefs.event(event.id),
      };
    },
    undoable: true,
    invalidates: ["calendar", "dashboard"],
  }),

  defineTool({
    name: "delete_event",
    section: "calendar",
    action: "update",
    kind: "write",
    risk: "confirm",
    description: "Delete a calendar event (its contact and deal stay). The user confirms it first.",
    input: z.object({ eventId: uuid }),
    describe: (_input, t) => t("delete_event", { title: "" }),
    async prepare(ctx, input) {
      const event = await readEvent(ctx, input.eventId);
      assertOwnEvent(event);
      return {
        summary: ctx.t("delete_event", { title: quoted(event.title) }),
        href: hrefs.event(event.id),
      };
    },
    async execute(ctx, input) {
      const event = await readEvent(ctx, input.eventId);
      assertOwnEvent(event);
      await deleteEvent(ops(ctx), event.id);
      return {
        output: { deleted: true },
        summary: ctx.t("deleted_event", { title: quoted(event.title) }),
      };
    },
    undoable: false,
    invalidates: ["calendar", "dashboard"],
  }),
];
