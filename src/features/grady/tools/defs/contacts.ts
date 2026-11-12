import { z } from "zod";
import { answerErrors } from "@/features/contacts/move-form";
import {
  addActivity,
  createContact,
  deleteContact,
  moveContactToTable,
  updateContact,
} from "@/features/contacts/ops";
import { contactSchema, NOTES_MAX } from "@/features/contacts/schemas";
import {
  CONTACT_COLUMNS,
  contactName,
  FIELD_COLUMNS,
  MANUAL_ACTIVITY_TYPES,
} from "@/features/contacts/types";
import { toE164 } from "@/lib/phone";
import { defineTool, ToolError, type ToolContext } from "../types";
import {
  hrefs,
  instant,
  inserted,
  mustFind,
  ops,
  previousOf,
  quoted,
  updated,
  uuid,
} from "./shared";

const text = (max: number) => z.string().trim().max(max);

const contactFields = {
  companyName: text(120).optional(),
  firstName: text(120).optional(),
  lastName: text(120).optional(),
  email: text(254).optional(),
  phone: text(40).optional(),
  website: text(300).optional(),
  address: text(300).optional(),
  city: text(120).optional(),
};

type ContactFields = { [K in keyof typeof contactFields]?: string };

/** The tool's fields as the contact form saves them (phones in E.164). */
function toRow(ctx: ToolContext, input: ContactFields, base?: Record<string, string | null>) {
  const pick = (value: string | undefined, column: string) => value ?? base?.[column] ?? "";
  const parsed = contactSchema.safeParse({
    company_name: pick(input.companyName, "company_name"),
    first_name: pick(input.firstName, "first_name"),
    last_name: pick(input.lastName, "last_name"),
    email: pick(input.email, "email"),
    phone:
      input.phone !== undefined ? (toE164(input.phone, ctx.country) ?? "") : (base?.phone ?? ""),
    website: pick(input.website, "website"),
    address: pick(input.address, "address"),
    city: pick(input.city, "city"),
  });
  if (!parsed.success)
    throw new ToolError("invalid", parsed.error.issues.map((issue) => issue.message).join(", "));
  return parsed.data;
}

async function readContact(ctx: ToolContext, id: string) {
  return mustFind(
    ctx.db
      .from("contacts")
      .select(CONTACT_COLUMNS)
      .eq("user_id", ctx.workspaceId)
      .eq("id", id)
      .maybeSingle(),
  );
}

