"use client";

import { useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { CalendarPlusIcon, CheckIcon, HourglassIcon, VideoIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { APP_NAME } from "@/lib/constants";
import { formatNumber, formatSpokenDate, formatTime, formatUtcOffset } from "@/lib/format";
import { useReducedMotionSafe } from "@/lib/use-media-query";
import type { FormatSettings } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PublicType } from "../server/public-data";
import { googleCalendarUrl, icsDataUrl, outlookCalendarUrl } from "./calendar-links";

export type BookingResult = {
  status: "confirmed" | "pending";
  manageUrl: string;
  startsAt: string;
  endsAt: string;
  videoLink: string | null;
  icsUid: string;
};

/**
 * The confirmation (24.5): a short celebration like the app's (two bursts of
 * confetti from the mark, none with reduced motion), the date and time large,
 * Add to calendar for Google, Apple (.ics) and Outlook, the call's link, and
 * for a meeting the host still confirms a plain word on what happens next.
 */
export function BookingDone({
  result,
  type,
  host,
  email,
  zone,
  settings,
  brandingHidden,
}: {
  result: BookingResult;
  type: Pick<PublicType, "name" | "duration_min" | "location_kind" | "location_text">;
  host: { name: string };
  email: string;
  zone: string;
  settings: FormatSettings;
  brandingHidden: boolean;
}) {
  const t = useTranslations("booking");
  const locale = useLocale();
  const reduceMotion = useReducedMotionSafe() ?? false;
  const markRef = useRef<HTMLDivElement>(null);
  const celebrated = useRef(false);
  const pending = result.status === "pending";

  useEffect(() => {
    if (celebrated.current || reduceMotion) return;
    celebrated.current = true;
    const timers: number[] = [];
    void import("canvas-confetti").then(({ default: confetti }) => {
      const fire = (token: string, angle: number) => {
        const rect = markRef.current?.getBoundingClientRect();
        const color = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
        void confetti({
          origin: rect
            ? { x: (rect.left + rect.width / 2) / window.innerWidth, y: (rect.top + rect.height / 2) / window.innerHeight }
            : { x: 0.5, y: 0.4 },
          angle,
          spread: 120,
          particleCount: 70,
          startVelocity: 42,
          gravity: 0.9,
          ticks: 200,
          scalar: 0.95,
          zIndex: 70,
          colors: color ? [color] : undefined,
          disableForReducedMotion: true,
        });
      };
      timers.push(window.setTimeout(() => fire(pending ? "--color-gold" : "--color-teal", 60), 250));
      timers.push(window.setTimeout(() => fire("--color-violet", 120), 420));
    });
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [reduceMotion, pending]);

  const start = new Date(result.startsAt);
  const end = new Date(result.endsAt);
  const place =
    type.location_kind === "video"
      ? result.videoLink
      : type.location_kind === "phone"
        ? null
        : (type.location_text ?? null);
  const event = useMemo(
    () => ({
      title: t("result.icsTitle", { type: type.name, host: host.name }),
      start: result.startsAt,
      end: result.endsAt,
      location: place,
    }),
    [t, type.name, host.name, result.startsAt, result.endsAt, place],
  );
  const icsHref = useMemo(
    () => icsDataUrl({ ...event, uid: result.icsUid, pending, product: brandingHidden ? "Booking" : APP_NAME }),
    [event, result.icsUid, pending, brandingHidden],
  );

  const rise = (delay: number) => ({
    initial: { opacity: 0, y: reduceMotion ? 0 : 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.35, delay: reduceMotion ? 0 : delay },
  });

  return (
    <section
      className="flex flex-col gap-6 rounded-3xl border border-line bg-surface p-6 md:p-8"
      data-testid="booking-success"
      data-status={result.status}
    >
      <div className="flex flex-col gap-4">
        <motion.div
          ref={markRef}
          initial={{ scale: reduceMotion ? 1 : 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={reduceMotion ? { duration: 0.15 } : { type: "spring", bounce: 0.5, duration: 0.7, delay: 0.1 }}
          className={cn(
            "grid size-16 place-items-center rounded-full border",
            pending
              ? "border-gold/60 bg-gold/10 text-gold shadow-[0_0_36px_-8px_var(--color-gold)]"
              : "border-teal/60 bg-teal/10 text-teal shadow-[0_0_36px_-8px_var(--color-teal)]",
          )}
        >
          {pending ? (
            <HourglassIcon aria-hidden className="size-7" strokeWidth={2} />
          ) : (
            <CheckIcon aria-hidden className="size-8" strokeWidth={2.5} />
          )}
        </motion.div>
        <motion.div {...rise(0.25)} className="flex flex-col gap-2">
          {pending && (
            <StatusPill tone="gold" dot className="w-fit">
              {t("result.pendingBadge")}
            </StatusPill>
          )}
          <h2 className="font-display text-3xl leading-tight font-bold tracking-tight text-ink text-balance md:text-4xl">
            {t(pending ? "result.pendingTitle" : "result.confirmedTitle")}
          </h2>
        </motion.div>
      </div>

      <motion.div {...rise(0.4)} className="flex flex-col gap-1 rounded-2xl border border-line bg-canvas/50 p-5">
        <p className="micro-label">
          {t("form.meetingLine", {
            type: type.name,
            duration: formatNumber(type.duration_min, {}, settings),
            host: host.name,
          })}
        </p>
        <p className="font-display text-3xl leading-tight font-bold tracking-tight text-ink first-letter:uppercase md:text-4xl">
          {formatSpokenDate(start, settings, locale)}
        </p>
        <p className="text-2xl font-semibold text-violet tabular-nums">
          {formatTime(start, settings)}–{formatTime(end, settings)}
        </p>
        <p className="text-xs text-ink-muted">
          {zone} · {formatUtcOffset(zone, start)}
        </p>
      </motion.div>

      <motion.p {...rise(0.5)} className="text-sm leading-relaxed text-ink-soft text-pretty">
        {t(pending ? "result.pendingText" : "result.confirmedText", { email, host: host.name })}
      </motion.p>

      <motion.div {...rise(0.6)} className="flex flex-col gap-3">
        <p className="micro-label">{t("result.addToCalendar")}</p>
        <div className="flex flex-wrap gap-2">
          <a
            href={googleCalendarUrl(event)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline" })}
          >
            <CalendarPlusIcon aria-hidden data-icon="inline-start" />
            {t("result.google")}
          </a>
          <a href={icsHref} download="invite.ics" className={buttonVariants({ variant: "outline" })}>
            <CalendarPlusIcon aria-hidden data-icon="inline-start" />
            {t("result.apple")}
          </a>
          <a
            href={outlookCalendarUrl(event)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline" })}
          >
            <CalendarPlusIcon aria-hidden data-icon="inline-start" />
            {t("result.outlook")}
          </a>
        </div>
      </motion.div>

      <motion.div {...rise(0.7)} className="flex flex-col-reverse gap-2 border-t border-line/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <a
          href={result.manageUrl}
          className={buttonVariants({ variant: "ghost", className: "text-ink-soft" })}
          data-testid="booking-manage-link"
        >
          {t("result.manage")}
        </a>
        {result.videoLink && (
          <a href={result.videoLink} target="_blank" rel="noopener noreferrer" className={buttonVariants()}>
            <VideoIcon aria-hidden data-icon="inline-start" />
            {t("result.video")}
          </a>
        )}
      </motion.div>
    </section>
  );
}
