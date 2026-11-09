"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, ClockIcon, HourglassIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeZonePicker } from "@/features/settings/time-zone-picker";
import { formatSlotMoment } from "@/lib/format";
import { browserTimeZone, countryFromTimeZone } from "@/lib/region";
import { FormatSettingsContext } from "@/lib/use-format-settings";
import { checkAnswers, type AnswerError, type AnswerInput } from "../booking/answers";
import { guestFormatSettings } from "../booking/guest-format";
import {
  BOOKING_ZONE_COOKIE,
  bookingCookie,
  isBookingLocale,
  readCookie,
} from "../booking/page-locale";
import { holdSecondsLeft } from "../booking/state";
import type { PublicType } from "../server/public-data";
import type { GuestDay, GuestSlot } from "../slots";
import { isValidTimeZone } from "../zoned";
import { GuestForm } from "./guest-form";
import { SlotPicker } from "./slot-picker";

/**
 * Booking one meeting type (24.4): the month calendar and times in the
 * guest's zone (from the browser, or the one they picked), a five-minute hold
 * on the clicked time with a countdown, the type's questions, a summary and
 * Book. Everything goes through /api/scheduler/public/*; the hold's secret
 * lives only in this component.
 */

type Hold = { id: string; token: string; expiresAt: string; start: number; end: number };
type Result = {
  status: "confirmed" | "pending";
  manageUrl: string;
  startsAt: string;
  videoLink: string | null;
};
type Notice = "taken" | "expired" | "rateLimited" | "unavailable" | "unknown" | null;

