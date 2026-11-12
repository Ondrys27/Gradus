import { z } from "zod";
import { GRADY_FREQUENCIES } from "@/features/grady/proactive";
import { setGameMode } from "@/features/game/ops";
import {
  approveBookingAction,
  cancelBookingAction,
  declineBookingAction,
} from "@/features/scheduler/booking-actions";
import {
  addAvailabilityOverrides,
  setEventTypeActive,
  updateEventType,
} from "@/features/scheduler/ops";
import { updateSettings } from "@/features/settings/ops";
import { CURRENCIES, DATE_FORMATS, NUMBER_FORMATS, TIME_FORMATS, WEEK_STARTS } from "@/lib/format";
import { THEMES } from "@/lib/themes";
import type { UserSettingsPatch } from "@/lib/user-settings";
import type { Json } from "@/types/database";
import type { UndoRecord } from "../records";
import { defineTool, ToolError, type ToolContext } from "../types";
import {
  hrefs,
  isoDate,
  mustFind,
  ops,
  previousOf,
  quoted,
  READ_LIMIT,
  updated,
  uuid,
} from "./shared";

/** The scheduler (the user's own booking page in this space) and the user's own settings. */

async function ownProfile(ctx: ToolContext) {
  return mustFind(
    ctx.db
      .from("scheduler_profiles")
      .select("id, handle, time_zone")
      .eq("user_id", ctx.userId)
      .eq("space_id", ctx.workspaceId)
      .maybeSingle(),
  );
}

async function readEventType(ctx: ToolContext, id: string) {
  return mustFind(
    ctx.db
      .from("event_types")
      .select("id, name, user_id, active, duration_min, description")
      .eq("space_id", ctx.workspaceId)
      .eq("id", id)
      .maybeSingle(),
  );
}

async function readBooking(ctx: ToolContext, id: string) {
  return mustFind(
    ctx.db
      .from("bookings")
      .select("id, status, starts_at, ends_at, guest_name, event_type_id, host_user_id")
      .eq("space_id", ctx.workspaceId)
      .eq("id", id)
      .maybeSingle(),
  );
}

function bookingResult(result: { ok: true } | { ok: false; problem: string }) {
  if (!result.ok) throw new ToolError(result.problem);
}

