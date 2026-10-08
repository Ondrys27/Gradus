"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { Dialog } from "@base-ui/react/dialog";
import { ChevronRightIcon, LockIcon, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import {
  useDefinitions,
  useFirstActiveMilestone,
  useFocusMilestone,
  useLevelOverview,
  useMarkLevelSeen,
  usePathProgress,
  usePathTemplates,
  type UnlockDefinition,
} from "./overview-queries";
import { todaySources, xpSuggestions, type SourceProgress, type XpSuggestion } from "./overview";
import { useGameState } from "./queries";
import { levelProgress, MAX_LEVEL, tierForLevel } from "./rules";
import { localized, SECTION_UNLOCK_KEYS, type LockableSection } from "./types";
import { GameIcon } from "./unlock-icon";
import { track } from "@/lib/analytics/client";

/** Where a suggestion leads: the milestone itself, or the section the action happens in. */
function suggestionHref(suggestion: XpSuggestion): string {
  switch (suggestion.kind) {
    case "completeMilestone":
    case "finishTasks":
    case "firstTask":
      return `/app/milniky/${suggestion.milestoneId}`;
    case "callToday":
      return "/app/cold-calling";
    case "moveContacts":
      return "/app/kontakty";
    case "bookMeeting":
    case "addEvent":
      return "/app/kalendar";
    case "addTransaction":
      return "/app/finance";
  }
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * The level window: the level and XP to the next one, how to earn XP today,
 * what the next level brings, the path, the badges and the last XP events.
 * Centred on larger screens, the whole screen on phones; it scrolls.
 */
export function LevelDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("game.levelWindow");
  const game = useGameState();
  const markSeen = useMarkLevelSeen();
  const level = game.data?.level ?? 1;

  // Opening the window is what stops the pill pulsing.
  useEffect(() => {
    if (open && game.data) markSeen.mutate(game.data.level);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening and level
  }, [open, game.data?.level]);
  useEffect(() => {
    if (open) track("level_dialog_opened", { level });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-overlay bg-canvas/75 backdrop-blur-md transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          className={cn(
            "fixed inset-0 z-overlay flex flex-col overflow-y-auto overscroll-contain bg-surface outline-none",
            "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
            "md:inset-auto md:top-1/2 md:left-1/2 md:max-h-[90dvh] md:w-[min(100vw-64px,720px)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-3xl md:border md:border-line-strong md:pt-0 md:pb-0 md:shadow-popover",
            "transition-[opacity,scale] duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 md:data-ending-style:scale-95 md:data-starting-style:scale-95",
          )}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line/60 bg-surface/90 px-4 py-2 backdrop-blur-xl md:px-6">
            <Dialog.Title className="micro-label">{t("title")}</Dialog.Title>
            <Dialog.Close
              aria-label={t("close")}
              className="-mr-2 grid size-11 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <XIcon aria-hidden className="size-5" />
            </Dialog.Close>
          </div>
          <div className="flex flex-col gap-8 px-4 py-6 md:px-6">
            <LevelHeader totalXp={game.data?.totalXp ?? 0} level={level} />
            {open && <LevelBody level={level} />}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function LevelHeader({ totalXp, level }: { totalXp: number; level: number }) {
  const t = useTranslations("game");
  const settings = useFormatSettings();
  const n = (value: number) => formatNumber(value, {}, settings);
  const progress = levelProgress(totalXp);
  const top = level >= MAX_LEVEL;
  const nextThreshold = totalXp - progress.xpIntoLevel + progress.xpForNextLevel;

  return (
    <section className="flex flex-col items-center gap-4 text-center">
      <ProgressRing
        value={Math.round(progress.ratio * 100)}
        label={t("levelWindow.progress")}
        size={148}
        strokeWidth={10}
        tone="teal"
      >
        <span className="flex flex-col items-center">
          <span className="text-5xl font-black text-ink tabular-nums">{n(level)}</span>
          <span className="micro-label">{t("levelWindow.level")}</span>
        </span>
      </ProgressRing>
      <p className="text-2xl font-bold text-ink">{t(`tiers.${tierForLevel(level)}`)}</p>
      <div className="flex w-full max-w-md flex-col gap-2">
        <ProgressBar value={Math.round(progress.ratio * 100)} label={t("levelWindow.progress")} />
        <p className="text-sm font-semibold text-ink tabular-nums">
          {top
            ? t("levelWindow.maxLevel", { xp: n(totalXp) })
            : t("levelWindow.xpOf", { xp: n(totalXp), next: n(nextThreshold) })}
        </p>
        {!top && (
          <p className="text-xs text-ink-muted">
            {t("levelWindow.toNext", {
              xp: n(progress.xpForNextLevel - progress.xpIntoLevel),
              level: n(level + 1),
            })}
          </p>
        )}
      </div>
    </section>
  );
}

function LevelBody({ level }: { level: number }) {
  const game = useGameState();
  const overview = useLevelOverview(true);
  const definitions = useDefinitions();
  const path = usePathProgress();
  const templates = usePathTemplates();
  const unlocked = useMemo(() => new Set(game.data?.unlocked ?? []), [game.data?.unlocked]);
  const isOpen = (section: LockableSection) => unlocked.has(SECTION_UNLOCK_KEYS[section]);

  // The step the suggestions point at: the current one of the path, else the first active milestone.
  const current = path.data?.current;
  const fallback = useFirstActiveMilestone(!path.isPending && !current);
  const target = current?.milestoneId
    ? {
        id: current.milestoneId,
        title: current.ownTitle ?? "",
        templateId: current.ownTemplateId,
        xp: current.xp,
      }
    : fallback.data
      ? {
          id: fallback.data.id,
          title: fallback.data.title,
          templateId: fallback.data.template_id,
          xp: templates.data?.find((step) => step.id === fallback.data!.template_id)?.xp ?? 100,
        }
      : null;
  const focus = useFocusMilestone(target, true);

  const sources = useMemo(
    () => todaySources(overview.data?.today ?? [], { streak: game.data?.streak ?? 0 }),
    [overview.data?.today, game.data?.streak],
  );
  const suggestions = xpSuggestions({ focus: focus.data ?? null, sources, isOpen });

  return (
    <>
      <EarnSection
        loading={overview.isPending}
        sources={sources}
        suggestions={suggestions}
        isOpen={isOpen}
      />
      <NextRewards level={level} rewards={definitions.data?.levelRewards} />
      <PathSection />
      <BadgesSection />
      <HistorySection />
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function EarnSection({
  loading,
  sources,
  suggestions,
  isOpen,
}: {
  loading: boolean;
  sources: SourceProgress[];
  suggestions: XpSuggestion[];
  isOpen: (section: LockableSection) => boolean;
}) {
  const t = useTranslations("game");
  const settings = useFormatSettings();
  const n = (value: number) => formatNumber(value, {}, settings);

  return (
    <Section title={t("levelWindow.earnTitle")}>
      {suggestions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {suggestions.map((suggestion) => (
            <li key={suggestion.kind}>
              <Link
                href={suggestionHref(suggestion)}
                className="flex min-h-12 items-center gap-3 rounded-2xl border border-violet/40 bg-violet/10 px-4 py-2.5 text-sm text-ink outline-none transition-colors hover:bg-violet/15 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="min-w-0 flex-1">{suggestionText(t, suggestion, n)}</span>
                {"xp" in suggestion && (
                  <span className="shrink-0 rounded-full bg-gold/15 px-2.5 py-1 text-xs font-bold text-gold tabular-nums">
                    {t("levelWindow.xp", { xp: n(suggestion.xp) })}
                  </span>
                )}
                <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-ink-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {loading ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : (
        <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {sources.map((source) => {
            const locked = source.section !== null && !isOpen(source.section);
            return (
              <li key={source.key} className={cn("flex flex-col gap-1.5", locked && "opacity-50")}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-ink-soft">
                    {locked && <LockIcon aria-hidden className="size-3.5 shrink-0" />}
                    <span className="truncate">{t(`sources.${source.key}`)}</span>
                  </span>
                  <span className="shrink-0 font-semibold text-ink tabular-nums">
                    {source.cap === null
                      ? t("levelWindow.earnedNoCap", { xp: n(source.earned) })
                      : t("levelWindow.earnedOfCap", {
                          xp: n(source.earned),
                          cap: n(source.cap),
                        })}
                  </span>
                </div>
                {source.cap !== null && (
                  <ProgressBar
                    size="sm"
                    tone="reward"
                    value={Math.min(source.earned, source.cap)}
                    max={source.cap}
                    label={t(`sources.${source.key}`)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function suggestionText(
  t: Translate,
  suggestion: XpSuggestion,
  n: (value: number) => string,
): string {
  switch (suggestion.kind) {
    case "completeMilestone":
      return t("suggestions.completeMilestone", { milestone: suggestion.milestone });
    case "finishTasks":
      return t("suggestions.finishTasks", {
        count: suggestion.count,
        countFormatted: n(suggestion.count),
        milestone: suggestion.milestone,
      });
    case "firstTask":
      return t("suggestions.firstTask", { milestone: suggestion.milestone });
    case "moveContacts":
      return t("suggestions.moveContacts", {
        count: suggestion.count,
        countFormatted: n(suggestion.count),
      });
    default:
      return t(`suggestions.${suggestion.kind}`);
  }
}

function RewardCard({ item, locked }: { item: UnlockDefinition; locked?: boolean }) {
  const locale = useLocale();
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-line bg-canvas-deep/50 px-3 py-3">
      <span
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-xl",
          locked ? "bg-gold/10 text-gold" : "bg-teal/15 text-teal",
        )}
      >
        <GameIcon name={item.icon} className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{localized(item.name, locale)}</span>
        <span className="block text-xs text-ink-soft">{localized(item.description, locale)}</span>
      </span>
    </li>
  );
}

function NextRewards({
  level,
  rewards,
}: {
  level: number;
  rewards: Map<number, UnlockDefinition[]> | undefined;
}) {
  const t = useTranslations("game.levelWindow");
  const settings = useFormatSettings();
  if (level >= MAX_LEVEL) return null;
  // The next level, or the nearest one after it that brings something.
  let at = level + 1;
  while (rewards && at <= MAX_LEVEL && !rewards.get(at)?.length) at++;
  const items = rewards?.get(at) ?? [];

  return (
    <Section
      title={
        at === level + 1
          ? t("nextRewards")
          : t("laterRewards", { level: formatNumber(at, {}, settings) })
      }
    >
      {!rewards ? (
        <Skeleton className="h-20 rounded-2xl" />
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("noRewards")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <RewardCard key={item.key} item={item} locked />
          ))}
        </ul>
      )}
    </Section>
  );
}

function PathSection() {
  const t = useTranslations("game");
  const locale = useLocale();
  const settings = useFormatSettings();
  const path = usePathProgress();
  const n = (value: number) => formatNumber(value, {}, settings);

  if (!path.isPending && !path.data) return null;
  return (
    <Section title={t("levelWindow.pathTitle")}>
      {!path.data ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-3">
            {path.data.chapters.map((chapter) => {
              const current = chapter.steps.find((step) => step.state === "current");
              return (
                <li key={chapter.chapter} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-ink-soft">
                      {t("path.chapter", { number: n(chapter.chapter) })} ·{" "}
                      <span className="text-ink">{t(`path.chapters.${chapter.chapter}`)}</span>
                    </span>
                    <span className="font-semibold text-ink tabular-nums">
                      {t("path.progress", { done: n(chapter.done), total: n(chapter.total) })}
                    </span>
                  </div>
                  <ProgressBar
                    size="sm"
                    value={chapter.done}
                    max={chapter.total}
                    label={t(`path.chapters.${chapter.chapter}`)}
                  />
                  {current?.milestoneId && (
                    <Link
                      href={`/app/milniky/${current.milestoneId}`}
                      className="mt-1 flex min-h-12 items-center gap-3 rounded-2xl border border-violet/60 bg-violet/15 px-4 py-2.5 shadow-glow outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="size-2.5 shrink-0 rounded-full bg-violet shadow-[0_0_10px_var(--color-violet)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-ink-muted">{t("path.current")}</span>
                        <span className="block truncate text-sm font-semibold text-ink">
                          {current.ownTitle ?? localized(current.title, locale)}
                        </span>
                      </span>
                      <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-ink-muted" />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          <Link
            href="/app/milniky?view=path"
            className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium text-teal outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {t("levelWindow.openPath")}
            <ChevronRightIcon aria-hidden className="size-4" />
          </Link>
        </div>
      )}
    </Section>
  );
}

function BadgesSection() {
  const t = useTranslations("game.levelWindow");
  const locale = useLocale();
  const overview = useLevelOverview(true);
  const earned = overview.data?.achievements.filter((a) => a.earnedAt).length ?? 0;
  const settings = useFormatSettings();

  return (
    <Section
      title={t("badgesTitle", {
        earned: formatNumber(earned, {}, settings),
        total: formatNumber(overview.data?.achievements.length ?? 0, {}, settings),
      })}
    >
      {!overview.data ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {overview.data.achievements.map((badge) => {
            const has = !!badge.earnedAt;
            return (
              <li
                key={badge.key}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-2xl border px-2 py-3 text-center",
                  has ? "border-gold/50 bg-gold/10" : "border-line bg-canvas-deep/40",
                )}
              >
                <span
                  className={cn(
                    "grid size-11 place-items-center rounded-full",
                    has
                      ? "bg-gold/20 text-gold shadow-[0_0_16px_-4px_var(--color-gold)]"
                      : "bg-line/40 text-ink-muted",
                  )}
                >
                  <GameIcon name={badge.icon} className="size-5" />
                </span>
                <span className={cn("text-sm font-semibold", has ? "text-ink" : "text-ink-muted")}>
                  {localized(badge.name, locale)}
                </span>
                <span className="text-xs text-ink-muted">
                  {localized(badge.description, locale)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function HistorySection() {
  const t = useTranslations("game");
  const settings = useFormatSettings();
  const overview = useLevelOverview(true);
  const history = overview.data?.history;

  return (
    <Section title={t("levelWindow.historyTitle")}>
      {!history ? (
        <Skeleton className="h-32 rounded-2xl" />
      ) : history.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("levelWindow.historyEmpty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line/60">
          {history.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-ink">
                  {t.has(`history.${item.kind}`) ? t(`history.${item.kind}`) : t("history.other")}
                </span>
                <span className="block text-xs text-ink-muted">
                  {formatDateTime(new Date(item.createdAt), settings)}
                </span>
              </span>
              <span className="shrink-0 font-bold text-gold tabular-nums">
                {t("levelWindow.xp", { xp: formatNumber(item.xp, {}, settings) })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