export const contactTools = [
  defineTool({
    name: "create_contact",
    section: "contacts",
    action: "create",
    kind: "write",
    risk: "instant",
    description:
      "Create a contact (a company and / or a person, at least one name). It lands in the Unreached table. Phone as the user wrote it; it is saved in international form.",
    input: z.object({ ...contactFields, notes: text(NOTES_MAX).optional() }),
    describe: (input, t) =>
      t("create_contact", {
        name: quoted(
          input.companyName || [input.firstName, input.lastName].filter(Boolean).join(" "),
        ),
      }),
    async execute(ctx, input) {
      const row = toRow(ctx, input);
      const contact = await createContact(ops(ctx), {
        workspaceId: ctx.workspaceId,
        input: { ...row, ...(input.notes ? { notes: input.notes } : {}) },
        where: "grady",
      });
      return {
        output: { contactId: contact.id },
        records: [inserted("contacts", contact.id)],
        summary: ctx.t("create_contact", { name: quoted(contactName(contact)) }),
        href: hrefs.contact(contact.id),
      };
    },
    undoable: true,
    invalidates: ["contacts", "cold-calling"],
  }),

  defineTool({
    name: "update_contact",
    section: "contacts",
    action: "update",
    kind: "write",
    risk: "instant",
    description:
      "Change a contact's details or its note. Only the fields given change; an empty string clears a field.",
    input: z.object({ contactId: uuid, ...contactFields, notes: text(NOTES_MAX).optional() }),
    describe: (_input, t) => t("update_contact", { name: "" }),
    async execute(ctx, input) {
      const contact = await readContact(ctx, input.contactId);
      const { contactId, notes, ...fields } = input;
      const row = toRow(ctx, fields, contact as unknown as Record<string, string | null>);
      const patch = { ...row, ...(notes !== undefined ? { notes: notes || null } : {}) };
      const saved = await updateContact(ops(ctx), {
        workspaceId: ctx.workspaceId,
        id: contactId,
        patch,
      });
      return {
        output: { contactId },
        records: [updated("contacts", contactId, previousOf(contact, patch))],
        summary: ctx.t("update_contact", { name: quoted(contactName(saved)) }),
        href: hrefs.contact(contactId),
      };
    },
    undoable: true,
    invalidates: ["contacts"],
  }),

  defineTool({
    name: "move_contact",
    section: "contacts",
    action: "update",
    alsoAllowedBy: { section: "cold_calling", action: "call" },
    kind: "write",
    risk: "instant",
    description:
      "Move a contact into another table with answers to that table's questions (keyed by field id from list_contact_tables; dates YYYY-MM-DD, date-times ISO with offset, select = option key, boolean = true/false). Required questions must be answered; a meeting question books a calendar event.",
    input: z.object({
      contactId: uuid,
      tableId: uuid,
      answers: z.record(z.string(), z.union([z.string().max(5000), z.boolean()])).optional(),
    }),
    describe: (_input, t) => t("move_contact", { name: "", table: "" }),
    async execute(ctx, input) {
      const contact = await readContact(ctx, input.contactId);
      const [table, fields, entry] = await Promise.all([
        mustFind(
          ctx.db
            .from("contact_tables")
            .select("id, name, system_key")
            .eq("user_id", ctx.workspaceId)
            .eq("id", input.tableId)
            .maybeSingle(),
        ),
        ctx.db
          .from("contact_table_fields")
          .select(FIELD_COLUMNS)
          .eq("table_id", input.tableId)
          .limit(100),
        ctx.db
          .from("contact_table_entries")
          .select("table:contact_tables(id, name, system_key)")
          .eq("contact_id", input.contactId)
          .maybeSingle(),
      ]);
      if (fields.error) throw fields.error;
      const answers = input.answers ?? {};
      const problems = answerErrors(fields.data, answers);
      if (Object.keys(problems).length) {
        throw new ToolError(
          "answersInvalid",
          Object.entries(problems)
            .map(
              ([id, problem]) =>
                `${fields.data.find((field) => field.id === id)?.label ?? id}: ${problem}`,
            )
            .join("; "),
        );
      }
      const from = entry.data?.table ?? null;
      const { meetingBooked } = await moveContactToTable(ops(ctx), {
        contactId: contact.id,
        from,
        table,
        fields: fields.data,
        answers,
      });
      return {
        output: { contactId: contact.id, tableId: table.id, meetingBooked },
        summary: ctx.t("move_contact", {
          name: quoted(contactName(contact)),
          table: quoted(table.name),
        }),
        href: hrefs.contact(contact.id),
        awards: [
          { reason: "contact_moved" },
          ...(meetingBooked ? [{ reason: "meeting_booked" as const }] : []),
        ],
      };
    },
    // A move answers questions and may book a meeting: it is taken back by moving the contact again.
    undoable: false,
    invalidates: ["contacts", "calendar", "cold-calling", "pipeline"],
  }),

  defineTool({
    name: "add_contact_activity",
    section: "contacts",
    action: "update",
    alsoAllowedBy: { section: "cold_calling", action: "call" },
    kind: "write",
    risk: "instant",
    description:
      "Record a call, e-mail, meeting, SMS or note with a contact in its history (now, or when it happened).",
    input: z.object({
      contactId: uuid,
      type: z.enum(MANUAL_ACTIVITY_TYPES),
      content: text(5000).optional(),
      occurredAt: instant.optional(),
    }),
    describe: (input, t) => t("add_contact_activity", { name: "", type: input.type }),
    async execute(ctx, input) {
      const contact = await readContact(ctx, input.contactId);
      const occurred = input.occurredAt ?? new Date().toISOString();
      if (Date.parse(occurred) > Date.now() + 60_000) throw new ToolError("occurredInFuture");
      const activity = await addActivity(ops(ctx), {
        workspaceId: ctx.workspaceId,
        contactId: contact.id,
        input: { type: input.type, content: input.content || null, occurred_at: occurred },
      });
      return {
        output: { activityId: activity.id },
        records: [inserted("contact_activities", activity.id)],
        summary: ctx.t("add_contact_activity", {
          name: quoted(contactName(contact)),
          type: input.type,
        }),
        href: hrefs.contact(contact.id),
      };
    },
    undoable: true,
    invalidates: ["contacts", "pipeline"],
  }),

  defineTool({
    name: "delete_contact",
    section: "contacts",
    action: "delete",
    kind: "write",
    risk: "confirm",
    description:
      "Delete a contact for good (its deals stay without it, its tasks that hang only on it go). The user confirms it first.",
    input: z.object({ contactId: uuid }),
    count: () => 1,
    describe: (_input, t) => t("delete_contact", { name: "" }),
    async prepare(ctx, input) {
      const contact = await readContact(ctx, input.contactId);
      return {
        summary: ctx.t("delete_contact", { name: quoted(contactName(contact)) }),
        href: hrefs.contact(contact.id),
      };
    },
    async execute(ctx, input) {
      const contact = await readContact(ctx, input.contactId);
      await deleteContact(ops(ctx), { workspaceId: ctx.workspaceId, id: contact.id });
      return {
        output: { deleted: true },
        summary: ctx.t("deleted_contact", { name: quoted(contactName(contact)) }),
      };
    },
    undoable: false,
    invalidates: ["contacts", "pipeline", "crmTasks", "cold-calling"],
  }),
];
