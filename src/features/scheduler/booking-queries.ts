"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { useWorkspace } from "@/features/account/workspace-queries";
import { createClient } from "@/lib/supabase/client";
import {
  approveBookingAction,
  cancelBookingAction,
  declineBookingAction,
  dismissSurveyAction,
  rescheduleBookingAction,
  setNoShowAction,
  type BookingActionResult,
} from "./booking-actions";
import type { BookingProblem } from "./booking/state";
import { SURVEY_DAYS } from "./booking/state";
import type { GuestDay } from "./slots";
import { parseQuestions } from "./event-type-form";
import { BOOKING_COLUMNS, type BookingRow, type Question } from "./types";

/**
 * Bookings in the app (24.4), read with the user's own client (RLS: the host
 * their own, the space's owner all of the space) and changed only through
 * the host's server actions. The dashboard's "Waiting for you", the
 * scheduler's Bookings tab, the calendar's meeting detail and the contact's
 * history share these.
 */

export type BookingWithType = BookingRow & { typeName: string | null; questions: Question[] };

export const bookingKeys = {
  all: (userId: string) => ["scheduler", userId, "bookings"] as const,
  one: (userId: string, id: string) => ["scheduler", userId, "bookings", "one", id] as const,
  byEvent: (userId: string, eventId: string) => ["scheduler", userId, "bookings", "event", eventId] as const,
  waiting: (userId: string) => ["scheduler", userId, "bookings", "waiting"] as const,
  surveys: (userId: string, space: string) => ["scheduler", userId, "bookings", "surveys", space] as const,
  contact: (userId: string, contact: string) => ["scheduler", userId, "bookings", "contact", contact] as const,
  slots: (userId: string, id: string, zone: string) => ["scheduler", userId, "bookings", "slots", id, zone] as const,
};

const SELECT = `${BOOKING_COLUMNS}, event_type:event_types(name, questions)`;

type Joined = BookingRow & { event_type: { name: string; questions: unknown } | null };

function withType(row: Joined): BookingWithType {
  const { event_type, ...booking } = row;
  return {
    ...booking,
    typeName: event_type?.name ?? null,
    questions: event_type ? parseQuestions(event_type.questions) : [],
  };
}

export class BookingActionError extends Error {
  constructor(readonly problem: BookingProblem) {
    super(problem);
  }
}

export function useBooking(id: string | null) {
  const { user } = useSession();
  return useQuery({
    queryKey: bookingKeys.one(user.id, id ?? "none"),
    enabled: Boolean(id),
    queryFn: async (): Promise<BookingWithType | null> => {
      const { data, error } = await createClient()
        .from("bookings")
        .select(SELECT)
        .eq("id", id!)
        .neq("status", "held")
        .maybeSingle();
      if (error) throw error;
      return data ? withType(data as unknown as Joined) : null;
    },
  });
}

/** The booking behind a meeting in the calendar (source 'booking'). */
export function useBookingOfEvent(eventId: string | null) {
  const { user } = useSession();
  return useQuery({
    queryKey: bookingKeys.byEvent(user.id, eventId ?? "none"),
    enabled: Boolean(eventId),
    queryFn: async (): Promise<BookingWithType | null> => {
      const { data, error } = await createClient()
        .from("bookings")
        .select(SELECT)
        .eq("calendar_event_id", eventId!)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? withType(data as unknown as Joined) : null;
    },
  });
}

const WAITING_LIMIT = 10;

/** Pending bookings the person hosts, in any space, soonest first. */
export function useWaitingBookings() {
  const { user } = useSession();
  return useQuery({
    queryKey: bookingKeys.waiting(user.id),
    refetchInterval: 60_000,
    queryFn: async (): Promise<BookingWithType[]> => {
      const { data, error } = await createClient()
        .from("bookings")
        .select(SELECT)
        .eq("host_user_id", user.id)
        .eq("status", "pending")
        .gt("ends_at", new Date().toISOString())
        .order("starts_at")
        .limit(WAITING_LIMIT);
      if (error) throw error;
      return (data as unknown as Joined[]).map(withType);
    },
  });
}

