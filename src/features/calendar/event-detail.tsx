"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClockIcon, HandshakeIcon, PencilIcon, Trash2Icon, UserIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { contactLabel } from "@/features/pipeline/board-logic";
import { formatCalendarDate, formatDate, formatTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { toEventItem } from "./calendar-logic";
import { useDeleteEvent } from "./queries";
import type { CalendarEvent } from "./types";

type Props = {
  event: CalendarEvent | null;
  onClose: () => void;
  onEdit: (event: CalendarEvent) => void;
};

export function EventDetail({ event, onClose, onEdit }: Props) {
  const t = useTranslations("calendar");
  const settings = useFormatSettings();
  const remove = useDeleteEvent();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);

  // Keep the last event on screen while the dialog closes.
  const [shown, setShown] = useState<CalendarEvent | null>(event);
  if (event && event !== shown) setShown(event);
  const current = event ?? shown;

  if (!current) return null;
  const item = toEventItem(current, settings.timeZone);

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
          </div>
          <h3 className="text-xl font-semibold break-words text-ink">{current.title}</h3>
          <p className="flex items-start gap-2 text-sm text-ink-soft">
            <CalendarClockIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{when}</span>
          </p>
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
                    href={`/contacts/${current.contact.id}`}
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
                    href={`/pipeline?deal=${current.deal.id}`}
                    className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm text-violet outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <HandshakeIcon aria-hidden className="size-4 shrink-0" />
                    <span className="truncate">{current.deal.title}</span>
                  </Link>
                </li>
              )}
            </ul>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
              <Trash2Icon aria-hidden data-icon="inline-start" />
              {t("detail.delete")}
            </Button>
            <Button type="button" onClick={() => onEdit(current)}>
              <PencilIcon aria-hidden data-icon="inline-start" />
              {t("detail.edit")}
            </Button>
          </div>
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
