import { z } from "zod";
import { CHAT_BODY_MAX } from "@/features/chat/types";
import { deliverChatMessage } from "@/features/chat/server/deliver";
import { GROUP_TONES, type GroupTone } from "@/features/workers/company/tree";
import { moveWorker, removeWorker, saveGroup, saveWorkerGrants } from "@/features/workers/ops";
import {
  actionsOf,
  GRANT_ROWS_LIMIT,
  grantsFromRows,
  isGrantAction,
  isGrantSection,
  type PermissionGrants,
} from "@/features/workers/permissions-catalog";
import type { Json } from "@/types/database";
import type { UndoRecord } from "../records";
import { defineTool, ToolError, type ToolContext } from "../types";
import { hrefs, inserted, mustFind, ops, quoted, READ_LIMIT, updated, uuid } from "./shared";

/**
 * Company (the owner's alone: structure, groups, rights; removing someone
 * waits for Confirm) and Messages (a message is sent only after Confirm,
 * with its whole text on the card).
 */

async function readWorker(ctx: ToolContext, id: string) {
  return mustFind(
    ctx.db
      .from("workers")
      .select("id, name, manager_id, status, user_id")
      .eq("owner_id", ctx.workspaceId)
      .eq("id", id)
      .maybeSingle(),
  );
}

async function readGrants(ctx: ToolContext, workerId: string): Promise<PermissionGrants> {
  const { data, error } = await ctx.db
    .from("worker_permission_grants")
    .select("section, action, allowed")
    .eq("worker_id", workerId)
    .limit(GRANT_ROWS_LIMIT);
  if (error) throw error;
  return grantsFromRows(data);
}

