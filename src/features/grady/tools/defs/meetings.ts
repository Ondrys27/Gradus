import { z } from "zod";
import { contactName } from "@/features/contacts/types";
import {
  loadAppSlots,
  loadMeetingSetup,
  scheduleMeetingNow,
  type Actor,
} from "@/features/scheduler/server/app-booking";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { defineTool, ToolError, type ToolContext } from "../types";
import { hrefs, instant, mustFind, quoted, uuid } from "./shared";

/**
 * Booking a meeting for a contact (30.4) as Grady's and a connected app's
 * operation: the same path as the dialog of Cold Calling (whose meeting by
 * the owner's settings, the host's free times by their own scheduler, the
 * contact into "Meeting scheduled", the guest's confirmation). The caller is
 * the user (their client decides what they reach); only the scheduler's own
 * functions run with the admin client, after the same checks as the dialog.
 */

const SLOT_LIMIT = 30;

function actorOf(ctx: ToolContext): Actor {
  return { db: ctx.db, userId: ctx.userId, spaceId: ctx.workspaceId };
}

async function readContact(ctx: ToolContext, id: string) {
  return mustFind(
    ctx.db
      .from("contacts")
      .select("id, company_name, first_name, last_name, email")
      .eq("user_id", ctx.workspaceId)
      .eq("id", id)
      .maybeSingle(),
  );
}

function whenText(ctx: ToolContext, iso: string | number) {
  return new Intl.DateTimeFormat(ctx.locale === "cs" ? "cs-CZ" : "en-GB", {
    timeZone: ctx.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

/** The host and type to use: the given ones, else the defaults of the owner's settings. */
async function choose(
  ctx: ToolContext,
  input: { contactId: string; hostId?: string; typeId?: string },
) {
  const setup = await loadMeetingSetup(createAdminClient(), actorOf(ctx), input.contactId);
  if (!setup.ok) throw new ToolError(setup.problem);
  const host = setup.data.hosts.find(
    (item) => item.userId === (input.hostId ?? setup.data.defaultHost),
  );
  if (!host) {
    throw new ToolError(
      "noHost",
      setup.data.missing === "selfSetup"
        ? "The user has no scheduler yet: they set their working hours once in the meeting dialog or the Scheduler."
        : "Nobody can be booked for this meeting (the person has no scheduler, or the user may book only for themselves).",
    );
  }
  const type = host.types.find((item) => item.id === (input.typeId ?? host.defaultTypeId));
  if (!type) throw new ToolError("invalid", "Unknown meeting type of this host.");
  if (setup.data.settings.typeLocked && type.id !== host.defaultTypeId) {
    throw new ToolError("forbidden", "The owner fixed the meeting type for calls.");
  }
  return { setup: setup.data, host, type };
}

export const meetingTools = [
  defineTool({
    name: "meeting_times",
    section: "cold_calling",
    action: "call",
    alsoAllowedBy: { section: "contacts", action: "update" },
    kind: "read",
    risk: "instant",
    description:
      "Who a meeting with a contact can be booked for (hosts and their meeting types, by the owner's Cold Calling settings) and the host's next free times (ISO), by the host's own scheduler. Use before schedule_meeting.",
    input: z.object({
      contactId: uuid,
      hostId: uuid.optional(),
      typeId: uuid.optional(),
    }),
    describe: (_input, t) => t("meeting_times"),
    async execute(ctx, input) {
      await readContact(ctx, input.contactId);
      const { setup, host, type } = await choose(ctx, input);
      const slots = await loadAppSlots(createAdminClient(), actorOf(ctx), {
        hostId: host.userId,
        typeId: type.id,
        timeZone: ctx.timezone,
      });
      if (!slots.ok) throw new ToolError(slots.problem);
      const free = slots.data.days
        .flatMap((day) => day.slots)
        .slice(0, SLOT_LIMIT)
        .map((slot) => new Date(slot.start).toISOString());
      return {
        output: {
          hosts: setup.hosts.map((item) => ({
            hostId: item.userId,
            name: item.name,
            isUser: item.isSelf,
            types: item.types.map((option) => ({
              typeId: option.id,
              name: option.name,
              durationMin: option.durationMin,
            })),
          })),
          typeLocked: setup.settings.typeLocked,
          host: host.userId,
          type: type.id,
          freeTimes: free,
          contactHasEmail: Boolean(setup.contact.email),
        },
      };
    },
    undoable: false,
    invalidates: [],
  }),

  defineTool({
    name: "schedule_meeting",
    // It books someone's time and e-mails the guest.
    level: "delete",
    section: "cold_calling",
    action: "call",
    alsoAllowedBy: { section: "contacts", action: "update" },
    kind: "write",
    risk: "confirm",
    description:
      "Book a meeting with a contact at one of the host's free times (meeting_times), as the meeting dialog does: the meeting in the host's calendar, the contact into \"Meeting scheduled\", reminders, and with sendEmail the guest's confirmation with the invite and the link to move or cancel. force books a taken time anyway, only when the user says so. The user confirms it first.",
    input: z.object({
      contactId: uuid,
      start: instant,
      hostId: uuid.optional(),
      typeId: uuid.optional(),
      dealId: uuid.optional(),
      sendEmail: z.boolean().optional(),
      force: z.boolean().optional(),
    }),
    describe: (_input, t) => t("schedule_meeting", { name: "", when: "" }),
    async prepare(ctx, input) {
      const contact = await readContact(ctx, input.contactId);
      await choose(ctx, input);
      return {
        summary: ctx.t("schedule_meeting", {
          name: quoted(contactName(contact)),
          when: whenText(ctx, input.start),
        }),
        href: hrefs.contact(contact.id),
      };
    },
    async execute(ctx, input) {
      const contact = await readContact(ctx, input.contactId);
      const { host, type } = await choose(ctx, input);
      const start = Date.parse(input.start);
      const result = await scheduleMeetingNow(createAdminClient(), actorOf(ctx), {
        hostId: host.userId,
        typeId: type.id,
        start,
        force: input.force === true,
        contactId: contact.id,
        dealId: input.dealId ?? null,
        sendEmail: input.sendEmail ?? Boolean(contact.email),
        email: null,
        answers: {},
        from: "grady",
        locale: ctx.locale === "en" ? "en" : "cs",
        timeZone: ctx.timezone,
        origin: await siteOrigin(),
      });
      if (!result.ok) {
        if (result.problem === "busy") {
          throw new ToolError(
            "busy",
            "That time is already full in the host's calendar; offer one of meeting_times, or book it anyway only if the user says so (force).",
          );
        }
        if (result.problem === "invalid") {
          throw new ToolError(
            "answersInvalid",
            '"Meeting scheduled" has a required question: the user books this one in the meeting dialog.',
          );
        }
        throw new ToolError(result.problem);
      }
      return {
        output: {
          bookingId: result.data.bookingId,
          startsAt: result.data.startsAt,
          emailed: result.data.emailed,
          movedToMeetingScheduled: result.data.moved,
        },
        summary: ctx.t("scheduled_meeting", {
          name: quoted(contactName(contact)),
          when: whenText(ctx, result.data.startsAt),
        }),
        href: hrefs.contact(contact.id),
        awards: result.data.moved
          ? [{ reason: "contact_moved" as const }, { reason: "meeting_booked" as const }]
          : [],
      };
    },
    undoable: false,
    invalidates: ["contacts", "calendar", "cold-calling", "scheduler", "pipeline"],
  }),
];
