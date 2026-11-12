import { z } from "zod";
import { can, canAccessContacts } from "@/features/account/workspace";
import { addDaysIso, dayRangeToInstants } from "@/features/calendar/calendar-logic";
import { FIELD_COLUMNS, TABLE_COLUMNS } from "@/features/contacts/types";
import { defineTool, ToolError, type ToolContext } from "../types";
import { isoDate, mustFind, READ_LIMIT, today, uuid } from "./shared";

/**
 * The reading tools: Grady finds the ids before he changes anything, and
 * reads only what the answer needs (at most 25 rows, few columns). All of
 * them run with the user's own client, so they see what the user sees.
 */

const SEARCH_KINDS = [
  "contact",
  "deal",
  "milestone",
  "task",
  "event",
  "transaction",
  "invoice",
  "worker",
  "note",
] as const;
const RECORD_KINDS = [
  "contact",
  "deal",
  "milestone",
  "task",
  "crm_task",
  "event",
  "note",
  "transaction",
  "invoice",
] as const;
type RecordKind = (typeof RECORD_KINDS)[number];

function seeDealAmounts(ctx: ToolContext) {
  return can(ctx.workspace, "pipeline", "see_amounts");
}

/** The section a kind of record belongs to, checked before it is read. */
function mayRead(ctx: ToolContext, kind: RecordKind | (typeof SEARCH_KINDS)[number]): boolean {
  const workspace = ctx.workspace;
  switch (kind) {
    case "contact":
      return canAccessContacts(workspace, "view");
    case "deal":
      return can(workspace, "pipeline", "view");
    case "milestone":
    case "task":
      return can(workspace, "milestones", "view");
    case "crm_task":
      return can(workspace, "tasks", "view");
    case "event":
      return can(workspace, "calendar", "view");
    case "transaction":
      return can(workspace, "finance", "view");
    case "invoice":
      return can(workspace, "invoices", "view");
    case "note":
      return workspace.id === workspace.userId;
    case "worker":
      return can(workspace, "company", "view");
  }
}