export const companyTools = [
  defineTool({
    name: "list_workers",
    section: "company",
    action: "view",
    kind: "read",
    risk: "instant",
    description:
      "The people of the company the user may see (ids, names, job titles, who reports to whom, groups, status).",
    input: z.object({}),
    describe: (_input, t) => t("list_workers"),
    async execute(ctx) {
      const [people, groups] = await Promise.all([
        ctx.db.rpc("company_tree"),
        ctx.db.rpc("company_groups"),
      ]);
      if (people.error) throw people.error;
      if (groups.error) throw groups.error;
      return {
        output: {
          workers: (people.data ?? []).slice(0, 100).map((row) => ({
            id: row.id,
            name: row.name,
            jobTitle: row.job_title,
            managerId: row.manager_id,
            status: row.status,
            groupIds: row.group_ids,
          })),
          groups: (groups.data ?? []).slice(0, READ_LIMIT),
        },
      };
    },
    undoable: false,
    invalidates: [],
  }),

  defineTool({
    name: "move_worker",
    section: "company",
    action: "update",
    ownerOnly: true,
    kind: "write",
    risk: "instant",
    description:
      "Put a worker (with everyone under them) under another worker, or right under the owner (managerId null).",
    input: z.object({ workerId: uuid, managerId: uuid.nullable() }),
    describe: (_input, t) => t("move_worker", { name: "" }),
    async execute(ctx, input) {
      const worker = await readWorker(ctx, input.workerId);
      if (input.managerId) await readWorker(ctx, input.managerId);
      await moveWorker(ops(ctx), {
        ownerId: ctx.workspaceId,
        workerId: worker.id,
        managerId: input.managerId,
        via: "menu",
        depth: 0,
      });
      return {
        output: { workerId: worker.id, managerId: input.managerId },
        records: [updated("workers", worker.id, { manager_id: worker.manager_id })],
        summary: ctx.t("move_worker", { name: quoted(worker.name) }),
        href: hrefs.company,
      };
    },
    undoable: true,
    invalidates: ["workers"],
  }),

  defineTool({
    name: "save_worker_group",
    section: "company",
    action: "update",
    ownerOnly: true,
    kind: "write",
    risk: "instant",
    description:
      "Create a group of workers (or change one by groupId): name, colour (violet, teal, gold, green, pink, neutral), description and its members (worker ids; given = the whole new list).",
    input: z.object({
      groupId: uuid.optional(),
      name: z.string().trim().min(1).max(60),
      color: z.enum(GROUP_TONES).optional(),
      description: z.string().trim().max(500).optional(),
      memberIds: z.array(uuid).max(500).optional(),
    }),
    describe: (input, t) => t("save_worker_group", { name: quoted(input.name) }),
    async execute(ctx, input) {
      let existing: {
        id: string;
        memberIds: string[];
        color: string;
        description: string | null;
        name: string;
      } | null = null;
      if (input.groupId) {
        const group = await mustFind(
          ctx.db
            .from("worker_groups")
            .select("id, name, color, description")
            .eq("owner_id", ctx.workspaceId)
            .eq("id", input.groupId)
            .maybeSingle(),
        );
        const { data, error } = await ctx.db
          .from("worker_group_members")
          .select("worker_id")
          .eq("group_id", group.id)
          .limit(500);
        if (error) throw error;
        existing = { ...group, memberIds: data.map((row) => row.worker_id) };
      }
      const { count } = await ctx.db
        .from("worker_groups")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ctx.workspaceId);
      const memberIds = input.memberIds ?? existing?.memberIds ?? [];
      const groupId = await saveGroup(ops(ctx), {
        ownerId: ctx.workspaceId,
        group: {
          name: input.name,
          color: (input.color ?? existing?.color ?? "violet") as GroupTone,
          description: input.description ?? existing?.description ?? null,
          memberIds,
        },
        existing: existing ? { id: existing.id, memberIds: existing.memberIds } : null,
        position: count ?? 0,
      });
      // Undo of a changed group takes back the new members too; a removed membership can not
      // be written back the plain way, so such a change has no Undo.
      const added = existing ? memberIds.filter((id) => !existing.memberIds.includes(id)) : [];
      const removed = existing ? existing.memberIds.filter((id) => !memberIds.includes(id)) : [];
      const records: UndoRecord[] = !existing
        ? [inserted("worker_groups", groupId)]
        : removed.length
          ? []
          : [
              updated("worker_groups", groupId, {
                name: existing.name,
                color: existing.color,
                description: existing.description,
              }),
              ...added.map(
                (workerId): UndoRecord => ({
                  table: "worker_group_members",
                  match: { group_id: groupId, worker_id: workerId },
                  op: "insert",
                }),
              ),
            ];
      return {
        output: { groupId },
        records,
        summary: ctx.t(existing ? "update_worker_group" : "save_worker_group", {
          name: quoted(input.name),
        }),
        href: `${hrefs.company}?tab=groups`,
      };
    },
    // A new group goes whole; a changed one with its new members (see above).
    undoable: true,
    invalidates: ["workers"],
  }),

  defineTool({
    name: "set_worker_permissions",
    section: "company",
    action: "update",
    ownerOnly: true,
    kind: "write",
    risk: "instant",
    description:
      "Set what a worker may do in one section: the full list of allowed actions of the permission catalog for that section (e.g. pipeline: view, create, update, change_stage). Other sections stay.",
    input: z.object({
      workerId: uuid,
      section: z.string().min(1).max(40),
      actions: z.array(z.string().min(1).max(40)).max(20),
    }),
    describe: (input, t) => t("set_worker_permissions", { name: "", section: input.section }),
    async execute(ctx, input) {
      if (!isGrantSection(input.section)) throw new ToolError("invalid", "No such section.");
      const section = input.section;
      const unknown = input.actions.filter((action) => !isGrantAction(section, action));
      if (unknown.length) throw new ToolError("invalid", `Unknown actions: ${unknown.join(", ")}`);
      const worker = await readWorker(ctx, input.workerId);
      const before = await readGrants(ctx, worker.id);
      const allowed = actionsOf(section).filter((action) => input.actions.includes(action));
      const next = { ...before, [section]: allowed } as PermissionGrants;
      await saveWorkerGrants(ops(ctx), {
        ownerId: ctx.workspaceId,
        workerId: worker.id,
        grants: next,
      });
      return {
        output: { workerId: worker.id, section, actions: allowed },
        // Kept in the record for Undo; a grant row has no id of its own.
        records: [
          {
            table: "workers",
            match: { id: worker.id },
            op: "update",
            before: { grants: before as unknown as Json, section },
            // Noted here: the rights are no column of the worker's row.
            after: { actions: allowed },
            stamp: null,
          } satisfies UndoRecord,
        ],
        summary: ctx.t("set_worker_permissions", { name: quoted(worker.name), section }),
        href: hrefs.worker(worker.id),
      };
    },
    undoable: true,
    // The rights come back through the same write as the Rights tab's.
    async undo(ctx, records) {
      const record = records[0];
      const grants = record?.before?.grants as PermissionGrants | undefined;
      if (!record || !grants) return { ok: false, reason: "failed" };
      const section = String(record.before?.section ?? "");
      const now = await readGrants(ctx, String(record.match.id));
      const left = (record.after?.actions as string[] | undefined) ?? null;
      const current = (now[section as keyof PermissionGrants] ?? []) as readonly string[];
      if (left && JSON.stringify([...current].sort()) !== JSON.stringify([...left].sort())) {
        return { ok: false, reason: "changed" };
      }
      // Only this section goes back: a later change of another section stays.
      const key = section as keyof PermissionGrants;
      await saveWorkerGrants(ops(ctx), {
        ownerId: ctx.workspaceId,
        workerId: String(record.match.id),
        grants: { ...now, [key]: grants[key] ?? [] } as PermissionGrants,
      });
      return { ok: true };
    },
    invalidates: ["workers"],
  }),

  defineTool({
    name: "remove_worker",
    section: "company",
    action: "update",
    ownerOnly: true,
    kind: "write",
    risk: "confirm",
    description:
      "Remove a person from the company: their access ends at once, their data stays; their open deals and tasks go to the owner. The user confirms it first.",
    input: z.object({ workerId: uuid }),
    describe: (_input, t) => t("remove_worker", { name: "" }),
    async prepare(ctx, input) {
      const worker = await readWorker(ctx, input.workerId);
      if (worker.status === "inactive") throw new ToolError("alreadyRemoved");
      return {
        summary: ctx.t("remove_worker", { name: quoted(worker.name) }),
        href: hrefs.worker(worker.id),
      };
    },
    async execute(ctx, input) {
      const worker = await readWorker(ctx, input.workerId);
      const moved = await removeWorker(ops(ctx), {
        workerId: worker.id,
        assignee: ctx.userId,
        to: "owner",
      });
      return {
        output: { removed: true, ...moved },
        summary: ctx.t("removed_worker", { name: quoted(worker.name) }),
      };
    },
    undoable: false,
    invalidates: ["workers", "pipeline", "crmTasks", "chat"],
  }),
];

