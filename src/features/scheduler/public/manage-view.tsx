"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { HeartHandshakeIcon, VideoIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { formatNumber, formatSlotMoment, formatSpokenDate, formatTime, formatUtcOffset } from "@/lib/format";
import { browserTimeZone } from "@/lib/region";
import { FormatSettingsContext } from "@/lib/use-format-settings";
import { guestFormatSettings } from "../booking/guest-format";
import { JOIN_SOON_MINUTES, joinPhase, nextPhaseAt } from "../booking/meeting-link";
import { BOOKING_ZONE_COOKIE, bookingCookie, isBookingLocale, readCookie } from "../booking/page-locale";
import type { GuestDay, GuestSlot } from "../slots";
import { isValidTimeZone } from "../zoned";
import { SlotPicker } from "./slot-picker";
import { ZoneLine } from "./zone-line";

/**
 * The guest's page for one booking (/s/r/<token>, 24.4, drawn in 24.5): what
 * and when with the date large and the state as a pill, then move it to
 * another free time (the same slots as booking) or cancel it with a reason.
 * The token in the address is the only proof; after the meeting the page
 * only shows what it was, and thanks for a meeting that took place.
 *
 * A confirmed video meeting (27.5): the call's link of now and "Join the
 * meeting", one click to the call; 15 minutes before the start it lights up.
 * Without a link yet the page says the host sends it before the meeting.
 */

export type ManagedBooking = {
  typeName: string;
  durationMin: number;
  startsAt: string;
  endsAt: string;
  status: "pending" | "confirmed" | "cancelled" | "declined";
  hostName: string;
  /** A confirmed video meeting: the call's link of now (null: the host sends it). */
  video: { url: string | null } | null;
  guestZone: string;
  /** Still live and before its end. */
  canManage: boolean;
};

type Mode = "view" | "reschedule" | "cancel" | "rescheduled" | "cancelled";

const STATUS_TONE = { pending: "gold", confirmed: "teal", cancelled: "neutral", declined: "pink" } as const;