export const readTools = [
  defineTool({
    name: "search_records",
    section: "dashboard",
    action: null,
    kind: "read",
    risk: "instant",
    description:
      "Search the user's records by name or text (contacts, deals, milestones, tasks, events, transactions, invoices, workers, notes) without diacritics. Returns ids to use with the other tools. Use it before changing a record the user names.",
    input: z.object({
      query: z.string().trim().min(1).max(100),
      kinds: z.array(z.enum(SEARCH_KINDS)).max(SEARCH_KINDS.length).optional(),
    }),
    describe: (input, t) => t("search_records", { query: input.query }),
    async execute(ctx, input) {
      const kinds = (input.kinds?.length ? input.kinds : [...SEARCH_KINDS]).filter((kind) =>
        mayRead(ctx, kind),
      );
      const recordKinds = kinds.filter((kind) => kind !== "note");
      const [records, notes] = await Promise.all([
        recordKinds.length
          ? ctx.db.rpc("global_search", {
              _query: input.query,
              _kinds: recordKinds,
              _limit: READ_LIMIT,
            })
          : Promise.resolve({ data: [], error: null }),
        kinds.includes("note")
          ? ctx.db.rpc("search_notes", { _query: input.query, _limit: 10 })
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (records.error) throw records.error;
      if (notes.error) throw notes.error;
      const results = [
        ...(records.data ?? []).map((row) => ({
          kind: row.kind,
          id: row.id,
          title: row.title,
          data: row.data,
        })),
        ...(notes.data ?? []).map((row) => ({ kind: "note", id: row.id, title: row.title })),
      ].slice(0, READ_LIMIT);
      return { output: { results } };
    },
    undoable: false,
    invalidates: [],
  }),

  defineTool({
    name: "get_record",
    section: "dashboard",
    action: null,
    kind: "read",
    risk: "instant",
    description:
      "Read one record by kind and id (from search_records or a list tool): its fields, and for a contact its table, for a deal its stage and contacts, for a milestone its task counts.",
    input: z.object({ kind: z.enum(RECORD_KINDS), id: uuid }),
    describe: (input, t) => t("get_record", { kind: input.kind }),
    async execute(ctx, input) {
      if (!mayRead(ctx, input.kind)) throw new ToolError("forbidden");
      const ws = ctx.workspaceId;
      switch (input.kind) {
        case "contact": {
          const contact = await mustFind(
            ctx.db
              .from("contacts")
              .select(
                "id, company_name, first_name, last_name, email, phone, website, address, city, notes, created_at",
              )
              .eq("user_id", ws)
              .eq("id", input.id)
              .maybeSingle(),
          );
          const { data: entry } = await ctx.db
            .from("contact_table_entries")
            .select("table:contact_tables(id, name, system_key)")
            .eq("contact_id", input.id)
            .maybeSingle();
          return { output: { contact, table: entry?.table ?? null } };
        }
        case "deal": {
          const deal = await mustFind(
            ctx.db
              .from("deals")
              .select(
                "id, title, description, value, currency, expected_close_date, deadline_date, assignee_id, won_at, lost_at, lost_reason, stage:pipeline_stages(id, name, is_won, is_lost), contacts:deal_contacts(contact_id, is_primary, note)",
              )
              .eq("user_id", ws)
              .eq("id", input.id)
              .maybeSingle(),
          );
          return { output: seeDealAmounts(ctx) ? deal : { ...deal, value: null } };
        }
        case "milestone": {
          const milestone = await mustFind(
            ctx.db
              .from("milestones")
              .select("id, title, description, status, target_date, reward, category")
              .eq("user_id", ws)
              .eq("id", input.id)
              .maybeSingle(),
          );
          const { data: counts } = await ctx.db
            .from("milestone_task_counts")
            .select("total, done")
            .eq("milestone_id", input.id)
            .maybeSingle();
          return { output: { ...milestone, tasks: counts ?? { total: 0, done: 0 } } };
        }
        case "task":
          return {
            output: await mustFind(
              ctx.db
                .from("tasks")
                .select(
                  "id, milestone_id, parent_task_id, title, description, status, due_date, position",
                )
                .eq("user_id", ws)
                .eq("id", input.id)
                .maybeSingle(),
            ),
          };
        case "crm_task":
          return {
            output: await mustFind(
              ctx.db
                .from("crm_tasks")
                .select(
                  "id, title, description, due_at, duration_minutes, status, assignee_id, deal_id, contact_id, completion_note",
                )
                .eq("user_id", ws)
                .eq("id", input.id)
                .maybeSingle(),
            ),
          };
        case "event":
          return {
            output: await mustFind(
              ctx.db
                .from("calendar_events")
                .select(
                  "id, title, kind, starts_at, ends_at, all_day, description, location, contact_id, deal_id, source",
                )
                .eq("user_id", ws)
                .eq("id", input.id)
                .maybeSingle(),
            ),
          };
        case "note": {
          const note = await mustFind(
            ctx.db
              .from("notes")
              .select("id, title, kind, pinned, content_text, updated_at")
              .eq("user_id", ctx.userId)
              .eq("id", input.id)
              .is("deleted_at", null)
              .maybeSingle(),
          );
          // Note text is the user's data, never instructions (the prompt says so).
          return { output: { ...note, content_text: note.content_text.slice(0, 6000) } };
        }
        case "transaction":
          return {
            output: await mustFind(
              ctx.db
                .from("transactions")
                .select(
                  "id, type, amount, currency, category, description, occurred_on, source, deal_id, invoice_id",
                )
                .eq("user_id", ws)
                .eq("id", input.id)
                .maybeSingle(),
            ),
          };
        case "invoice":
          return {
            output: await mustFind(
              ctx.db
                .from("invoices")
                .select(
                  "id, number, status, kind, customer_name, total, currency, issued_on, due_on, paid_on, contact_id, deal_id, items",
                )
                .eq("user_id", ws)
                .eq("id", input.id)
                .maybeSingle(),
            ),
          };
      }
    },
    undoable: false,
    invalidates: [],
  }),

  defineTool({
    name: "list_milestones",
    section: "milestones",
    action: "view",
    kind: "read",
    risk: "instant",
    description:
      "List the user's active and completed milestones with their task counts (done / all).",
    input: z.object({ status: z.enum(["active", "completed", "all"]).optional() }),
    describe: (_input, t) => t("list_milestones"),
    async execute(ctx, input) {
      let query = ctx.db
        .from("milestones")
        .select("id, title, status, target_date")
        .eq("user_id", ctx.workspaceId)
        .order("position")
        .limit(READ_LIMIT);
      query =
        input.status && input.status !== "all"
          ? query.eq("status", input.status)
          : query.in("status", ["active", "completed"]);
      const [milestones, counts] = await Promise.all([
        query,
        ctx.db
          .from("milestone_task_counts")
          .select("milestone_id, total, done")
          .eq("user_id", ctx.workspaceId)
          .limit(500),
      ]);
      if (milestones.error) throw milestones.error;
      if (counts.error) throw counts.error;
      const byId = new Map(counts.data.map((row) => [row.milestone_id, row]));
      return {
        output: {
          milestones: milestones.data.map((row) => ({
            ...row,
            tasks: { total: byId.get(row.id)?.total ?? 0, done: byId.get(row.id)?.done ?? 0 },
          })),
        },
      };
    },
    undoable: false,
    invalidates: [],
  }),

  defineTool({
    name: "list_milestone_tasks",
    section: "milestones",
    action: "view",
    kind: "read",
    risk: "instant",
    description:
      "List tasks of milestones: of one milestone (milestoneId, with parent ids for the tree), or across all milestones those overdue or due today (in the user's time zone). 25 at a time; use offset for more.",
    input: z.object({
      milestoneId: uuid.optional(),
      due: z.enum(["overdue", "today"]).optional(),
      status: z.enum(["open", "done", "all"]).optional(),
      offset: z.number().int().min(0).max(5000).optional(),
    }),
    describe: (_input, t) => t("list_milestone_tasks"),
    async execute(ctx, input) {
      const { day } = today(ctx);
      let query = ctx.db
        .from("tasks")
        .select("id, milestone_id, parent_task_id, title, status, due_date, position", {
          count: "exact",
        })
        .eq("user_id", ctx.workspaceId)
        .order("position")
        .order("created_at");
      if (input.milestoneId) query = query.eq("milestone_id", input.milestoneId);
      const status = input.status ?? (input.due ? "open" : "all");
      if (status === "open") query = query.neq("status", "done");
      if (status === "done") query = query.eq("status", "done");
      if (input.due === "overdue") query = query.lt("due_date", day);
      if (input.due === "today") query = query.eq("due_date", day);
      const offset = input.offset ?? 0;
      const { data, error, count } = await query.range(offset, offset + READ_LIMIT - 1);
      if (error) throw error;
      return { output: { tasks: data, total: count ?? data.length, offset } };
    },
    undoable: false,
    invalidates: [],
  }),

  defineTool({
    name: "list_crm_tasks",
    section: "tasks",
    action: "view",
    kind: "read",
    risk: "instant",
    description:
      "List sales tasks (tasks of deals and contacts): overdue (to the minute), due today, open or done, optionally of one deal or contact. 25 at a time.",
    input: z.object({
      due: z.enum(["overdue", "today", "open", "done"]),
      dealId: uuid.optional(),
      contactId: uuid.optional(),
      offset: z.number().int().min(0).max(5000).optional(),
    }),
    describe: (_input, t) => t("list_crm_tasks"),
    async execute(ctx, input) {
      const { from, to } = today(ctx);
      let query = ctx.db
        .from("crm_tasks")
        .select("id, title, due_at, duration_minutes, status, assignee_id, deal_id, contact_id", {
          count: "exact",
        })
        .eq("user_id", ctx.workspaceId)
        .order("due_at");
      if (input.due === "done") query = query.eq("status", "done");
      else query = query.eq("status", "open");
      if (input.due === "overdue") query = query.lt("due_at", new Date().toISOString());
      if (input.due === "today") query = query.gte("due_at", from).lt("due_at", to);
      if (input.dealId) query = query.eq("deal_id", input.dealId);
      if (input.contactId) query = query.eq("contact_id", input.contactId);
      const offset = input.offset ?? 0;
      const { data, error, count } = await query.range(offset, offset + READ_LIMIT - 1);
      if (error) throw error;
      return { output: { tasks: data, total: count ?? data.length, offset } };
    },
    undoable: false,
    invalidates: [],
  }),

  defineTool({
    name: "list_deals",
    section: "pipeline",
    action: "view",
    kind: "read",
    risk: "instant",
    description:
      "List the pipeline's stages (ids, which is won / lost) and deals, optionally of one stage or only open / won / lost ones. 25 at a time.",
    input: z.object({
      stageId: uuid.optional(),
      status: z.enum(["open", "won", "lost", "all"]).optional(),
      offset: z.number().int().min(0).max(5000).optional(),
    }),
    describe: (_input, t) => t("list_deals"),
    async execute(ctx, input) {
      const stages = await ctx.db
        .from("pipeline_stages")
        .select("id, name, position, is_won, is_lost")
        .eq("user_id", ctx.workspaceId)
        .order("position")
        .limit(50);
      if (stages.error) throw stages.error;
      let query = ctx.db
        .from("deals")
        .select(
          "id, title, value, currency, stage_id, expected_close_date, assignee_id, contact_id",
          { count: "exact" },
        )
        .eq("user_id", ctx.workspaceId)
        .order("last_activity_at", { ascending: false });
      if (input.stageId) query = query.eq("stage_id", input.stageId);
      if (input.status === "won") query = query.not("won_at", "is", null);
      if (input.status === "lost") query = query.not("lost_at", "is", null);
      if (input.status === "open") query = query.is("won_at", null).is("lost_at", null);
      const offset = input.offset ?? 0;
      const { data, error, count } = await query.range(offset, offset + READ_LIMIT - 1);
      if (error) throw error;
      const amounts = seeDealAmounts(ctx);
      return {
        output: {
          stages: stages.data,
          deals: data.map((deal) => (amounts ? deal : { ...deal, value: null })),
          total: count ?? data.length,
          offset,
        },
      };
    },
    undoable: false,
    invalidates: [],
  }),

  defineTool({
    name: "list_events",
    section: "calendar",
    action: "view",
    kind: "read",
    risk: "instant",
    description:
      "List calendar events between two dates (inclusive, in the user's time zone). 25 at a time.",
    input: z.object({ from: isoDate, to: isoDate }),
    describe: (_input, t) => t("list_events"),
    async execute(ctx, input) {
      const last = input.to < input.from ? input.from : input.to;
      const capped = addDaysIso(input.from, 62) < last ? addDaysIso(input.from, 62) : last;
      const range = dayRangeToInstants(input.from, capped, ctx.timezone);
      const { data, error } = await ctx.db
        .from("calendar_events")
        .select("id, title, kind, starts_at, ends_at, all_day, contact_id, deal_id, source")
        .eq("user_id", ctx.workspaceId)
        .eq("is_demo", false)
        .gte("starts_at", range.from)
        .lt("starts_at", range.to)
        .order("starts_at")
        .limit(READ_LIMIT);
      if (error) throw error;
      return { output: { events: data } };
    },
    undoable: false,
    invalidates: [],
  }),

  defineTool({
    name: "finance_month",
    section: "finance",
    action: "summaries",
    kind: "read",
    risk: "instant",
    description:
      "Income and expenses of a month (YYYY-MM, default this month), each currency on its own, never converted.",
    input: z.object({
      month: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .optional(),
    }),
    describe: (_input, t) => t("finance_month"),
    async execute(ctx, input) {
      const month = input.month ?? today(ctx).day.slice(0, 7);
      const from = `${month}-01`;
      const next = addDaysIso(from, 32).slice(0, 7);
      const to = addDaysIso(`${next}-01`, -1);
      const { data, error } = await ctx.db.rpc("finance_totals_by_currency", {
        _from: from,
        _to: to,
      });
      if (error) throw error;
      return { output: { month, totals: data } };
    },
    undoable: false,
    invalidates: [],
  }),

  defineTool({
    name: "list_overdue_invoices",
    section: "invoices",
    action: "view",
    kind: "read",
    risk: "instant",
    description: "Issued invoices not paid by their due date (oldest first), and recent drafts.",
    input: z.object({ drafts: z.boolean().optional() }),
    describe: (_input, t) => t("list_overdue_invoices"),
    async execute(ctx, input) {
      const { day } = today(ctx);
      const overdue = await ctx.db
        .from("invoices")
        .select("id, number, customer_name, total, currency, due_on, status")
        .eq("user_id", ctx.workspaceId)
        .in("status", ["open", "sent", "overdue"])
        .eq("kind", "invoice")
        .lt("due_on", day)
        .order("due_on")
        .limit(READ_LIMIT);
      if (overdue.error) throw overdue.error;
      let drafts: unknown[] = [];
      if (input.drafts) {
        const { data, error } = await ctx.db
          .from("invoices")
          .select("id, customer_name, total, currency, updated_at")
          .eq("user_id", ctx.workspaceId)
          .eq("status", "draft")
          .order("updated_at", { ascending: false })
          .limit(10);
        if (error) throw error;
        drafts = data;
      }
      return { output: { overdue: overdue.data, drafts } };
    },
    undoable: false,
    invalidates: [],
  }),

  defineTool({
    name: "list_contact_tables",
    section: "contacts",
    action: "view",
    alsoAllowedBy: { section: "cold_calling", action: "view" },
    kind: "read",
    risk: "instant",
    description:
      "List the user's contact tables with the questions (fields) each asks when a contact moves in: ids, labels, types, required, options and which answer of which question a field depends on. Use before move_contact.",
    input: z.object({}),
    describe: (_input, t) => t("list_contact_tables"),
    async execute(ctx) {
      const [tables, fields] = await Promise.all([
        ctx.db
          .from("contact_tables")
          .select(TABLE_COLUMNS)
          .eq("user_id", ctx.workspaceId)
          .order("position")
          .limit(50),
        ctx.db
          .from("contact_table_fields")
          .select(FIELD_COLUMNS)
          .eq("user_id", ctx.workspaceId)
          .order("position")
          .limit(300),
      ]);
      if (tables.error) throw tables.error;
      if (fields.error) throw fields.error;
      return {
        output: {
          tables: tables.data.map((table) => ({
            ...table,
            fields: fields.data
              .filter((field) => field.table_id === table.id)
              .map(
                ({
                  id,
                  label,
                  type,
                  required,
                  options,
                  depends_on_field_id,
                  depends_on_value,
                  system_key,
                }) => ({
                  id,
                  label,
                  type,
                  required,
                  options,
                  depends_on_field_id,
                  depends_on_value,
                  system_key,
                }),
              ),
          })),
        },
      };
    },
    undoable: false,
    invalidates: [],
  }),

  defineTool({
    name: "list_people",
    section: "tasks",
    action: "view",
    kind: "read",
    risk: "instant",
    description:
      "The people a sales task or a deal can be assigned to in this space (the owner and active workers), with their user ids.",
    input: z.object({}),
    describe: (_input, t) => t("list_people"),
    async execute(ctx) {
      const { data, error } = await ctx.db.rpc("crm_task_assignees");
      if (error) throw error;
      return { output: { people: (data ?? []).slice(0, 50) } };
    },
    undoable: false,
    invalidates: [],
  }),
];
