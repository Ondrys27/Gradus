"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CalendarClockIcon,
  CheckIcon,
  LinkIcon,
  MailIcon,
  PhoneIcon,
  UserIcon,
  UserXIcon,
  VideoIcon,
  XIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField, fieldA11y } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import type { Tone } from "@/components/ui/tone";
import { useCan, useWorkspace } from "@/features/account/workspace-queries";
import { formatSlotMoment, formatTime } from "@/lib/format";
import { formatPhone, telHref } from "@/lib/phone";
import { useFormatSettings } from "@/lib/use-format-settings";
import { answerLines } from "../booking/answers";
import { MEETING_LINK_MAX, meetingLinkOf, meetingLinkProblem } from "../booking/meeting-link";
import {
  bookingLabel,
  canApprove,
  canCancel,
  canDecline,
  canMarkNoShow,
  canReschedule,
  type BookingLabel,
} from "../booking/state";
import {
  BookingActionError,
  useApproveBooking,
  useBooking,
  useCancelBooking,
  useDeclineBooking,
  useRescheduleBooking,
  useRescheduleSlots,
  useSetBookingLink,
  useSetNoShow,
  type BookingWithType,
} from "../booking-queries";
import { SlotPicker } from "../public/slot-picker";
import type { GuestSlot } from "../slots";

/**
 * What the host does with a booking (24.4), the same everywhere: on the
 * dashboard's "Waiting for you", in the scheduler's Bookings and in the
 * calendar's meeting. Only the host acts on their own bookings; the space's
 * owner looking at someone else's sees them read-only.
 */

export const LABEL_TONE: Record<BookingLabel, Tone> = {
  held: "neutral",
  pending: "gold",
  confirmed: "green",
  done: "neutral",
  noShow: "pink",
  cancelled: "pink",
  declined: "pink",
  rescheduled: "neutral",
};

export function BookingStatus({ booking }: { booking: BookingWithType }) {
  const t = useTranslations("scheduler.bookings.label");
  const label = bookingLabel(booking, Date.now());
  return (
    <StatusPill tone={LABEL_TONE[label]} dot data-testid="booking-status" data-label={label}>
      {t(label)}
    </StatusPill>
  );
}

function useProblemText() {
  const t = useTranslations("scheduler.bookings.problems");
  return (error: unknown) =>
    error instanceof BookingActionError ? t(error.problem) : error ? t("unknown") : null;
}

