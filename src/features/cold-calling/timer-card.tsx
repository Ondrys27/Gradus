"use client";

import { useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon, TimerOffIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAwardXp, useGameCelebrate, useProspectingRecord } from "@/features/game/queries";
import { formatStopwatch, formatTime, todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useUrlIntent } from "@/lib/use-url-intent";
import { cn } from "@/lib/utils";
import { pastDeadline, shownSeconds } from "./timer-logic";
import { useCan } from "@/features/account/workspace-queries";
import { useTimerAction, useTimerReading } from "./timer-queries";

/** How often a paused timer looks at the clock, to start the new day at zero. */
const PAUSED_TICK_MS = 30_000;

/**
 * Today's time on the phone. Start and pause are the only actions; there is no
 * reset. The browser counts on locally between readings and never writes while
 * it runs; the database settles idle time on every read.
 */
export function TimerCard() {
  const t = useTranslations("coldCalling.timer");
  const tCelebration = useTranslations("game.celebration.prospectingRecord");
  const celebrate = useGameCelebrate();
  const settings = useFormatSettings();
  const reading = useTimerReading();
  const action = useTimerAction();
  // Only someone who may work the list runs a timer; the database checks it too.
  const canRun = useCan("cold_calling", "edit");
  const record = useProspectingRecord();
  const awardXp = useAwardXp();
  // The day a record was last celebrated: once a day is enough, later pauses only extend it.
  const recordShownOn = useRef<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [idleNotice, setIdleNotice] = useState<string | null>(null);

  // The read that closed an idle segment says so once; keep it until dismissed.
  const [seenReading, setSeenReading] = useState<number | null>(null);
  if (reading.data && reading.data.receivedAt !== seenReading) {
    setSeenReading(reading.data.receivedAt);
    if (reading.data.idleClosedAt) setIdleNotice(reading.data.idleClosedAt);
  }

  const data = reading.data;
  const running = data?.running ?? false;
  const refetch = reading.refetch;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), running ? 1000 : PAUSED_TICK_MS);
    return () => window.clearInterval(timer);
  }, [running]);

  // Past the idle deadline, or a new day in the user's zone: read again.
  const askedFor = useRef<number | null>(null);
  const day = todayIsoDate(settings, new Date(now));
  const readingDay = data ? todayIsoDate(settings, new Date(data.receivedAt)) : day;
  const needsRead = data !== undefined && (pastDeadline(data, now) || day !== readingDay);
  useEffect(() => {
    if (!needsRead || !data || askedFor.current === data.receivedAt) return;
    askedFor.current = data.receivedAt;
    void refetch();
  }, [needsRead, data, refetch]);

  const seconds = data ? (day === readingDay ? shownSeconds(data, now) : 0) : 0;

  // "Start timer" from the search: starts once the current state is known.
  useUrlIntent("timer", (value) => {
    if (value !== "start") return;
    if (!data) return false;
    if (!running && !action.isPending) run("start");
  });

  function run(kind: "start" | "pause") {
    action.mutate(kind, {
      onSuccess: ({ idleAt }) => {
        if (idleAt) setIdleNotice(idleAt);
        else if (kind === "start") setIdleNotice(null);
        // A pause is when today's total settles, so this is when a record shows.
        if (kind === "pause") {
          // 30 minutes on the phone today pays once; the server checks the total.
          awardXp.mutate({ reason: "call_30min" });
          record.mutate(undefined, {
            onSuccess: ({ isRecord, seconds }) => {
              const today = todayIsoDate(settings);
              if (!isRecord || recordShownOn.current === today) return;
              recordShownOn.current = today;
              celebrate({
                title: tCelebration("title"),
                subtitle: tCelebration("subtitle", { minutes: Math.round(seconds / 60) }),
              });
            },
          });
        }
      },
    });
  }

  return (
    <GlowCard interactive={false} className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="micro-label">{t("title")}</h2>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium",
            running ? "text-teal" : "text-ink-muted",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full",
              running ? "bg-teal motion-safe:animate-pulse" : "bg-ink-muted",
            )}
          />
          {running ? t("running") : t("paused")}
        </span>
      </div>

      {reading.isPending ? (
        <Skeleton className="h-16 w-3/4" />
      ) : reading.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : (
        <p
          className="font-mono text-5xl leading-none font-bold text-ink tabular-nums sm:text-6xl"
          aria-label={t("todayLabel", { time: formatStopwatch(seconds) })}
        >
          {formatStopwatch(seconds)}
        </p>
      )}

      {idleNotice && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-gold/30 bg-gold/10 p-3 text-sm text-gold"
        >
          <TimerOffIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p className="flex-1">
            {t("idleStopped", { time: formatTime(new Date(idleNotice), settings) })}
          </p>
          <button
            type="button"
            aria-label={t("dismiss")}
            onClick={() => setIdleNotice(null)}
            className="-m-2 grid size-11 shrink-0 cursor-pointer place-items-center rounded-full outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-gold/40 mouse:size-8"
          >
            <XIcon aria-hidden className="size-4" />
          </button>
        </div>
      )}

      {canRun && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="lg"
            disabled={!data || running || action.isPending}
            onClick={() => run("start")}
          >
            <PlayIcon aria-hidden data-icon="inline-start" />
            {t("start")}
          </Button>
          <Button
            size="lg"
            variant="outline"
            disabled={!data || !running || action.isPending}
            onClick={() => run("pause")}
          >
            <PauseIcon aria-hidden data-icon="inline-start" />
            {t("pause")}
          </Button>
        </div>
      )}
      {action.isError && <FormAlert>{t("actionFailed")}</FormAlert>}
      <p className="text-xs text-ink-muted">{t("idleHint")}</p>
    </GlowCard>
  );
}
