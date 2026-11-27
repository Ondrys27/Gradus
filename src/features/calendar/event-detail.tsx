"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClockIcon, HandshakeIcon, PencilIcon, Trash2Icon, UserIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { MeetingNotesButton } from "@/features/meeting-notes/meeting-notes-dialog";
import { MentionedInNotes } from "@/features/notes/mentioned-in-notes";
import { contactLabel } from "@/features/pipeline/board-logic";
import { formatCalendarDate, formatDate, formatTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { toEventItem } from "./calendar-logic";
import { DemoBadge } from "@/features/tutorial/demo-badge";
import { useDeleteEvent } from "./queries";
import { BookingOfEvent } from "@/features/scheduler/ui/booking-of-event";
import { EventSyncNote } from "./sync/event-sync-note";
import { useActiveMembers } from "@/features/account/active-members";
import { useSession } from "@/features/account/queries";
import { useDeleteSharedEvent, useEventPeople, useRespondMeetingInvite } from "./sharing/queries";
import { Avatar } from "@/components/ui/avatar";
import type { CalendarEvent } from "./types";

type Props = {
  event: CalendarEvent | null;
  onClose: () => void;
  onEdit: (event: CalendarEvent) => void;
  /** Without the right to edit the calendar: no edit or delete. */
  readOnly?: boolean;
};

export function EventDetail({ event, onClose, onEdit, readOnly = false }: Props) {
  const t = useTranslations("calendar");
  const settings = useFormatSettings();
  const { user } = useSession();
  const members = useActiveMembers();
  const removeOwn = useDeleteEvent();
  const removeShared = useDeleteSharedEvent();
  const respond = useRespondMeetingInvite();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);

  // Keep the last event on screen while the dialog closes.
  const [shown, setShown] = useState<CalendarEvent | null>(event);
  if (event && event !== shown) setShown(event);
  const current = event ?? shown;

  if (!current) return null;
  const item = toEventItem(current, settings.timeZone);
  const shared = current.shared ?? null;
  // A change through a write share goes through the database's own function.
  const remove = shared?.canEdit ? removeShared : removeOwn;
  const nameOf = (id: string | null | undefined) =>
    (id && members.data?.find((member) => member.userId === id)?.name) || null;
  const owner = shared?.personId ?? current.calendar_owner_id ?? null;
  const ownerName = owner && owner !== user.id ? nameOf(owner) : null;
  // "Made by X" when someone wrote it into this calendar.
  const madeBy =
    shared?.createdByName ??
    (current.actor_id && owner && current.actor_id !== owner ? nameOf(current.actor_id) : null);
  // A deal's delivery date is changed in the deal only.
  const fromDeal = current.source === "deal_deadline";
  // A booked meeting moves and cancels through its booking, which tells the guest.
  const fromBooking = current.source === "booking";
  const editable = (shared ? shared.canEdit : !readOnly) && !fromDeal && !fromBooking;
  const invite = shared?.level === "invite" ? shared.inviteStatus : null;

  let when: string;
  if (item.allDay) {
    when =
      item.lastDay > item.firstDay
        ? `${formatCalendarDate(item.firstDay, settings)} – ${formatCalendarDate(item.lastDay, settings)}`
        : formatCalendarDate(item.firstDay, settings);
    when = `${when} · ${t("detail.allDay")}`;
  } else {
    const start = new Date(item.startMs);
    const end = new Date(item.endMs);
    const sameDay = formatDate(start, settings) === formatDate(end, settings);
    when = sameDay
      ? `${formatDate(start, settings)} · ${formatTime(start, settings)} – ${formatTime(end, settings)}`
      : `${formatDate(start, settings)} ${formatTime(start, settings)} – ${formatDate(end, settings)} ${formatTime(end, settings)}`;
  }

  async function confirmDelete() {
    setFailed(false);
    try {
      await remove.mutateAsync(current!.id);
      setConfirming(false);
      onClose();
    } catch {
      setFailed(true);
    }
  }

  return (
    <>
      <ResponsiveDialog
        open={event !== null && !confirming}
        onOpenChange={(open) => !open && onClose()}
        title={t("detail.title")}
        closeLabel={t("detail.close")}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={item.tone} dot>
              {t(`kind.${item.kind}`)}
            </StatusPill>
            {current.source === "contact_move" && (
              <StatusPill tone="neutral">{t("detail.fromMove")}</StatusPill>
            )}
            {fromDeal && <StatusPill tone="neutral">{t("detail.fromDeal")}</StatusPill>}
            {fromBooking && <StatusPill tone="neutral">{t("detail.fromBooking")}</StatusPill>}
            {current.private && (
              <StatusPill tone="neutral">{t("sharing.detail.private")}</StatusPill>
            )}
            <DemoBadge show={current.is_demo} className="h-6 px-2.5 text-xs" />
          </div>
          {(ownerName || madeBy) && (
            <p className="text-sm text-ink-soft" data-testid="event-owner-line">
              {ownerName && t("sharing.detail.calendarOf", { name: ownerName })}
              {ownerName && madeBy && " · "}
              {madeBy && t("sharing.detail.madeBy", { name: madeBy })}
            </p>
          )}
          <h3 className="text-xl font-semibold break-words text-ink">{current.title}</h3>
          <p className="flex items-start gap-2 text-sm text-ink-soft">
            <CalendarClockIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{when}</span>
          </p>
          {shared?.location && <p className="text-sm text-ink-soft">{shared.location}</p>}
          {current.description && (
            <p className="text-sm break-words whitespace-pre-line text-ink-soft">
              {current.description}
            </p>
          )}
          {(current.contact || current.deal) && (
            <ul className="flex flex-col gap-1">
              {current.contact && (
                <li>
                  <Link
                    href={`/app/kontakty/${current.contact.id}`}
                    className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm text-violet outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <UserIcon aria-hidden className="size-4 shrink-0" />
                    <span className="truncate">{contactLabel(current.contact)}</span>
                  </Link>
                </li>
              )}
              {current.deal && (
                <li>
                  <Link
                    href={`/app/pipeline?deal=${current.deal.id}`}
                    className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm text-violet outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <HandshakeIcon aria-hidden className="size-4 shrink-0" />
                    <span className="truncate">{current.deal.title}</span>
                  </Link>
                </li>
              )}
            </ul>
          )}
          {fromDeal && <p className="text-sm text-ink-muted">{t("detail.fromDealHint")}</p>}
          {fromBooking && <BookingOfEvent eventId={current.id} />}
          <EventPeople eventId={current.id} />
          {invite && (
            <div className="flex flex-wrap items-center gap-2" data-testid="event-invite">
              <span className="text-sm text-ink-soft">{t(`sharing.detail.invite.${invite}`)}</span>
              {invite !== "accepted" && (
                <Button
                  type="button"
                  size="sm"
                  disabled={respond.isPending}
                  onClick={() => respond.mutate({ eventId: current.id, accept: true })}
                >
                  {t("sharing.detail.accept")}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={respond.isPending}
                onClick={() =>
                  respond.mutate({ eventId: current.id, accept: false }, { onSuccess: onClose })
                }
              >
                {t("sharing.detail.decline")}
              </Button>
            </div>
          )}
          {!shared && <EventSyncNote eventId={current.id} />}
          {!shared && <MentionedInNotes kind="event" id={current.id} onOpenNote={onClose} />}
          {current.kind === "meeting" && !readOnly && !shared && (
            <MeetingNotesButton target={{ kind: "event", id: current.id }} className="self-start" />
          )}
          {editable && (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="destructive"
                data-tutorial="calendar-event-delete"
                onClick={() => setConfirming(true)}
              >
                <Trash2Icon aria-hidden data-icon="inline-start" />
                {t("detail.delete")}
              </Button>
              <Button
                type="button"
                data-tutorial="calendar-event-edit"
                onClick={() => onEdit(current)}
              >
                <PencilIcon aria-hidden data-icon="inline-start" />
                {t("detail.edit")}
              </Button>
            </div>
          )}
        </div>
      </ResponsiveDialog>
      <ConfirmDialog
        open={event !== null && confirming}
        onOpenChange={(open) => {
          if (!open) setConfirming(false);
        }}
        title={t("delete.title")}
        description={
          current.source === "contact_move"
            ? t("delete.descriptionMove", { title: current.title })
            : t("delete.description", { title: current.title })
        }
        confirmLabel={t("delete.confirm")}
        cancelLabel={t("delete.cancel")}
        closeLabel={t("detail.close")}
        pending={remove.isPending}
        error={failed ? t("delete.failed") : null}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}

/** The people invited to a meeting with their answers (30.3); nothing without any. */
function EventPeople({ eventId }: { eventId: string }) {
  const t = useTranslations("calendar.sharing.detail");
  const people = useEventPeople(eventId);
  const list = people.data ?? [];
  if (!list.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-ink">{t("people")}</p>
      <ul className="flex flex-col gap-1">
        {list.map((person) => (
          <li key={person.userId} className="flex items-center gap-2 text-sm text-ink-soft">
            <Avatar
              src={person.avatarUrl}
              name={person.name}
              presenceOf={person.userId}
              className="size-6"
            />
            <span className="min-w-0 flex-1 truncate">{person.name}</span>
            <span className="text-xs text-ink-muted">
              {t(
                `status.${person.status === "accepted" || person.status === "declined" ? person.status : "invited"}`,
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