/** The buttons a booking offers its host now. */
export function BookingControls({
  booking,
  isHost,
  compact = false,
}: {
  booking: BookingWithType;
  isHost: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("scheduler.bookings.actions");
  const problemText = useProblemText();
  const workspace = useWorkspace();
  // In the active space the rights say so; a booking of another space the server checks.
  const canEdit = useCan("scheduler", "own") || booking.space_id !== workspace.id;
  const approve = useApproveBooking();
  const noShow = useSetNoShow();
  const [dialog, setDialog] = useState<"decline" | "cancel" | "reschedule" | null>(null);
  const now = Date.now();
  if (!isHost || !canEdit) return null;

  const size = compact ? "sm" : "default";
  const error = approve.error ?? noShow.error;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {canApprove(booking, now) && (
          <Button
            size={size}
            disabled={approve.isPending}
            onClick={() => approve.mutate(booking.id)}
            data-testid="booking-approve"
          >
            <CheckIcon aria-hidden data-icon="inline-start" />
            {t("approve")}
          </Button>
        )}
        {canDecline(booking, now) && (
          <Button
            size={size}
            variant="outline"
            onClick={() => setDialog("decline")}
            data-testid="booking-decline"
          >
            <XIcon aria-hidden data-icon="inline-start" />
            {t("decline")}
          </Button>
        )}
        {canReschedule(booking, now) && (
          <Button
            size={size}
            variant="outline"
            onClick={() => setDialog("reschedule")}
            data-testid="booking-reschedule"
          >
            <CalendarClockIcon aria-hidden data-icon="inline-start" />
            {t("reschedule")}
          </Button>
        )}
        {canCancel(booking, now) && booking.status === "confirmed" && (
          <Button
            size={size}
            variant="ghost"
            onClick={() => setDialog("cancel")}
            data-testid="booking-cancel"
          >
            {t("cancel")}
          </Button>
        )}
        {canMarkNoShow(booking, now) && (
          <Button
            size={size}
            variant="ghost"
            disabled={noShow.isPending}
            onClick={() => noShow.mutate({ bookingId: booking.id, noShow: !booking.no_show_at })}
            data-testid="booking-no-show"
          >
            <UserXIcon aria-hidden data-icon="inline-start" />
            {booking.no_show_at ? t("cameAfterAll") : t("noShow")}
          </Button>
        )}
      </div>
      {error && <FormAlert>{problemText(error)}</FormAlert>}
      <DeclineDialog
        booking={booking}
        open={dialog === "decline"}
        onClose={() => setDialog(null)}
      />
      <CancelDialog booking={booking} open={dialog === "cancel"} onClose={() => setDialog(null)} />
      <RescheduleDialog
        booking={booking}
        open={dialog === "reschedule"}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}

function DeclineDialog({
  booking,
  open,
  onClose,
}: {
  booking: BookingWithType;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("scheduler.bookings.decline");
  const problemText = useProblemText();
  const decline = useDeclineBooking();
  const [reason, setReason] = useState("");
  const [alternative, setAlternative] = useState<string | null>(null);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t("title")}
      closeLabel={t("close")}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">{t("text", { guest: booking.guest_name ?? "" })}</p>
        <FormField id="decline-reason" label={t("reason")}>
          <Textarea
            id="decline-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </FormField>
        <FormField id="decline-alternative" label={t("alternative")} hint={t("alternativeHint")}>
          <DateTimePicker
            id="decline-alternative"
            value={alternative}
            onValueChange={setAlternative}
            timeLabel={t("alternativeTime")}
          />
        </FormField>
        {decline.error && <FormAlert>{problemText(decline.error)}</FormAlert>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={decline.isPending}>
            {t("keep")}
          </Button>
          <Button
            variant="destructive"
            disabled={decline.isPending}
            data-testid="booking-decline-confirm"
            onClick={() =>
              decline.mutate(
                { bookingId: booking.id, reason: reason.trim() || undefined, alternative },
                { onSuccess: onClose },
              )
            }
          >
            {t("confirm")}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}

function CancelDialog({
  booking,
  open,
  onClose,
}: {
  booking: BookingWithType;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("scheduler.bookings.cancel");
  const problemText = useProblemText();
  const cancel = useCancelBooking();
  const [reason, setReason] = useState("");
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t("title")}
      closeLabel={t("close")}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">{t("text", { guest: booking.guest_name ?? "" })}</p>
        <FormField id="cancel-reason" label={t("reason")}>
          <Textarea
            id="cancel-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </FormField>
        {cancel.error && <FormAlert>{problemText(cancel.error)}</FormAlert>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={cancel.isPending}>
            {t("keep")}
          </Button>
          <Button
            variant="destructive"
            disabled={cancel.isPending}
            data-testid="booking-cancel-confirm"
            onClick={() =>
              cancel.mutate(
                { bookingId: booking.id, reason: reason.trim() || undefined },
                { onSuccess: onClose },
              )
            }
          >
            {t("confirm")}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}

function RescheduleDialog({
  booking,
  open,
  onClose,
}: {
  booking: BookingWithType;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("scheduler.bookings.reschedule");
  const locale = useLocale();
  const settings = useFormatSettings();
  const problemText = useProblemText();
  const slots = useRescheduleSlots(open ? booking.id : null, settings.timeZone);
  const move = useRescheduleBooking();
  const [picked, setPicked] = useState<GuestSlot | null>(null);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,760px)]"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">{t("text", { guest: booking.guest_name ?? "" })}</p>
        {slots.isPending ? (
          <Skeleton className="h-72 rounded-2xl" />
        ) : slots.isError ? (
          <FormAlert>{t("loadFailed")}</FormAlert>
        ) : (
          <SlotPicker
            days={slots.data.days}
            timeZone={slots.data.timeZone}
            selected={picked?.start ?? null}
            onPick={setPicked}
            disabled={move.isPending}
          />
        )}
        {move.error && <FormAlert>{problemText(move.error)}</FormAlert>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={move.isPending}>
            {t("keep")}
          </Button>
          <Button
            disabled={!picked || move.isPending}
            data-testid="booking-reschedule-confirm"
            onClick={() =>
              picked &&
              move.mutate(
                { bookingId: booking.id, start: picked.start },
                {
                  onSuccess: () => {
                    setPicked(null);
                    onClose();
                  },
                },
              )
            }
          >
            {picked
              ? t("confirm", { when: formatSlotMoment(new Date(picked.start), settings, locale) })
              : t("pick")}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}

/** Who booked and what they answered. */
export function BookingSummary({
  booking,
  country,
}: {
  booking: BookingWithType;
  country: string | null;
}) {
  const t = useTranslations("scheduler.bookings");
  const locale = useLocale();
  const settings = useFormatSettings();
  const answers =
    booking.answers && typeof booking.answers === "object" && !Array.isArray(booking.answers)
      ? (booking.answers as Record<string, unknown>)
      : {};
  const lines = answerLines(booking.questions, answers, { yes: t("yes"), no: t("no") });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <BookingStatus booking={booking} />
        <span className="text-sm text-ink-soft">
          {formatSlotMoment(new Date(booking.starts_at), settings, locale)} –{" "}
          {formatTime(new Date(booking.ends_at), settings)}
        </span>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        <li className="flex items-center gap-2 text-ink">
          <UserIcon aria-hidden className="size-4 text-ink-muted" />
          {booking.contact_id ? (
            <Link
              href={`/app/kontakty/${booking.contact_id}`}
              className="text-violet hover:underline"
            >
              {booking.guest_name}
            </Link>
          ) : (
            booking.guest_name
          )}
          {booking.guest_company && (
            <span className="text-ink-muted">· {booking.guest_company}</span>
          )}
        </li>
        {booking.guest_email && (
          <li className="flex items-center gap-2 text-ink-soft">
            <MailIcon aria-hidden className="size-4 text-ink-muted" />
            <a href={`mailto:${booking.guest_email}`} className="hover:underline">
              {booking.guest_email}
            </a>
          </li>
        )}
        {booking.guest_phone && (
          <li className="flex items-center gap-2 text-ink-soft">
            <PhoneIcon aria-hidden className="size-4 text-ink-muted" />
            <a href={telHref(booking.guest_phone, country)} className="hover:underline">
              {formatPhone(booking.guest_phone, country)}
            </a>
          </li>
        )}
      </ul>
      {lines.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-xl border border-line bg-surface-hover/40 px-3 py-2 text-sm text-ink-soft">
          {lines.map((line) => (
            <li key={line} className="break-words whitespace-pre-line">
              {line}
            </li>
          ))}
        </ul>
      )}
      {booking.cancel_reason && (
        <p className="text-sm text-ink-muted">{t("reason", { reason: booking.cancel_reason })}</p>
      )}
    </div>
  );
}

/**
 * The call's link of a video meeting (27.5): which link the guest's page
 * shows now and where it comes from; the host gives this one meeting a link
 * of its own or goes back to the type's. The guest sees it at once on the
 * page of their booking, by e-mail only while the meeting is more than an
 * hour away.
 */
export function BookingMeetingLink({
  booking,
  isHost,
}: {
  booking: BookingWithType;
  isHost: boolean;
}) {
  const t = useTranslations("scheduler.bookings.link");
  const problemText = useProblemText();
  const workspace = useWorkspace();
  const canEdit = useCan("scheduler", "own") || booking.space_id !== workspace.id;
  const save = useSetBookingLink();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(booking.meeting_link ?? "");
  const [saved, setSaved] = useState<"emailed" | "page" | null>(null);
  const link = meetingLinkOf({
    locationKind: booking.locationKind,
    videoSource: booking.videoSource,
    own: booking.meeting_link,
    room: booking.video_room,
    meet: booking.google_meet_link,
    profileLink: booking.profileLink,
  });
  if (!link) return null;
  const live =
    (booking.status === "pending" || booking.status === "confirmed") &&
    Date.parse(booking.ends_at) > Date.now();
  const editable = isHost && canEdit && live;
  const formatError = meetingLinkProblem(value) ? t("format") : undefined;

  function submit(next: string | null) {
    setSaved(null);
    save.mutate(
      { bookingId: booking.id, link: next },
      {
        onSuccess: (emailed) => {
          setSaved(emailed ? "emailed" : "page");
          setEditing(false);
          if (next === null) setValue("");
        },
      },
    );
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-xl border border-line p-3"
      data-testid="booking-link"
      data-source={link.source}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <VideoIcon aria-hidden className="size-4 text-ink-muted" />
          {t("title")}
        </p>
        <span className="text-xs text-ink-muted">{t(`source.${link.source}`)}</span>
      </div>
      {link.url ? (
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm break-all text-violet hover:underline"
          data-testid="booking-link-url"
        >
          {link.url}
        </a>
      ) : (
        <p className="text-sm text-ink-soft">{t("none")}</p>
      )}
      {saved && (
        <p className="text-xs text-green" aria-live="polite" data-testid="booking-link-saved">
          {t(saved === "emailed" ? "savedEmailed" : "savedPage")}
        </p>
      )}
      {editable && !editing && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setValue(booking.meeting_link ?? "");
              setSaved(null);
              setEditing(true);
            }}
            data-testid="booking-link-edit"
          >
            <LinkIcon aria-hidden data-icon="inline-start" />
            {t(link.source === "own" ? "change" : "set")}
          </Button>
          {booking.meeting_link && (
            <Button
              size="sm"
              variant="ghost"
              disabled={save.isPending}
              onClick={() => submit(null)}
              data-testid="booking-link-reset"
            >
              {t("reset")}
            </Button>
          )}
        </div>
      )}
      {editable && editing && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!formatError && value.trim()) submit(value.trim());
          }}
        >
          <FormField
            id={`booking-link-${booking.id}`}
            label={t("label")}
            error={formatError}
            hint={t("hint")}
          >
            <Input
              {...fieldA11y(`booking-link-${booking.id}`, formatError, true)}
              type="url"
              inputMode="url"
              placeholder="https://"
              maxLength={MEETING_LINK_MAX}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoFocus
            />
          </FormField>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={save.isPending}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={save.isPending || Boolean(formatError) || !value.trim()}
              data-testid="booking-link-save"
            >
              {t("save")}
            </Button>
          </div>
        </form>
      )}
      {save.error && <FormAlert>{problemText(save.error)}</FormAlert>}
    </div>
  );
}

/** One booking in a dialog (`?booking=<id>` in the scheduler, a link from the e-mail). */
export function BookingDetailDialog({
  bookingId,
  userId,
  country,
  onClose,
}: {
  bookingId: string | null;
  userId: string;
  country: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("scheduler.bookings");
  const booking = useBooking(bookingId);
  return (
    <ResponsiveDialog
      open={bookingId !== null}
      onOpenChange={(open) => !open && onClose()}
      title={booking.data?.typeName ?? t("detailTitle")}
      closeLabel={t("close")}
    >
      <div className="flex flex-col gap-4" data-testid="booking-detail">
        {booking.isPending ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : !booking.data ? (
          <FormAlert>{t("notFound")}</FormAlert>
        ) : (
          <>
            <BookingSummary booking={booking.data} country={country} />
            <BookingMeetingLink
              booking={booking.data}
              isHost={booking.data.host_user_id === userId}
            />
            <BookingControls booking={booking.data} isHost={booking.data.host_user_id === userId} />
          </>
        )}
      </div>
    </ResponsiveDialog>
  );
}
