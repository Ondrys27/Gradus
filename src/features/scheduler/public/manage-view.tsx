"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeZonePicker } from "@/features/settings/time-zone-picker";
import { formatSlotMoment } from "@/lib/format";
import { browserTimeZone } from "@/lib/region";
import { FormatSettingsContext } from "@/lib/use-format-settings";
import { guestFormatSettings } from "../booking/guest-format";
import { BOOKING_ZONE_COOKIE, bookingCookie, isBookingLocale, readCookie } from "../booking/page-locale";
import type { GuestDay, GuestSlot } from "../slots";
import { isValidTimeZone } from "../zoned";
import { SlotPicker } from "./slot-picker";

/**
 * The guest's page for one booking (/s/r/<token>, 24.4): what and when, then
 * move it to another free time (the same slots as booking) or cancel it with
 * a reason. The token in the address is the only proof; after the meeting
 * the page only shows what it was.
 */

export type ManagedBooking = {
  typeName: string;
  durationMin: number;
  startsAt: string;
  status: "pending" | "confirmed" | "cancelled" | "declined";
  hostName: string;
  videoLink: string | null;
  guestZone: string;
  /** Still live and before its end. */
  canManage: boolean;
};

type Mode = "view" | "reschedule" | "cancel" | "rescheduled" | "cancelled";

export function ManageView({
  token,
  booking,
  startWithCancel,
}: {
  token: string;
  booking: ManagedBooking;
  startWithCancel: boolean;
}) {
  const t = useTranslations("booking.manage");
  const tBooking = useTranslations("booking");
  const locale = useLocale();
  const router = useRouter();
  const [zone, setZone] = useState(booking.guestZone);
  const [mode, setMode] = useState<Mode>(startWithCancel && booking.canManage ? "cancel" : "view");
  const [picked, setPicked] = useState<GuestSlot | null>(null);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const remembered = readCookie(document.cookie, BOOKING_ZONE_COOKIE);
    const next = remembered && isValidTimeZone(remembered) ? remembered : browserTimeZone();
    if (next !== zone) setZone(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const settings = useMemo(
    () => guestFormatSettings(isBookingLocale(locale) ? locale : "en", zone),
    [locale, zone],
  );

  const slots = useQuery({
    queryKey: ["booking-manage-slots", token, zone],
    enabled: mode === "reschedule",
    staleTime: 30_000,
    queryFn: async (): Promise<{ days: GuestDay[] }> => {
      const params = new URLSearchParams({ token, tz: zone });
      const response = await fetch(`/api/scheduler/public/slots?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`slots ${response.status}`);
      return response.json();
    },
  });

  async function send(body: Record<string, unknown>, done: Mode) {
    setSending(true);
    setProblem(null);
    try {
      const response = await fetch("/api/scheduler/public/manage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, ...body }),
      });
      const result = (await response.json().catch(() => ({}))) as { problem?: string };
      if (response.ok) {
        setMode(done);
        router.refresh();
        return;
      }
      setProblem(result.problem === "slotTaken" ? "taken" : "failed");
      if (result.problem === "slotTaken") void slots.refetch();
    } catch {
      setProblem("failed");
    } finally {
      setSending(false);
    }
  }

  const when = formatSlotMoment(new Date(booking.startsAt), settings, locale);
  const summary = tBooking("form.summary", {
    type: booking.typeName,
    duration: booking.durationMin,
    when,
    zone,
    host: booking.hostName,
  });

  return (
    <FormatSettingsContext.Provider value={settings}>
      <section className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-4 md:p-6" data-testid="booking-manage" data-status={booking.status}>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-ink">{t("title")}</h1>
          <p className="text-ink-soft" data-testid="booking-manage-summary">
            {summary}
          </p>
          <p className="text-sm text-ink-muted">{t(`status.${booking.status}`)}</p>
        </div>

        {mode === "rescheduled" && <p className="text-sm text-green" data-testid="booking-rescheduled">{t("rescheduled")}</p>}
        {mode === "cancelled" && <p className="text-sm text-ink" data-testid="booking-cancelled">{t("cancelled")}</p>}
        {problem && <FormAlert>{problem === "taken" ? tBooking("notice.taken") : t("failed")}</FormAlert>}

        {booking.videoLink && booking.canManage && mode === "view" && (
          <a href={booking.videoLink} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" })}>
            {tBooking("result.video")}
          </a>
        )}

        {!booking.canManage && mode === "view" && <p className="text-sm text-ink-muted">{t("over")}</p>}

        {booking.canManage && (mode === "view" || mode === "rescheduled") && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={() => setMode("reschedule")} data-testid="booking-manage-reschedule">
              {t("reschedule")}
            </Button>
            <Button variant="outline" onClick={() => setMode("cancel")} data-testid="booking-manage-cancel">
              {t("cancel")}
            </Button>
          </div>
        )}

        {mode === "reschedule" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <h2 className="text-lg font-semibold text-ink">{t("pickNew")}</h2>
              <div className="flex w-full flex-col gap-1 sm:w-72">
                <label htmlFor="manage-zone" className="micro-label">
                  {tBooking("calendar.zone")}
                </label>
                <TimeZonePicker
                  id="manage-zone"
                  value={zone}
                  onChange={(next) => {
                    setZone(next);
                    document.cookie = bookingCookie(BOOKING_ZONE_COOKIE, next);
                  }}
                />
              </div>
            </div>
            {slots.isPending ? (
              <Skeleton className="h-72 rounded-2xl" />
            ) : slots.isError ? (
              <FormAlert>{tBooking("errors.slots")}</FormAlert>
            ) : (
              <SlotPicker days={slots.data.days} selected={picked?.start ?? null} onPick={setPicked} disabled={sending} />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => setMode("view")} disabled={sending}>
                {t("keep")}
              </Button>
              <Button
                disabled={!picked || sending}
                onClick={() => picked && void send({ action: "reschedule", start: picked.start }, "rescheduled")}
                data-testid="booking-manage-confirm-move"
              >
                {picked ? t("moveTo", { when: formatSlotMoment(new Date(picked.start), settings, locale) }) : t("reschedule")}
              </Button>
            </div>
          </div>
        )}

        {mode === "cancel" && (
          <div className="flex flex-col gap-4">
            <FormField id="manage-reason" label={t("reason")}>
              <Textarea id="manage-reason" rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
            </FormField>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => setMode("view")} disabled={sending}>
                {t("keep")}
              </Button>
              <Button
                variant="destructive"
                disabled={sending}
                onClick={() => void send({ action: "cancel", reason }, "cancelled")}
                data-testid="booking-manage-confirm-cancel"
              >
                {t("confirmCancel")}
              </Button>
            </div>
          </div>
        )}
      </section>
    </FormatSettingsContext.Provider>
  );
}