export function ManageView({
  token,
  booking,
  startWithCancel,
  renderedAt,
}: {
  token: string;
  booking: ManagedBooking;
  startWithCancel: boolean;
  /** When the server drew the page (the clock starts there). */
  renderedAt: number;
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
  const now = useNowAtPhases(booking.startsAt, booking.endsAt, renderedAt);
  const phase = joinPhase(booking.startsAt, booking.endsAt, now);

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

  const start = new Date(booking.startsAt);
  const end = new Date(booking.endsAt);
  const over = booking.status === "cancelled" || booking.status === "declined";
  // A confirmed meeting that has ended (also while the page stayed open).
  const held = booking.status === "confirmed" && phase === "over";
  const canManage = booking.canManage && !held;

  return (
    <FormatSettingsContext.Provider value={settings}>
      <section
        className="flex flex-col gap-6 rounded-3xl border border-line bg-surface p-6 md:p-8"
        data-testid="booking-manage"
        data-status={booking.status}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink md:text-3xl">{t("title")}</h1>
            <StatusPill tone={STATUS_TONE[booking.status]} dot>
              {t(`status.${booking.status}`)}
            </StatusPill>
          </div>
          <div className="flex flex-col gap-1 rounded-2xl border border-line bg-canvas/50 p-5" data-testid="booking-manage-summary">
            <p className="micro-label">
              {t("meetingLine", {
                type: booking.typeName,
                duration: formatNumber(booking.durationMin, {}, settings),
                host: booking.hostName,
              })}
            </p>
            <p
              className={
                over
                  ? "font-display text-2xl leading-tight font-bold tracking-tight text-ink-muted line-through first-letter:uppercase md:text-3xl"
                  : "font-display text-2xl leading-tight font-bold tracking-tight text-ink first-letter:uppercase md:text-3xl"
              }
            >
              {formatSpokenDate(start, settings, locale)}
            </p>
            <p className={over ? "text-xl font-semibold text-ink-muted tabular-nums" : "text-xl font-semibold text-violet tabular-nums"}>
              {formatTime(start, settings)}–{formatTime(end, settings)}
            </p>
            <p className="text-xs text-ink-muted">
              {zone} · {formatUtcOffset(zone, start)}
            </p>
          </div>
        </div>

        {mode === "rescheduled" && (
          <p className="text-sm text-green" data-testid="booking-rescheduled">
            {t("rescheduled")}
          </p>
        )}
        {mode === "cancelled" && (
          <p className="text-sm text-ink" data-testid="booking-cancelled">
            {t("cancelled")}
          </p>
        )}
        {problem && <FormAlert>{problem === "taken" ? tBooking("notice.taken") : t("failed")}</FormAlert>}

        {held && (
          <div
            className="flex items-start gap-3 rounded-2xl border border-teal/40 bg-teal/10 p-5"
            data-testid="booking-thanks"
          >
            <HeartHandshakeIcon aria-hidden className="mt-0.5 size-6 shrink-0 text-teal" />
            <div className="flex flex-col gap-1">
              <p className="font-display text-lg font-bold text-ink">{t("thanks.title")}</p>
              <p className="text-sm text-ink-soft">{t("thanks.text", { host: booking.hostName })}</p>
            </div>
          </div>
        )}
        {!canManage && !held && mode === "view" && <p className="text-sm text-ink-muted">{t("over")}</p>}

        {/* Joining needs no right to change it: a read-only host still meets. */}
        {booking.video && !held && (mode === "view" || mode === "rescheduled") && (
          <JoinCard url={booking.video.url} soon={phase === "soon"} host={booking.hostName} />
        )}

        {canManage && (mode === "view" || mode === "rescheduled") && (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Button variant="outline" onClick={() => setMode("reschedule")} data-testid="booking-manage-reschedule">
              {t("reschedule")}
            </Button>
            <Button variant="ghost" className="text-ink-soft" onClick={() => setMode("cancel")} data-testid="booking-manage-cancel">
              {t("cancel")}
            </Button>
          </div>
        )}

        {mode === "reschedule" && (
          <div className="flex flex-col gap-5 border-t border-line/70 pt-5">
            <h2 className="font-display text-xl font-bold tracking-tight text-ink">{t("pickNew")}</h2>
            {slots.isPending ? (
              <Skeleton className="h-72 rounded-2xl" />
            ) : slots.isError ? (
              <FormAlert>{tBooking("errors.slots")}</FormAlert>
            ) : (
              <SlotPicker days={slots.data.days} selected={picked?.start ?? null} onPick={setPicked} disabled={sending} />
            )}
            <ZoneLine
              id="manage-zone"
              zone={zone}
              onChange={(next) => {
                setZone(next);
                document.cookie = bookingCookie(BOOKING_ZONE_COOKIE, next);
              }}
            />
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
          <div className="flex flex-col gap-4 border-t border-line/70 pt-5">
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

/**
 * The clock of the page, ticking only when the meeting's phase changes (15
 * minutes before the start, the end). It starts at the server's moment, so
 * the server's and the browser's first render agree.
 */
function useNowAtPhases(startsAt: string, endsAt: string, renderedAt: number): number {
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    let timer: number | undefined;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const next = nextPhaseAt(startsAt, endsAt, current);
      // setTimeout holds at most ~24.8 days; check again then.
      if (next !== null) timer = window.setTimeout(tick, Math.min(next - current + 250, 2 ** 31 - 1));
    };
    tick();
    // A phone that slept wakes up with the right phase.
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [startsAt, endsAt]);
  return now;
}

/** "Join the meeting": the link of now, one click to the call; lit up from 15 minutes before. */
function JoinCard({ url, soon, host }: { url: string | null; soon: boolean; host: string }) {
  const t = useTranslations("booking.manage.join");
  if (!url) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-line bg-canvas/50 p-4" data-testid="booking-join-later">
        <VideoIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-muted" />
        <p className="text-sm text-ink-soft">{t("later", { host })}</p>
      </div>
    );
  }
  return (
    <div
      className={
        soon
          ? "flex flex-col gap-3 rounded-2xl border border-teal/60 bg-teal/10 p-5 shadow-[0_0_36px_-10px_var(--color-teal)]"
          : "flex flex-col gap-3 rounded-2xl border border-line bg-canvas/50 p-5"
      }
      data-testid="booking-join-card"
      data-phase={soon ? "soon" : "later"}
    >
      {soon && <p className="micro-label text-teal">{t("now")}</p>}
      <a
        href={url}
        rel="noopener noreferrer"
        className={buttonVariants({
          size: soon ? "lg" : "default",
          variant: soon ? "default" : "outline",
          className: "w-full sm:w-fit",
        })}
        data-testid="booking-join"
      >
        <VideoIcon aria-hidden data-icon="inline-start" />
        {t("button")}
      </a>
      <p className="text-xs break-all text-ink-muted">
        {soon ? url : t("hint", { minutes: JOIN_SOON_MINUTES, url })}
      </p>
    </div>
  );
}
