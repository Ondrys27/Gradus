"use client";

import { useState } from "react";
import { CalendarClockIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useCan } from "@/features/account/workspace-queries";
import { useContactTables } from "@/features/contacts/queries";
import { useFields } from "@/features/contacts/table-queries";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { formatSlotMoment } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import type { BookingDialogSource } from "../analytics";
import type { BookForContactResult } from "../server/app-booking";
import { MeetingBookingForm } from "./meeting-booking";

/**
 * "Schedule a meeting" on a contact and on a deal (30.4): the same form as
 * Cold Calling's move into "Meeting scheduled" — the contact moves there
 * with it unless it is there already or a client.
 */
export function ScheduleMeetingButton({
  contactId,
  dealId = null,
  from,
  className,
}: {
  contactId: string | null;
  dealId?: string | null;
  from: Exclude<BookingDialogSource, "cold_calling">;
  className?: string;
}) {
  const t = useTranslations("scheduler.meeting");
  const locale = useLocale();
  const settings = useFormatSettings();
  const canCall = useCan("cold_calling", "call");
  const canEdit = useCan("contacts", "update");
  const [open, setOpen] = useState(false);
  const [booked, setBooked] = useState<BookForContactResult | null>(null);
  if (!canCall && !canEdit) return null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={className}
        disabled={!contactId}
        title={contactId ? undefined : t("needsContact")}
        data-testid="schedule-meeting"
        onClick={() => {
          setBooked(null);
          setOpen(true);
        }}
      >
        <CalendarClockIcon aria-hidden data-icon="inline-start" />
        {t("open")}
      </Button>
      {booked && (
        <FormAlert tone="success" className={className}>
          {t(booked.emailed ? "bookedEmailed" : "booked", {
            when: formatSlotMoment(new Date(booked.startsAt), settings, locale),
          })}
        </FormAlert>
      )}
      {contactId && (
        <ScheduleMeetingDialog
          open={open}
          onOpenChange={setOpen}
          contactId={contactId}
          dealId={dealId}
          from={from}
          onBooked={(result) => {
            setBooked(result);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

export function ScheduleMeetingDialog({
  open,
  onOpenChange,
  contactId,
  dealId,
  from,
  onBooked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  dealId: string | null;
  from: BookingDialogSource;
  onBooked: (result: BookForContactResult) => void;
}) {
  const t = useTranslations("scheduler.meeting");
  const generation = useFreshOnOpen(open);
  const tables = useContactTables();
  const fields = useFields();
  const meeting = tables.data?.find((table) => table.system_key === "meeting_scheduled");
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,820px)]"
    >
      {open && (
        <MeetingBookingForm
          key={generation}
          contactId={contactId}
          dealId={dealId}
          from={from}
          fields={
            meeting ? (fields.data ?? []).filter((field) => field.table_id === meeting.id) : []
          }
          onCancel={() => onOpenChange(false)}
          onBooked={onBooked}
        />
      )}
    </ResponsiveDialog>
  );
}
