"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeftIcon, ClockIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, formatSpokenDate, formatTime } from "@/lib/format";
import { browserTimeZone, countryFromTimeZone } from "@/lib/region";
import { FormatSettingsContext } from "@/lib/use-format-settings";
import { useReducedMotionSafe } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { checkAnswers, type AnswerError, type AnswerInput } from "../booking/answers";
import { guestFormatSettings } from "../booking/guest-format";
import {
  BOOKING_ZONE_COOKIE,
  bookingCookie,
  isBookingLocale,
  readCookie,
} from "../booking/page-locale";
import { HOLD_MINUTES, holdSecondsLeft } from "../booking/state";
import type { PublicType } from "../server/public-data";
import type { GuestDay, GuestSlot } from "../slots";
import { isValidTimeZone } from "../zoned";
import { BookingDone, type BookingResult } from "./booking-done";
import { GuestForm } from "./guest-form";
import { SlotPicker, type PickerView } from "./slot-picker";
import { ZoneLine } from "./zone-line";

/**
 * Booking one meeting type (24.4, drawn in 24.5): one panel that walks the
 * guest through day → time → details. On a wide screen the calendar and the
 * times stand side by side and the details take their place once a time is
 * held; on a phone the three steps follow each other with a way back and a
 * thin step line above. A five-minute hold on the clicked time with a
 * countdown, the type's questions, Book. Everything goes through
 * /api/scheduler/public/*; the hold's secret lives only in this component.
 */

type Hold = { id: string; token: string; expiresAt: string; start: number; end: number };
type Notice = "taken" | "expired" | "rateLimited" | "unavailable" | "unknown" | null;
type Step = "day" | "time" | "details";

const STEPS: Step[] = ["day", "time", "details"];

