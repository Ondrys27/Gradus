"use client";

import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession, useUserSettings } from "@/features/account/queries";
import { useBookingOfEvent } from "../booking-queries";
import { BookingControls, BookingSummary } from "./booking-controls";

/**
 * A booked meeting in the calendar's detail (24.4): who booked it and what
 * they answered, and for its host the same Move / Cancel as in the
 * scheduler (the calendar itself never changes a booked meeting).
 */
export function BookingOfEvent({ eventId }: { eventId: string }) {
  const t = useTranslations("calendar.detail");
  const { user } = useSession();
  const settings = useUserSettings();
  const booking = useBookingOfEvent(eventId);
  if (booking.isPending) return <Skeleton className="h-24 rounded-xl" />;
  if (!booking.data) return <p className="text-sm text-ink-muted">{t("fromBookingHint")}</p>;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line p-3" data-testid="event-booking">
      <BookingSummary booking={booking.data} country={settings.country_code ?? null} />
      <BookingControls booking={booking.data} isHost={booking.data.host_user_id === user.id} />
    </div>
  );
}