function whenText(ctx: ToolContext, iso: string) {
  return new Intl.DateTimeFormat(ctx.locale === "cs" ? "cs-CZ" : "en-GB", {
    timeZone: ctx.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

const DONE_BOOKING = {
  confirm: "confirmed_booking",
  decline: "declined_booking",
  cancel: "cancelled_booking",
} as const;

export const schedulerTools = [
  defineTool({
    name: "list_bookings",
    section: "scheduler",
    action: "view",
    kind: "read",
    risk: "instant",
    description:
      "The user's meeting types (ids, names, active) and their upcoming bookings (waiting for approval, confirmed).",
    input: z.object({}),
    describe: (_input, t) => t("list_bookings"),
    async execute(ctx) {
      const [types, bookings] = await Promise.all([
        ctx.db
          .from("event_types")
          .select("id, name, duration_min, active, requires_approval")
          .eq("user_id", ctx.userId)
          .eq("space_id", ctx.workspaceId)
          .order("position")
          .limit(READ_LIMIT),
        ctx.db
          .from("bookings")
          .select("id, status, starts_at, ends_at, guest_name, event_type_id")
          .eq("space_id", ctx.workspaceId)
          .eq("host_user_id", ctx.userId)
          .in("status", ["pending", "confirmed"])
          .gte("ends_at", new Date().toISOString())
          .order("starts_at")
          .limit(READ_LIMIT),
      ]);
      if (types.error) throw types.error;
      if (bookings.error) throw bookings.error;
      return { output: { eventTypes: types.data, bookings: bookings.data } };
    },
    undoable: false,
    invalidates: [],
  }),

  defineTool({
    name: "update_event_type",
    section: "scheduler",
    action: "own",
    kind: "write",
    risk: "instant",
    description:
      "Rename a meeting type of the user's booking page, change its length (5–480 minutes) or description, or switch it on or off.",
    input: z.object({
      eventTypeId: uuid,
      name: z.string().trim().min(1).max(80).optional(),
      durationMin: z.number().int().min(5).max(480).optional(),
      description: z.string().trim().max(2000).optional(),
      active: z.boolean().optional(),
    }),
    describe: (_input, t) => t("update_event_type", { name: "" }),
    async execute(ctx, input) {
      const type = await readEventType(ctx, input.eventTypeId);
      const patch = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.durationMin !== undefined ? { duration_min: input.durationMin } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
      };
      if (Object.keys(patch).length) {
        if (type.user_id !== ctx.userId) throw new ToolError("forbidden");
        await updateEventType(ops(ctx), { id: type.id, userId: ctx.userId, patch, tab: "basics" });
      }
      if (input.active !== undefined && input.active !== type.active) {
        await setEventTypeActive(ops(ctx), {
          id: type.id,
          active: input.active,
          byOwner: type.user_id !== ctx.userId,
        });
      }
      const changed = { ...patch, ...(input.active !== undefined ? { active: input.active } : {}) };
      return {
        output: { eventTypeId: type.id },
        // The owner may only switch a worker's type off (event_types_guard): no Undo to switch it on.
        records:
          type.user_id === ctx.userId
            ? [updated("event_types", type.id, previousOf(type, changed))]
            : [],
        summary: ctx.t("update_event_type", { name: quoted(input.name ?? type.name) }),
        href: hrefs.scheduler,
      };
    },
    undoable: true,
    invalidates: ["scheduler"],
  }),

  defineTool({
    name: "block_days",
    section: "scheduler",
    action: "own",
    kind: "write",
    risk: "instant",
    description:
      "Change the user's booking hours on given dates (YYYY-MM-DD): no times = the whole day blocked, or other hours (HH:MM–HH:MM) instead of the usual. Applies to all meeting types.",
    input: z.object({
      dates: z.array(isoDate).min(1).max(31),
      hours: z
        .array(
          z.object({
            start: z.string().regex(/^\d{2}:\d{2}$/),
            end: z.string().regex(/^\d{2}:\d{2}$/),
          }),
        )
        .max(6)
        .optional(),
    }),
    describe: (input, t) => t("block_days", { count: input.dates.length }),
    async execute(ctx, input) {
      const profile = await ownProfile(ctx);
      const { data: before, error } = await ctx.db
        .from("availability_overrides")
        .select("id")
        .eq("profile_id", profile.id)
        .in("date", input.dates)
        .limit(200);
      if (error) throw error;
      if (before.length)
        throw new ToolError(
          "datesHaveExceptions",
          "Some of these dates already have other hours; change them in the scheduler.",
        );
      await addAvailabilityOverrides(ops(ctx), {
        profileId: profile.id,
        dates: input.dates,
        intervals: input.hours?.length
          ? input.hours.map((hour) => ({ start_time: hour.start, end_time: hour.end }))
          : null,
      });
      return {
        output: { dates: input.dates },
        summary: ctx.t("block_days", { count: input.dates.length }),
        href: `${hrefs.scheduler}?tab=availability`,
      };
    },
    undoable: false,
    invalidates: ["scheduler"],
  }),

  ...(["confirm", "decline", "cancel"] as const).map((step) =>
    defineTool({
      name: `${step}_booking`,
      section: "scheduler",
      action: "own",
      kind: "write",
      risk: "confirm",
      description:
        step === "confirm"
          ? "Approve a booking that waits for the user's approval; the guest gets an e-mail. The user confirms it first."
          : step === "decline"
            ? "Decline a booking waiting for approval, with an optional reason for the guest (e-mailed). The user confirms it first."
            : "Cancel a confirmed booking, with an optional reason for the guest (e-mailed). The user confirms it first.",
      input: z.object({ bookingId: uuid, reason: z.string().trim().max(500).optional() }),
      describe: (_input, t) => t(`${step}_booking`, { name: "", when: "" }),
      async prepare(ctx, input) {
        const booking = await readBooking(ctx, input.bookingId);
        if (booking.host_user_id !== ctx.userId) throw new ToolError("forbidden");
        return {
          summary: ctx.t(`${step}_booking`, {
            name: quoted(booking.guest_name ?? ""),
            when: whenText(ctx, booking.starts_at),
          }),
          preview: input.reason ?? null,
          href: `${hrefs.scheduler}?tab=bookings`,
        };
      },
      async execute(ctx, input) {
        const booking = await readBooking(ctx, input.bookingId);
        if (step === "confirm") bookingResult(await approveBookingAction(booking.id));
        else if (step === "decline")
          bookingResult(
            await declineBookingAction({ bookingId: booking.id, reason: input.reason }),
          );
        else
          bookingResult(await cancelBookingAction({ bookingId: booking.id, reason: input.reason }));
        return {
          output: { bookingId: booking.id, done: step },
          summary: ctx.t(DONE_BOOKING[step], {
            name: quoted(booking.guest_name ?? ""),
            when: whenText(ctx, booking.starts_at),
          }),
          href: `${hrefs.scheduler}?tab=bookings`,
        };
      },
      undoable: false,
      invalidates: ["scheduler", "calendar", "contacts", "dashboard"],
    }),
  ),
];

const QUIET_HOUR = z.number().int().min(0).max(23).nullable();

export const settingsTools = [
  defineTool({
    name: "update_settings",
    section: "settings",
    action: null,
    kind: "write",
    risk: "instant",
    description:
      "Change the user's own settings: colour theme, date / time / number format, currency of display, time zone, first day of the week, how often Grady speaks up on his own, his quiet hours (whole hours, both null = off), and game or tool mode.",
    input: z.object({
      theme: z.enum(THEMES).optional(),
      dateFormat: z.enum(DATE_FORMATS).optional(),
      timeFormat: z.enum(TIME_FORMATS).optional(),
      numberFormat: z.enum(Object.keys(NUMBER_FORMATS) as [string, ...string[]]).optional(),
      currency: z.string().length(3).optional(),
      timezone: z.string().min(1).max(64).optional(),
      weekStart: z.union([z.literal(1), z.literal(0), z.literal(6)]).optional(),
      gradyProactive: z.boolean().optional(),
      gradyFrequency: z.enum(GRADY_FREQUENCIES).optional(),
      quietFrom: QUIET_HOUR.optional(),
      quietTo: QUIET_HOUR.optional(),
      gameMode: z.enum(["game", "tool"]).optional(),
    }),
    describe: (_input, t) => t("update_settings"),
    async execute(ctx, input) {
      const currency = input.currency?.toUpperCase();
      if (currency && !CURRENCIES.includes(currency))
        throw new ToolError("invalid", "Unknown currency.");
      if (input.timezone) {
        try {
          new Intl.DateTimeFormat("en", { timeZone: input.timezone });
        } catch {
          throw new ToolError("invalid", "Unknown time zone.");
        }
      }
      if (input.weekStart !== undefined && !WEEK_STARTS.includes(input.weekStart))
        throw new ToolError("invalid");
      const patch: UserSettingsPatch = {
        ...(input.theme ? { theme: input.theme } : {}),
        ...(input.dateFormat ? { date_format: input.dateFormat } : {}),
        ...(input.timeFormat ? { time_format: input.timeFormat } : {}),
        ...(input.numberFormat ? { number_format: input.numberFormat } : {}),
        ...(currency ? { currency } : {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
        ...(input.weekStart !== undefined ? { first_day_of_week: input.weekStart } : {}),
        ...(input.gradyProactive !== undefined ? { jarvis_proactive: input.gradyProactive } : {}),
        ...(input.gradyFrequency ? { jarvis_frequency: input.gradyFrequency } : {}),
        ...(input.quietFrom !== undefined ? { jarvis_quiet_from: input.quietFrom } : {}),
        ...(input.quietTo !== undefined ? { jarvis_quiet_to: input.quietTo } : {}),
      };
      const records: UndoRecord[] = [];
      if (Object.keys(patch).length) {
        const { data: current, error } = await ctx.db
          .from("user_settings")
          .select(
            "theme, date_format, time_format, number_format, currency, timezone, first_day_of_week, jarvis_proactive, jarvis_frequency, jarvis_quiet_from, jarvis_quiet_to",
          )
          .eq("user_id", ctx.userId)
          .single();
        if (error) throw error;
        await updateSettings(ops(ctx), { userId: ctx.userId, patch });
        records.push({
          table: "user_settings",
          match: { user_id: ctx.userId },
          op: "update",
          before: previousOf(current, patch as Record<string, unknown>) as Record<string, Json>,
        });
      }
      if (input.gameMode) {
        const { data: profile, error } = await ctx.db
          .from("profiles")
          .select("mode")
          .eq("id", ctx.userId)
          .single();
        if (error) throw error;
        if (profile.mode !== input.gameMode) {
          await setGameMode(ops(ctx), {
            userId: ctx.userId,
            mode: input.gameMode,
            where: "settings",
          });
          records.push(updated("profiles", ctx.userId, { mode: profile.mode }));
        }
      }
      if (!records.length) throw new ToolError("invalid", "Nothing to change.");
      return { output: { changed: Object.keys(input) }, records, href: hrefs.settings };
    },
    undoable: true,
    invalidates: ["account", "game"],
  }),
];