/**
 * Booked meetings of the active space that are over and wait for the
 * meeting survey: confirmed, not a no-show, with a deal, not skipped, from
 * the last two weeks, without a survey yet.
 */
export function useBookingSurveys(enabled: boolean) {
  const { user } = useSession();
  const workspace = useWorkspace();
  return useQuery({
    queryKey: bookingKeys.surveys(user.id, workspace.id),
    enabled,
    queryFn: async (): Promise<Array<BookingWithType & { dealTitle: string | null; stageId: string | null }>> => {
      const supabase = createClient();
      const now = Date.now();
      const { data, error } = await supabase
        .from("bookings")
        .select(`${SELECT}, deal:deals(title, stage_id)`)
        .eq("space_id", workspace.id)
        .eq("host_user_id", user.id)
        .eq("status", "confirmed")
        .is("no_show_at", null)
        .is("survey_dismissed_at", null)
        .not("deal_id", "is", null)
        .lt("ends_at", new Date(now).toISOString())
        .gt("ends_at", new Date(now - SURVEY_DAYS * 86_400_000).toISOString())
        .order("ends_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      const rows = data as unknown as Array<Joined & { deal: { title: string; stage_id: string } | null }>;
      if (!rows.length) return [];
      const answered = await supabase
        .from("meeting_surveys")
        .select("booking_id")
        .eq("user_id", workspace.id)
        .in(
          "booking_id",
          rows.map((row) => row.id),
        );
      if (answered.error) throw answered.error;
      const done = new Set((answered.data ?? []).map((row) => row.booking_id));
      return rows
        .filter((row) => !done.has(row.id))
        .map((row) => ({
          ...withType(row),
          dealTitle: row.deal?.title ?? null,
          stageId: row.deal?.stage_id ?? null,
        }));
    },
  });
}

/** A contact's bookings for their history; a cancelled one stays there. */
export function useContactBookings(contactId: string) {
  const { user } = useSession();
  return useQuery({
    queryKey: bookingKeys.contact(user.id, contactId),
    queryFn: async (): Promise<BookingWithType[]> => {
      const { data, error } = await createClient()
        .from("bookings")
        .select(SELECT)
        .eq("contact_id", contactId)
        .neq("status", "held")
        .order("starts_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data as unknown as Joined[]).map(withType);
    },
  });
}

/** The free times the host may move a booking to. */
export function useRescheduleSlots(bookingId: string | null, zone: string) {
  const { user } = useSession();
  return useQuery({
    queryKey: bookingKeys.slots(user.id, bookingId ?? "none", zone),
    enabled: Boolean(bookingId),
    staleTime: 30_000,
    queryFn: async (): Promise<{ days: GuestDay[] }> => {
      const params = new URLSearchParams({ booking: bookingId!, tz: zone });
      const response = await fetch(`/api/scheduler/booking-slots?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`slots ${response.status}`);
      return response.json();
    },
  });
}

function useBookingMutation<I>(action: (input: I) => Promise<BookingActionResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: I) => {
      const result = await action(input);
      if (!result.ok) throw new BookingActionError(result.problem);
    },
    // A decision touches the calendar, the contact, the deal and Grady: everything reads again.
    onSettled: () => queryClient.invalidateQueries(),
  });
}

export const useApproveBooking = () => useBookingMutation(approveBookingAction);
export const useDeclineBooking = () => useBookingMutation(declineBookingAction);
export const useCancelBooking = () => useBookingMutation(cancelBookingAction);
export const useRescheduleBooking = () => useBookingMutation(rescheduleBookingAction);
export const useSetNoShow = () => useBookingMutation(setNoShowAction);
export const useDismissSurvey = () => useBookingMutation(dismissSurveyAction);