export function BookingFlow({
  handle,
  type,
  host,
  hostZone,
  initialZone,
  brandingHidden,
}: {
  handle: string;
  type: PublicType;
  host: { name: string; country: string | null };
  hostZone: string;
  initialZone: string | null;
  brandingHidden: boolean;
}) {
  const t = useTranslations("booking");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotionSafe() ?? false;
  const [zone, setZone] = useState(initialZone ?? hostZone);
  const [hold, setHold] = useState<Hold | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [values, setValues] = useState<AnswerInput>({});
  const [errors, setErrors] = useState<Record<string, AnswerError>>({});
  const [honeypot, setHoneypot] = useState("");
  const [holding, setHolding] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<BookingResult | null>(null);
  const [pickerView, setPickerView] = useState<PickerView>("days");
  const panelRef = useRef<HTMLDivElement>(null);

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

  const onViewChange = useCallback((view: PickerView) => setPickerView(view), []);

  function pickZone(next: string) {
    setZone(next);
    document.cookie = bookingCookie(BOOKING_ZONE_COOKIE, next);
  }

  function scrollToPanel() {
    requestAnimationFrame(() => {
      const top = panelRef.current?.getBoundingClientRect().top ?? 0;
      if (top < 0) panelRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });
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
        scrollToPanel();
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
      const body = (await response.json().catch(() => ({}))) as Partial<BookingResult> & {
        problem?: string;
        errors?: Record<string, AnswerError>;
      };
      if (response.ok && body.status && body.manageUrl && body.startsAt && body.endsAt) {
        setResult({
          status: body.status,
          manageUrl: body.manageUrl,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          videoLink: body.videoLink ?? null,
          icsUid: body.icsUid ?? `booking-${hold.id}`,
        });
        setHold(null);
        scrollToPanel();
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

  if (result) {
    return (
      <FormatSettingsContext.Provider value={settings}>
        <div ref={panelRef} className="scroll-mt-4">
          <BookingDone
            result={result}
            type={type}
            host={host}
            email={typeof values.email === "string" ? values.email : ""}
            zone={zone}
            settings={settings}
            brandingHidden={brandingHidden}
          />
        </div>
      </FormatSettingsContext.Provider>
    );
  }

  const step: Step = hold ? "details" : pickerView === "times" ? "time" : "day";
  const slide = {
    initial: { opacity: 0, x: reduceMotion ? 0 : 28 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: reduceMotion ? 0 : -28 },
    transition: { duration: reduceMotion ? 0.1 : 0.26, ease: [0.22, 1, 0.36, 1] as const },
  };

  return (
    <FormatSettingsContext.Provider value={settings}>
      <div ref={panelRef} className="flex scroll-mt-4 flex-col gap-4">
        <StepLine step={step} />
        <section className="overflow-hidden rounded-3xl border border-line bg-surface p-5 md:p-7">
          <AnimatePresence mode="wait" initial={false}>
            {hold ? (
              <motion.form
                key="details"
                {...slide}
                onSubmit={submit}
                noValidate
                className="relative flex flex-col gap-6"
              >
                <div className="flex flex-col gap-4">
                  <button
                    type="button"
                    onClick={() => setHold(null)}
                    disabled={sending}
                    className="flex min-h-11 w-fit cursor-pointer items-center gap-1 rounded-lg pr-2 text-sm font-medium text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 mouse:min-h-8"
                  >
                    <ChevronLeftIcon aria-hidden className="size-4" />
                    {t("form.back")}
                  </button>
                  <div className="flex flex-col gap-1" data-testid="booking-summary">
                    <p className="micro-label">{t("form.whenLabel")}</p>
                    <p className="font-display text-2xl leading-tight font-bold tracking-tight text-ink first-letter:uppercase md:text-3xl">
                      {formatSpokenDate(new Date(hold.start), settings, locale)}
                    </p>
                    <p className="text-lg font-semibold text-violet tabular-nums">
                      {formatTime(new Date(hold.start), settings)}–{formatTime(new Date(hold.end), settings)}
                      <span className="pl-2 text-xs font-normal text-ink-muted">{zone}</span>
                    </p>
                    <p className="text-sm text-ink-soft">
                      {t("form.meetingLine", {
                        type: type.name,
                        duration: formatNumber(type.duration_min, {}, settings),
                        host: host.name,
                      })}
                    </p>
                  </div>
                  <HoldMeter secondsLeft={secondsLeft} />
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
                  <p className="text-sm text-ink-muted text-pretty">{t("form.approvalNote", { host: host.name })}</p>
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button type="submit" size="lg" disabled={sending} data-testid="booking-submit">
                    {sending ? t("form.submitting") : t("form.submit")}
                  </Button>
                </div>
              </motion.form>
            ) : (
              <motion.div key="picker" {...slide} className="flex flex-col gap-5">
                <h2 className="font-display text-2xl font-bold tracking-tight text-ink">{t("calendar.title")}</h2>
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
                  <SlotPicker
                    days={slots.data.days}
                    selected={null}
                    onPick={pick}
                    onViewChange={onViewChange}
                    disabled={holding}
                  />
                )}
                <ZoneLine id="booking-zone" zone={zone} onChange={pickZone} />
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>
    </FormatSettingsContext.Provider>
  );
}

/** The three steps as a thin line, phones only; wide screens see the whole panel at once. */
function StepLine({ step }: { step: Step }) {
  const t = useTranslations("booking.calendar.steps");
  const current = STEPS.indexOf(step);
  return (
    <ol className="flex items-center gap-2 px-1 md:hidden" aria-hidden>
      {STEPS.map((item, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={item} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className={cn(
                "micro-label shrink-0 transition-colors",
                active ? "text-ink" : done ? "text-teal" : "text-ink-muted/70",
              )}
            >
              {t(item)}
            </span>
            <span
              className={cn(
                "h-px flex-1 transition-colors",
                done ? "bg-teal/70" : active ? "bg-line-strong" : "bg-line/60",
                index === STEPS.length - 1 && "hidden",
              )}
            />
          </li>
        );
      })}
    </ol>
  );
}

/** How long the time is still held: the sentence and a thin bar draining with it. */
function HoldMeter({ secondsLeft }: { secondsLeft: number }) {
  const t = useTranslations("booking.form");
  const total = HOLD_MINUTES * 60;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex items-center gap-1.5 text-xs text-ink-muted" data-testid="booking-countdown" aria-live="off">
        <ClockIcon aria-hidden className="size-3.5" />
        {t("held", { time: `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}` })}
      </p>
      <div aria-hidden className="h-0.5 w-full overflow-hidden rounded-full bg-line/60">
        <div
          className="h-full rounded-full bg-teal transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
          style={{ width: `${Math.max(0, Math.min(100, (secondsLeft / total) * 100))}%` }}
        />
      </div>
    </div>
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
