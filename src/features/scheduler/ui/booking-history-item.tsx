"use client";

import Link from "next/link";
import { CalendarClockIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { formatSlotMoment } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { bookingAppPath } from "../booking/paths";
import type { BookingWithType } from "../booking-queries";
import { BookingStatus } from "./booking-controls";

/** A booking in a contact's history (24.4): computed from the booking, a cancelled one stays. */
export function BookingHistoryItem({ booking }: { booking: BookingWithType }) {
  const t = useTranslations("scheduler.bookings");
  const settings = useFormatSettings();
  const locale = useLocale();
  return (
    <li className="flex gap-3 border-b border-line/60 py-3 last:border-b-0" data-testid="contact-booking">
      <span className="grid size-9 shrink-0 place-items-center rounded-full border border-line bg-surface-hover text-ink-soft">
        <CalendarClockIcon aria-hidden className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <Link href={bookingAppPath(booking.id)} className="font-medium text-ink hover:underline">
            {t("history", { type: booking.typeName ?? t("deletedType") })}
          </Link>
          <BookingStatus booking={booking} />
          <time dateTime={booking.starts_at} className="text-xs text-ink-muted">
            {formatSlotMoment(new Date(booking.starts_at), settings, locale)}
          </time>
        </p>
        {booking.cancel_reason && (
          <p className="text-sm whitespace-pre-line text-ink-soft">
            {t("reason", { reason: booking.cancel_reason })}
          </p>
        )}
      </div>
    </li>
  );
}