export function BookingFlow({
  handle,
  type,
  host,
  hostZone,
  initialZone,
}: {
  handle: string;
  type: PublicType;
  host: { name: string; country: string | null };
  hostZone: string;
  initialZone: string | null;
}) {
  const t = useTranslations("booking");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [zone, setZone] = useState(initialZone ?? hostZone);
  const [hold, setHold] = useState<Hold | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [values, setValues] = useState<AnswerInput>({});
  const [errors, setErrors] = useState<Record<string, AnswerError>>({});
  const [honeypot, setHoneypot] = useState("");
  const [holding, setHolding] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // The browser's zone, unless the guest picked one before.
  useEffect(() => {
    const remembered = readCookie(document.cookie, BOOKING_ZONE_COOKIE);
    const next = remembered && isValidTimeZone(remembered) ? remembered : browserTimeZone();
    if (next !== zone) setZone(next);
    // Only once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const settings = useMemo(
    () => guestFormatSettings(isBookingLocale(locale) ? locale : "en", zone),
    [locale, zone],
  );
  const country = countryFromTimeZone(zone) ?? host.country;

  const slotsKey = ["booking-slots", handle, type.slug, zone] as const;
  const slots = useQuery({
    queryKey: slotsKey,
    enabled: !result,
    staleTime: 30_000,
    queryFn: async (): Promise<{ timeZone: string; days: GuestDay[] }> => {
      const params = new URLSearchParams({ handle, slug: type.slug, tz: zone });
      const response = await fetch(`/api/scheduler/public/slots?${params}`, { cache: "no-store" });
      if (response.status === 409) throw new Error("unavailable");
      if (!response.ok) throw new Error(`slots ${response.status}`);
      return response.json();
    },
  });

  const secondsLeft = useCountdown(hold?.expiresAt ?? null);
  useEffect(() => {
    if (hold && secondsLeft === 0) {
      setHold(null);
      setNotice("expired");
      void queryClient.invalidateQueries({ queryKey: ["booking-slots", handle, type.slug] });
    }
  }, [hold, secondsLeft, queryClient, handle, type.slug]);

  function pickZone(next: string) {
    setZone(next);
    document.cookie = bookingCookie(BOOKING_ZONE_COOKIE, next);
  }

  async function pick(slot: GuestSlot) {
    if (holding) return;
    setHolding(true);
    setNotice(null);
    try {
      const response = await fetch("/api/scheduler/public/hold", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle,
          slug: type.slug,
          start: slot.start,
          tz: zone,
          release: hold?.id ?? null,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        holdId?: string;
        holdToken?: string;
        expiresAt?: string;
        problem?: string;
      };
      if (response.ok && body.holdId && body.holdToken && body.expiresAt) {
        setHold({ id: body.holdId, token: body.holdToken, expiresAt: body.expiresAt, start: slot.start, end: slot.end });
        requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
        return;
      }
      setHold(null);
      setNotice(
        body.problem === "rateLimited" ? "rateLimited" : body.problem === "unavailable" ? "unavailable" : "taken",
      );
      await queryClient.invalidateQueries({ queryKey: ["booking-slots", handle, type.slug] });
    } catch {
      setNotice("unknown");
    } finally {
      setHolding(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!hold || sending) return;
    const checked = checkAnswers(type.questions, values, country);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setSending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/scheduler/public/book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          holdId: hold.id,
          holdToken: hold.token,
          values,
          locale,
          tz: zone,
          website: honeypot,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<Result> & {
        problem?: string;
        errors?: Record<string, AnswerError>;
      };
      if (response.ok && body.status && body.manageUrl && body.startsAt) {
        setResult({
          status: body.status,
          manageUrl: body.manageUrl,
          startsAt: body.startsAt,
          videoLink: body.videoLink ?? null,
        });
        setHold(null);
        return;
      }
      if (body.problem === "invalid" && body.errors) {
        setErrors(body.errors);
        return;
      }
      if (body.problem === "holdExpired" || body.problem === "slotTaken") {
        setHold(null);
        setNotice(body.problem === "slotTaken" ? "taken" : "expired");
        await queryClient.invalidateQueries({ queryKey: ["booking-slots", handle, type.slug] });
        return;
      }
      setNotice(
        body.problem === "rateLimited" ? "rateLimited" : body.problem === "unavailable" ? "unavailable" : "unknown",
      );
    } catch {
      setNotice("unknown");
    } finally {
      setSending(false);
    }
  }

  const summary = hold
    ? t("form.summary", {
        type: type.name,
        duration: type.duration_min,
        when: formatSlotMoment(new Date(hold.start), settings, locale),
        zone,
        host: host.name,
      })
    : null;

  if (result) {
    return (
      <FormatSettingsContext.Provider value={settings}>
        <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6" data-testid="booking-success" data-status={result.status}>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-ink">
            {result.status === "confirmed" ? (
              <CheckCircle2Icon aria-hidden className="size-6 text-green" />
            ) : (
              <HourglassIcon aria-hidden className="size-6 text-gold" />
            )}
            {t(result.status === "confirmed" ? "result.confirmedTitle" : "result.pendingTitle")}
          </h2>
          <p className="text-ink-soft">
            {t("form.summary", {
              type: type.name,
              duration: type.duration_min,
              when: formatSlotMoment(new Date(result.startsAt), settings, locale),
              zone,
              host: host.name,
            })}
          </p>
          <p className="text-sm text-ink-soft">
            {t(result.status === "confirmed" ? "result.confirmedText" : "result.pendingText", {
              email: typeof values.email === "string" ? values.email : "",
              host: host.name,
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            {result.videoLink && (
              <a href={result.videoLink} target="_blank" rel="noopener noreferrer" className={buttonVariants()}>
                {t("result.video")}
              </a>
            )}
            <a href={result.manageUrl} className={buttonVariants({ variant: "outline" })} data-testid="booking-manage-link">
              {t("result.manage")}
            </a>
          </div>
        </section>
      </FormatSettingsContext.Provider>
    );
  }

  return (
    <FormatSettingsContext.Provider value={settings}>
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 md:p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="text-lg font-semibold text-ink">{t("calendar.title")}</h2>
            <div className="flex w-full flex-col gap-1 sm:w-72">
              <label htmlFor="booking-zone" className="micro-label">
                {t("calendar.zone")}
              </label>
              <TimeZonePicker id="booking-zone" value={zone} onChange={pickZone} />
            </div>
          </div>
          {notice && <NoticeLine notice={notice} />}
          {slots.isPending ? (
            <Skeleton className="h-72 rounded-2xl" />
          ) : slots.isError ? (
            <FormAlert>
              {slots.error instanceof Error && slots.error.message === "unavailable"
                ? t("errors.unavailable")
                : t("errors.slots")}
            </FormAlert>
          ) : (
            <SlotPicker days={slots.data.days} selected={hold?.start ?? null} onPick={pick} disabled={holding} />
          )}
        </section>

        {hold && (
          <form
            ref={formRef}
            onSubmit={submit}
            noValidate
            className="relative flex flex-col gap-5 rounded-2xl border border-line bg-surface p-4 md:p-6"
          >
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold text-ink">{t("form.title")}</h2>
              <p className="text-sm text-ink-soft" data-testid="booking-summary">
                {summary}
              </p>
              <p className="flex items-center gap-1.5 text-xs text-ink-muted" data-testid="booking-countdown" aria-live="off">
                <ClockIcon aria-hidden className="size-3.5" />
                {t("form.held", {
                  time: `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`,
                })}
              </p>
            </div>
            <GuestForm
              questions={type.questions}
              values={values}
              errors={errors}
              country={country}
              honeypot={honeypot}
              onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
              onHoneypot={setHoneypot}
            />
            {type.requires_approval && (
              <p className="text-sm text-ink-muted">{t("form.approvalNote", { host: host.name })}</p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setHold(null)} disabled={sending}>
                {t("form.back")}
              </Button>
              <Button type="submit" disabled={sending} data-testid="booking-submit">
                {sending ? t("form.submitting") : t("form.submit")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </FormatSettingsContext.Provider>
  );
}

function NoticeLine({ notice }: { notice: Exclude<Notice, null> }) {
  const t = useTranslations("booking.notice");
  return (
    <FormAlert>
      <span data-testid={`booking-notice-${notice}`}>{t(notice)}</span>
    </FormAlert>
  );
}

/** Seconds left until `expiresAt`, ticking every second; 0 without one. */
function useCountdown(expiresAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  return expiresAt ? holdSecondsLeft(expiresAt, now) : 0;
}