export const chatTools = [
  defineTool({
    name: "list_conversations",
    section: "chat",
    action: null,
    kind: "read",
    risk: "instant",
    description:
      "The user's conversations in Messages (group and direct) and the people they can write to (member tokens), to find where to send a message.",
    input: z.object({}),
    describe: (_input, t) => t("list_conversations"),
    async execute(ctx) {
      const [channels, people] = await Promise.all([
        ctx.db
          .from("chat_channels")
          .select("id, kind, name, archived_at")
          .eq("owner_id", ctx.workspaceId)
          .is("archived_at", null)
          .limit(READ_LIMIT),
        ctx.db.rpc("chat_people"),
      ]);
      if (channels.error) throw channels.error;
      if (people.error) throw people.error;
      return {
        output: {
          conversations: channels.data.map(({ id, kind, name }) => ({ id, kind, name })),
          people: (people.data ?? [])
            .filter((person) => person.status !== "inactive")
            .slice(0, 50)
            .map(({ member, name, job_title, is_owner }) => ({
              member,
              name,
              jobTitle: job_title,
              isOwner: is_owner,
            })),
        },
      };
    },
    undoable: false,
    invalidates: [],
  }),

  defineTool({
    name: "send_chat_message",
    section: "chat",
    action: null,
    kind: "write",
    risk: "confirm",
    description:
      "Send a message in Messages: into a conversation (conversationId) or to a person (member token from list_conversations). Write the whole text; the user sees it on the card and confirms before it is sent.",
    input: z
      .object({
        conversationId: uuid.optional(),
        to: z.string().min(1).max(64).optional(),
        text: z.string().trim().min(1).max(CHAT_BODY_MAX),
      })
      .refine(
        (value) => Boolean(value.conversationId) !== Boolean(value.to),
        "exactly one of conversationId, to",
      ),
    describe: (_input, t) => t("send_chat_message", { name: "" }),
    async prepare(ctx, input) {
      let name = "";
      if (input.conversationId) {
        const channel = await mustFind(
          ctx.db
            .from("chat_channels")
            .select("id, name, kind")
            .eq("id", input.conversationId)
            .maybeSingle(),
        );
        name = channel.name ?? "";
      } else {
        const { data, error } = await ctx.db.rpc("chat_people");
        if (error) throw error;
        const person = (data ?? []).find((row) => row.member === input.to);
        if (!person) throw new ToolError("notFound");
        name = person.name;
      }
      return {
        summary: ctx.t("send_chat_message", { name: quoted(name) }),
        preview: input.text,
        href: input.conversationId ? hrefs.chat(input.conversationId) : null,
      };
    },
    async execute(ctx, input) {
      const result = await deliverChatMessage(ctx.db, ctx.userId, {
        id: crypto.randomUUID(),
        ...(input.conversationId ? { channelId: input.conversationId } : { to: input.to }),
        body: input.text,
      });
      if (!result.ok) throw new ToolError(result.error);
      return {
        output: { sent: true, conversationId: result.channel.id },
        summary: ctx.t("sent_chat_message"),
        href: hrefs.chat(result.channel.id),
      };
    },
    undoable: false,
    invalidates: ["chat"],
  }),
];
