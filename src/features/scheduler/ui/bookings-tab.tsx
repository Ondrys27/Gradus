"use client";

import { useState } from "react";
import { CalendarCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPhone } from "@/lib/phone";
import { formatDate, formatTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/features/account/workspace-queries";
import {
  useBookings,
  type BookingScope,
  type BookingStatusFilter,
  type BookingWhen,
} from "../queries";
import { BookingControls, BookingDetailDialog, BookingStatus } from "./booking-controls";

const STATUS_FILTERS: readonly BookingStatusFilter[] = ["all", "pending", "confirmed", "cancelled"];

/**
 * What guests booked: upcoming and past, by status; the space's owner may
 * switch between their own and everyone's in the company (read only).
 */
export function BookingsTab({
  typeNames,
  hostNames,
  canSeeTeam,
  country,
  initialBooking = null,
}: {
  typeNames: Map<string, string>;
  hostNames: Map<string, string>;
  canSeeTeam: boolean;
  country: string | null;
  /** `?booking=<id>`: open that booking (the link of the host's e-mail). */
  initialBooking?: string | null;
}) {
  const t = useTranslations("scheduler.bookings");
  const settings = useFormatSettings();
  const workspace = useWorkspace();
  const [open, setOpenState] = useState<string | null>(initialBooking);
  function setOpen(next: string | null) {
    setOpenState(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("booking", next);
    else url.searchParams.delete("booking");
    window.history.replaceState(window.history.state, "", url);
  }
  const [when, setWhen] = useState<BookingWhen>("upcoming");
  const [status, setStatus] = useState<BookingStatusFilter>("all");
  const [scope, setScope] = useState<BookingScope>("mine");
  const [page, setPage] = useState(0);
  const bookings = useBookings({ scope: canSeeTeam ? scope : "mine", when, status, page });

  const choose =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(0);
    };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label={t("whenLabel")}
          value={when}
          options={["upcoming", "past"] as const}
          text={(value) => t(`when.${value}`)}
          onChange={choose(setWhen)}
        />
        <Segmented
          label={t("statusLabel")}
          value={status}
          options={STATUS_FILTERS}
          text={(value) => t(`filter.${value}`)}
          onChange={choose(setStatus)}
        />
        {canSeeTeam && (
          <Segmented
            label={t("scopeLabel")}
            value={scope}
            options={["mine", "team"] as const}
            text={(value) => t(`scope.${value}`)}
            onChange={choose(setScope)}
          />
        )}
      </div>

      {bookings.isPending ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : bookings.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : bookings.data.rows.length === 0 ? (
        <EmptyState
          icon={<CalendarCheckIcon aria-hidden />}
          title={t(when === "upcoming" ? "emptyUpcoming" : "emptyPast")}
          description={t("emptyHint")}
        />
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-line/60 rounded-2xl border border-line bg-surface">
            {bookings.data.rows.map((booking) => {
              const start = new Date(booking.starts_at);
              const end = new Date(booking.ends_at);
              const typeName = booking.event_type_id ? typeNames.get(booking.event_type_id) : null;
              const host = booking.host_user_id ? hostNames.get(booking.host_user_id) : null;
              const row = { ...booking, typeName: typeName ?? null, questions: [] };
              return (
                <li
                  key={booking.id}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                  data-testid="booking-row"
                  data-booking={booking.id}
                >
                  <div className="flex w-full flex-col sm:w-44 sm:shrink-0">
                    <span className="text-sm font-semibold text-ink tabular-nums">
                      {formatDate(start, settings)}
                    </span>
                    <span className="text-xs text-ink-muted tabular-nums">
                      {formatTime(start, settings)} – {formatTime(end, settings)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(booking.id)}
                    className="flex min-w-0 flex-1 cursor-pointer flex-col rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="truncate text-sm font-medium text-ink">
                      {booking.guest_name}
                      {booking.guest_company && (
                        <span className="text-ink-muted"> · {booking.guest_company}</span>
                      )}
                    </span>
                    <span className="truncate text-xs text-ink-muted">
                      {[
                        booking.guest_email,
                        booking.guest_phone ? formatPhone(booking.guest_phone, country) : null,
                        typeName ?? t("deletedType"),
                        scope === "team" && host ? host : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                  <div className="flex flex-col items-start gap-2 sm:items-end">
                    <BookingStatus booking={row} />
                    <BookingControls booking={row} isHost={booking.host_user_id === workspace.userId} compact />
                  </div>
                </li>
              );
            })}
          </ul>
          {bookings.data.total > bookings.data.pageSize && (
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                {t("previous")}
              </Button>
              <span className="text-xs text-ink-muted">
                {t("page", {
                  page: page + 1,
                  pages: Math.ceil(bookings.data.total / bookings.data.pageSize),
                })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={(page + 1) * bookings.data.pageSize >= bookings.data.total}
                onClick={() => setPage(page + 1)}
              >
                {t("next")}
              </Button>
            </div>
          )}
        </>
      )}
      <BookingDetailDialog
        bookingId={open}
        userId={workspace.userId}
        country={country}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  text,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  text: (value: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex rounded-xl border border-line bg-surface p-1"
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "h-11 cursor-pointer rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 mouse:h-8",
            value === option ? "bg-violet text-white" : "text-ink-soft hover:text-ink",
          )}
        >
          {text(option)}
        </button>
      ))}
    </div>
  );
}
